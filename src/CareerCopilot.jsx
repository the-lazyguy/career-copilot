import { useState, useCallback, useMemo } from 'react';
import {
  FileText, Target, MessageSquare, CheckCircle2, AlertCircle,
  Loader2, ArrowRight, RotateCcw, SkipForward, Copy, Check,
  Upload, X, FileCheck
} from 'lucide-react';

// ─── Color palette ───────────────────────────────────────────────────────────
const C = {
  bg: '#FBF8F1',
  card: '#FFFDF8',
  ink: '#1F2A24',
  inkMuted: '#6B7268',
  accent: '#BE8A2E',
  accentDark: '#8F6A1F',
  accentSoft: '#F2E4C4',
  sage: '#52755A',
  sageSoft: '#E3ECE2',
  brick: '#A14F3C',
  brickSoft: '#F1DED7',
  border: '#E6DEC8',
};

const RAIL = [
  { key: 'resume', label: 'Resume', icon: FileText },
  { key: 'ats', label: 'ATS Score', icon: Target },
  { key: 'jd', label: 'Job Match', icon: Target },
  { key: 'interview', label: 'Interview', icon: MessageSquare },
  { key: 'feedback', label: 'Feedback', icon: CheckCircle2 },
];

const STAGE_TO_RAIL = { resume: 0, ats: 1, jd: 2, gap: 2, interview: 3, feedback: 4 };

// ─── Supported file types ────────────────────────────────────────────────────
const SUPPORTED_TYPES = [
  { ext: '.txt', mime: 'text/plain', label: 'Text' },
  { ext: '.md', mime: 'text/markdown', label: 'Markdown' },
  { ext: '.pdf', mime: 'application/pdf', label: 'PDF' },
  { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  { ext: '.doc', mime: 'application/msword', label: 'Word (old)' },
  { ext: '.rtf', mime: 'application/rtf', label: 'RTF' },
  { ext: '.odt', mime: 'application/vnd.oasis.opendocument.text', label: 'ODT' },
  { ext: '.html', mime: 'text/html', label: 'HTML' },
  { ext: '.htm', mime: 'text/html', label: 'HTML' },
];

const ACCEPT_STRING = SUPPORTED_TYPES.map(t => t.ext).join(',');

// ─── File parsing utilities ──────────────────────────────────────────────────
async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function cleanExtractedText(text) {
  return text
    .replace(/\x00/g, '')
    .replace(/\x0b/g, '\n')
    .replace(/\x0c/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── PDF Parser ──────────────────────────────────────────────────────────────
async function parsePdf(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8');
  const fullText = decoder.decode(bytes);

  let extracted = '';

  // Method 1: Extract text between BT...ET blocks with Tj/TJ operators
  try {
    const textBlocks = [];
    let i = 0;
    while (i < bytes.length - 2) {
      // Look for BT (Begin Text)
      if (bytes[i] === 66 && bytes[i + 1] === 84 && (bytes[i + 2] === 32 || bytes[i + 2] === 10 || bytes[i + 2] === 13)) {
        i += 2;
        let blockText = '';
        let inString = false;
        let stringBuffer = '';
        let parenDepth = 0;

        while (i < bytes.length - 2) {
          // Check for ET (End Text)
          if (bytes[i] === 69 && bytes[i + 1] === 84 && (bytes[i + 2] === 32 || bytes[i + 2] === 10 || bytes[i + 2] === 13 || bytes[i + 2] === 47)) {
            break;
          }

          const char = String.fromCharCode(bytes[i]);

          if (char === '(' && !inString) {
            inString = true;
            parenDepth = 1;
            stringBuffer = '';
          } else if (inString) {
            if (char === '\\' && i + 1 < bytes.length) {
              const next = String.fromCharCode(bytes[i + 1]);
              if (next === 'n') { stringBuffer += '\n'; i++; }
              else if (next === 'r') { stringBuffer += '\r'; i++; }
              else if (next === 't') { stringBuffer += '\t'; i++; }
              else if (next === 'b') { stringBuffer += '\b'; i++; }
              else if (next === 'f') { stringBuffer += '\f'; i++; }
              else if (next === '(' || next === ')' || next === '\\') { stringBuffer += next; i++; }
              else if (/\d/.test(next) && i + 3 < bytes.length) {
                const octal = String.fromCharCode(bytes[i + 1]) + String.fromCharCode(bytes[i + 2]) + String.fromCharCode(bytes[i + 3]);
                const code = parseInt(octal, 8);
                if (!isNaN(code) && code > 31 && code < 127) {
                  stringBuffer += String.fromCharCode(code);
                  i += 3;
                } else {
                  stringBuffer += char;
                }
              } else {
                stringBuffer += next;
                i++;
              }
            } else if (char === '(') {
              parenDepth++;
              stringBuffer += char;
            } else if (char === ')') {
              parenDepth--;
              if (parenDepth === 0) {
                inString = false;
                if (stringBuffer.trim().length > 0) {
                  blockText += stringBuffer + ' ';
                }
              } else {
                stringBuffer += char;
              }
            } else {
              stringBuffer += char;
            }
          }
          i++;
        }
        if (blockText.trim().length > 10) {
          textBlocks.push(blockText.trim());
        }
      }
      i++;
    }

    if (textBlocks.length > 0) {
      extracted = textBlocks.join('\n\n');
    }
  } catch (e) {
    // fallback to next method
  }

  // Method 2: Extract all parenthesized strings (broader catch)
  if (extracted.length < 100) {
    try {
      const regex = /\(([^)]{3,500})\)/g;
      const matches = [];
      let match;
      while ((match = regex.exec(fullText)) !== null) {
        const cleaned = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, ' ')
          .replace(/\\r/g, '')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .trim();
        if (cleaned.length > 2 && /[a-zA-Z]{2,}/.test(cleaned)) {
          matches.push(cleaned);
        }
      }
      if (matches.length > 0) {
        extracted = matches.join(' ');
      }
    } catch (e) {
      // ignore
    }
  }

  // Method 3: Try to decode as UTF-16 (some PDFs use this)
  if (extracted.length < 100) {
    try {
      const utf16Decoder = new TextDecoder('utf-16le');
      const utf16Text = utf16Decoder.decode(bytes);
      const readable = utf16Text.replace(/[^\x20-\x7E\n\t]/g, ' ').replace(/[ ]{2,}/g, ' ').trim();
      if (readable.length > extracted.length) {
        extracted = readable;
      }
    } catch (e) {
      // ignore
    }
  }

  // Method 4: Extract from stream objects
  if (extracted.length < 100) {
    try {
      const streamMatches = fullText.match(/stream\s*([\s\S]*?)\s*endstream/g);
      if (streamMatches) {
        const streamText = streamMatches
          .map(s => s.replace(/^stream\s*/, '').replace(/\s*endstream$/, ''))
          .join(' ')
          .replace(/[^\x20-\x7E\n\t]/g, ' ')
          .replace(/[ ]{2,}/g, ' ')
          .trim();
        if (streamText.length > extracted.length) {
          extracted = streamText;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const cleaned = cleanExtractedText(extracted);

  if (cleaned.length < 50) {
    throw new Error('Could not extract readable text from PDF. The file may be scanned/image-based. Please copy-paste the text manually.');
  }

  return cleaned;
}

// ─── DOCX Parser ─────────────────────────────────────────────────────────────
async function parseDocx(arrayBuffer) {
  try {
    // DOCX is a ZIP file with XML inside
    const JSZip = await import('jszip');
    const zip = await JSZip.default.loadAsync(arrayBuffer);

    // Read document.xml which contains the text
    const docXml = await zip.file('word/document.xml')?.async('text');
    if (!docXml) {
      throw new Error('Could not find document content in DOCX file');
    }

    // Parse XML and extract text
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');

    // DOCX uses w:t tags for text
    const textNodes = xmlDoc.getElementsByTagName('w:t');
    let text = '';
    for (let i = 0; i < textNodes.length; i++) {
      text += textNodes[i].textContent;
    }

    // Also try to preserve paragraph breaks
    const paragraphs = xmlDoc.getElementsByTagName('w:p');
    const paraTexts = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const tNodes = p.getElementsByTagName('w:t');
      let pText = '';
      for (let j = 0; j < tNodes.length; j++) {
        pText += tNodes[j].textContent;
      }
      if (pText.trim()) {
        paraTexts.push(pText);
      }
    }

    if (paraTexts.length > 0) {
      text = paraTexts.join('\n');
    }

    const cleaned = cleanExtractedText(text);

    if (cleaned.length < 50) {
      throw new Error('Could not extract sufficient text from DOCX');
    }

    return cleaned;
  } catch (e) {
    if (e.message?.includes('jszip')) {
      throw new Error('DOCX parsing requires the jszip library. Please paste text manually, or run: npm install jszip');
    }
    throw new Error(`Could not read DOCX file: ${e.message}`);
  }
}

// ─── DOC Parser (old Word format) ────────────────────────────────────────────
async function parseDoc(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(bytes);

  // Old .doc files have text interspersed with binary data
  // Try to extract readable ASCII sequences
  let extracted = '';
  let currentWord = '';

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    // Printable ASCII or common whitespace
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      currentWord += String.fromCharCode(byte);
    } else {
      if (currentWord.length >= 3) {
        extracted += currentWord + ' ';
      }
      currentWord = '';
    }
  }

  if (currentWord.length >= 3) {
    extracted += currentWord;
  }

  const cleaned = cleanExtractedText(extracted);

  if (cleaned.length < 50) {
    throw new Error('Could not extract readable text from .doc file. Please convert to .docx or paste text manually.');
  }

  return cleaned;
}

// ─── RTF Parser ──────────────────────────────────────────────────────────────
async function parseRtf(text) {
  // RTF uses backslash commands
  let cleaned = text
    // Remove RTF header
    .replace(/^\{\rtf1.*?\ansicpg\d+/, '')
    // Remove font table
    .replace(/\{\fonttbl.*?\}/g, '')
    // Remove color table
    .replace(/\{\colortbl.*?\}/g, '')
    // Remove stylesheet
    .replace(/\{\stylesheet.*?\}/g, '')
    // Remove info block
    .replace(/\{\info.*?\}/g, '')
    // Remove pict/images
    .replace(/\{\pict.*?\}/g, '')
    // Remove field instructions
    .replace(/\{\field.*?\}/g, '')
    // Remove footnotes
    .replace(/\{\footnote.*?\}/g, '')
    // Common RTF control words
    .replace(/\par[d]?/g, '\n')
    .replace(/\tab/g, '\t')
    .replace(/\line/g, '\n')
    .replace(/\page[break]?/g, '\n\n---PAGE BREAK---\n\n')
    .replace(/\b/g, '')
    .replace(/\i/g, '')
    .replace(/\ul/g, '')
    .replace(/\strike/g, '')
    .replace(/\sub/g, '')
    .replace(/\super/g, '')
    .replace(/\nosupersub/g, '')
    .replace(/\ql/g, '')
    .replace(/\qr/g, '')
    .replace(/\qc/g, '')
    .replace(/\qj/g, '')
    .replace(/\li\d+/g, '')
    .replace(/\ri\d+/g, '')
    .replace(/\fi\d+/g, '')
    .replace(/\sb\d+/g, '')
    .replace(/\sa\d+/g, '')
    .replace(/\sl\d+/g, '')
    .replace(/\slmult\d+/g, '')
    .replace(/\f\d+/g, '')
    .replace(/\fs\d+/g, '')
    .replace(/\cf\d+/g, '')
    .replace(/\cb\d+/g, '')
    .replace(/\highlight\d+/g, '')
    .replace(/\lang\d+/g, '')
    .replace(/\uc\d+/g, '')
    .replace(/\u-?\d+\?/g, '')
    .replace(/\'[0-9a-fA-F]{2}/g, '')
    // Remove remaining backslash commands
    .replace(/\[a-z]+\d*/g, ' ')
    .replace(/\[*\]/g, '')
    // Clean up
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Remove the final closing brace if present
  if (cleaned.endsWith('}')) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  if (cleaned.length < 50) {
    throw new Error('Could not extract readable text from RTF file');
  }

  return cleaned;
}

// ─── ODT Parser ──────────────────────────────────────────────────────────────
async function parseOdt(arrayBuffer) {
  try {
    const JSZip = await import('jszip');
    const zip = await JSZip.default.loadAsync(arrayBuffer);

    // ODT content is in content.xml
    const contentXml = await zip.file('content.xml')?.async('text');
    if (!contentXml) {
      throw new Error('Could not find content in ODT file');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(contentXml, 'application/xml');

    // ODT uses text:p and text:span for text
    const textNodes = xmlDoc.getElementsByTagName('text:p');
    const paragraphs = [];
    for (let i = 0; i < textNodes.length; i++) {
      const p = textNodes[i].textContent.trim();
      if (p) paragraphs.push(p);
    }

    const text = paragraphs.join('\n');
    const cleaned = cleanExtractedText(text);

    if (cleaned.length < 50) {
      throw new Error('Could not extract sufficient text from ODT');
    }

    return cleaned;
  } catch (e) {
    if (e.message?.includes('jszip')) {
      throw new Error('ODT parsing requires the jszip library. Please paste text manually, or run: npm install jszip');
    }
    throw new Error(`Could not read ODT file: ${e.message}`);
  }
}

// ─── HTML Parser ─────────────────────────────────────────────────────────────
async function parseHtml(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');

  // Remove script and style elements
  doc.querySelectorAll('script, style, nav, footer, header, aside').forEach(el => el.remove());

  // Get text content
  let content = doc.body?.textContent || doc.documentElement?.textContent || '';

  const cleaned = cleanExtractedText(content);

  if (cleaned.length < 50) {
    throw new Error('Could not extract readable text from HTML file');
  }

  return cleaned;
}

// ─── Main file parser dispatcher ─────────────────────────────────────────────
async function parseFile(file) {
  const name = file.name.toLowerCase();
  const ext = name.substring(name.lastIndexOf('.'));

  // Plain text files
  if (ext === '.txt' || ext === '.md' || ext === '.csv') {
    const text = await readFileAsText(file);
    return cleanExtractedText(text);
  }

  // HTML files
  if (ext === '.html' || ext === '.htm') {
    const text = await readFileAsText(file);
    return parseHtml(text);
  }

  // RTF files
  if (ext === '.rtf') {
    const text = await readFileAsText(file);
    return parseRtf(text);
  }

  // PDF files
  if (ext === '.pdf') {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    return parsePdf(arrayBuffer);
  }

  // DOCX files
  if (ext === '.docx') {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    return parseDocx(arrayBuffer);
  }

  // Old DOC files
  if (ext === '.doc') {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    return parseDoc(arrayBuffer);
  }

  // ODT files
  if (ext === '.odt') {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    return parseOdt(arrayBuffer);
  }

  throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_TYPES.map(t => t.ext).join(', ')}`);
}

// ─── Local scoring engine (no API) ───────────────────────────────────────────
function analyzeAts(resume) {
  const text = resume.toLowerCase();
  const words = text.split(/\s+/).filter(w => w.length > 0);

  let score = 50;
  const strengths = [];
  const weaknesses = [];
  const suggestions = [];

  if (words.length > 300) {
    score += 10;
    strengths.push('Good content length');
  } else {
    weaknesses.push('Resume appears too short');
    suggestions.push('Expand to 300+ words with details');
  }

  const hasSection = (kw) => text.includes(kw);
  if (hasSection('experience') || hasSection('work')) {
    score += 8; strengths.push('Experience section present');
  } else {
    weaknesses.push('No experience section found');
    suggestions.push('Add a work experience section');
  }

  if (hasSection('education') || hasSection('degree')) {
    score += 5; strengths.push('Education section present');
  } else {
    weaknesses.push('No education section found');
    suggestions.push('Add education details');
  }

  if (hasSection('skills') || hasSection('technologies')) {
    score += 5; strengths.push('Skills section present');
  } else {
    weaknesses.push('No dedicated skills section');
    suggestions.push('Add a skills or technologies section');
  }

  const hasNumbers = /\d+%|\d+ years|\d+\+|\$\d+/.test(resume);
  if (hasNumbers) {
    score += 10; strengths.push('Quantified achievements included');
  } else {
    weaknesses.push('No quantified metrics found');
    suggestions.push('Add numbers: percentages, years, dollar amounts');
  }

  const actionVerbs = ['led', 'built', 'created', 'designed', 'implemented', 'managed', 'developed', 'launched', 'improved', 'reduced'];
  const verbCount = actionVerbs.filter(v => text.includes(v)).length;
  if (verbCount >= 3) {
    score += 7; strengths.push('Strong action verbs used');
  } else {
    weaknesses.push('Weak or passive language');
    suggestions.push('Start bullets with action verbs: led, built, launched');
  }

  if (/@/.test(resume) && /\d{3}/.test(resume)) {
    score += 5; strengths.push('Contact information present');
  } else {
    weaknesses.push('Contact details may be incomplete');
    suggestions.push('Ensure email and phone are visible');
  }

  score = Math.min(100, Math.max(0, score));

  while (strengths.length < 3) strengths.push('Well-structured content');
  while (weaknesses.length < 3) weaknesses.push('Could use more specificity');
  while (suggestions.length < 3) suggestions.push('Review for clarity and conciseness');

  return {
    score,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    suggestions: suggestions.slice(0, 3),
  };
}

function analyzeGap(resume, jd) {
  const r = resume.toLowerCase();
  const j = jd.toLowerCase();

  const techKeywords = [
    'javascript', 'typescript', 'react', 'vue', 'angular', 'node', 'python',
    'java', 'go', 'rust', 'sql', 'nosql', 'mongodb', 'postgresql', 'aws',
    'azure', 'gcp', 'docker', 'kubernetes', 'ci/cd', 'git', 'graphql',
    'rest', 'api', 'microservices', 'serverless', 'machine learning',
    'ai', 'data science', 'analytics', 'agile', 'scrum', 'leadership',
    'communication', 'teamwork', 'problem solving', 'project management',
  ];

  const foundInResume = techKeywords.filter(kw => r.includes(kw));
  const foundInJd = techKeywords.filter(kw => j.includes(kw));
  const missing = foundInJd.filter(kw => !foundInResume);

  const matchPct = foundInJd.length > 0
    ? Math.round((foundInResume.filter(kw => foundInJd.includes(kw)).length / foundInJd.length) * 100)
    : 50;

  return {
    match_percentage: Math.min(100, Math.max(20, matchPct)),
    missing_skills: missing.slice(0, 5).length > 0 ? missing.slice(0, 5) : ['No major gaps detected'],
    keyword_gaps: missing.slice(0, 3).length > 0 ? missing.slice(0, 3) : ['Minor keyword differences'],
    recommendations: [
      'Add relevant keywords from the job description',
      'Highlight matching experience more prominently',
      'Consider adding certifications for missing skills',
    ],
  };
}

function generateQuestions(resume, jd, skipping) {
  const r = resume.toLowerCase();
  const j = jd.toLowerCase();
  const questions = [];

  questions.push('Tell me about a time you led a project under a tight deadline.');
  questions.push('How do you handle conflicting priorities from different stakeholders?');

  if (r.includes('react') || r.includes('frontend') || r.includes('ui')) {
    questions.push('Walk me through how you would optimize a React component that renders slowly.');
  } else if (r.includes('backend') || r.includes('api') || r.includes('server')) {
    questions.push('Describe how you would design a REST API for a high-traffic application.');
  } else {
    questions.push('Describe a complex problem you solved and your approach.');
  }

  if (!skipping) {
    if (j.includes('leadership') || j.includes('manage') || j.includes('lead')) {
      questions.push('Give an example of how you have mentored or led a team member.');
    } else if (j.includes('startup') || j.includes('fast-paced')) {
      questions.push('How do you prioritize when everything feels urgent?');
    } else {
      questions.push('What trade-offs did you consider in your most recent project?');
    }
  } else {
    questions.push('What trade-offs did you consider in your most recent project?');
  }

  questions.push('How do you stay current with new technologies in your field?');

  return { questions: questions.slice(0, 5) };
}

function evaluateFeedback(questions, answers) {
  const perQuestion = answers.map((ans, i) => {
    const a = (ans || '').trim().toLowerCase();
    if (!a) return 'No answer provided — practice speaking out loud.';

    const wordCount = a.split(/\s+/).length;
    const hasExample = /\b(for example|like when|one time|in my|at my|we used|i built|i created|i led)\b/.test(a);
    const hasMetric = /\d+%|\d+ years|\d+ people|\$\d+|\d+x/.test(a);

    if (wordCount < 15) return 'Too brief — expand with a specific example and outcome.';
    if (hasExample && hasMetric) return 'Excellent: specific example with quantified impact.';
    if (hasExample) return 'Good example, but add a metric (%, $, time) for stronger impact.';
    if (hasMetric) return 'Good data point, but ground it in a concrete story or example.';
    return 'Solid answer — try to make it more specific with a real scenario.';
  });

  const avgScore = perQuestion.reduce((sum, f) => {
    if (f.includes('Excellent')) return sum + 95;
    if (f.includes('Good')) return sum + 75;
    if (f.includes('Solid')) return sum + 65;
    if (f.includes('Too brief')) return sum + 40;
    return sum + 50;
  }, 0) / perQuestion.length;

  const overallScore = Math.round(avgScore);

  let overall = '';
  if (overallScore >= 80) overall = 'Strong communicator with clear, specific examples. Keep this up in real interviews.';
  else if (overallScore >= 60) overall = 'Good foundation. Add more specific examples and metrics to strengthen your answers.';
  else overall = 'Keep practicing. Focus on the STAR method: Situation, Task, Action, Result.';

  return { per_question: perQuestion, overall, overall_score: overallScore };
}

// ─── UI Components ───────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, variant = 'primary', icon: Icon, ariaLabel }) {
  const isPrimary = variant === 'primary';
  const styles = isPrimary
    ? { backgroundColor: disabled ? C.border : C.accent, color: disabled ? C.inkMuted : '#FFFDF8' }
    : { backgroundColor: 'transparent', color: C.ink, border: `1px solid ${C.border}` };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="px-4 py-2.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all disabled:cursor-not-allowed hover:opacity-90 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1"
      style={{ ...styles, focusRing: C.accent }}
    >
      {children}
      {Icon ? <Icon size={15} className={disabled && Icon === Loader2 ? 'animate-spin' : ''} /> : null}
    </button>
  );
}

function Card({ children, ariaLabelledBy }) {
  return (
    <div
      role="region"
      aria-labelledby={ariaLabelledBy}
      className="rounded-xl p-6 md:p-7 shadow-sm"
      style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, id }) {
  return (
    <p
      id={id}
      className="text-xs uppercase tracking-wider mb-2 font-semibold"
      style={{ color: C.accentDark, letterSpacing: '0.08em' }}
    >
      {children}
    </p>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md px-3 py-2.5 mb-4 text-sm"
      style={{ backgroundColor: C.brickSoft, color: C.brick }}
    >
      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function ScoreDial({ value, label }) {
  const color = useMemo(() => {
    if (value >= 70) return C.sage;
    if (value >= 45) return C.accentDark;
    return C.brick;
  }, [value]);

  return (
    <div className="flex items-center gap-3" role="img" aria-label={`Score: ${value} out of 100`}>
      <div className="font-mono text-3xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-sm" style={{ color: C.inkMuted }}>
        {label}
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors hover:opacity-80"
      style={{ color: C.inkMuted, backgroundColor: C.sageSoft }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function StageRail({ stage, ats, gap, skipJd, feedback }) {
  const currentIdx = STAGE_TO_RAIL[stage];

  return (
    <nav aria-label="Progress" className="flex items-center gap-1 overflow-x-auto pb-1 mb-6 scrollbar-hide">
      {RAIL.map((r, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        let chip = null;

        if (r.key === 'ats' && ats) chip = `${ats.score}`;
        if (r.key === 'jd' && gap) chip = `${gap.match_percentage}%`;
        if (r.key === 'jd' && skipJd && currentIdx > 2) chip = 'skipped';
        if (r.key === 'feedback' && feedback) chip = `${feedback.overall_score}`;

        return (
          <div key={r.key} className="flex items-center gap-1 flex-shrink-0">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors"
              style={{
                backgroundColor: isCurrent ? C.accentSoft : isDone ? C.sageSoft : 'transparent',
                color: isCurrent ? C.accentDark : isDone ? C.sage : C.inkMuted,
                border: isCurrent ? `1px solid ${C.accent}` : '1px solid transparent',
              }}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <r.icon size={13} aria-hidden="true" />
              <span>{r.label}</span>
              {chip && <span className="font-mono opacity-80">· {chip}</span>}
            </div>
            {i < RAIL.length - 1 && (
              <div
                className="w-3 h-px flex-shrink-0"
                style={{ backgroundColor: isDone ? C.sage : C.border }}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ─── File Upload Component ───────────────────────────────────────────────────
function FileUploadZone({ onFileParsed, disabled }) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const [fileSize, setFileSize] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsedOk, setParsedOk] = useState(false);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const processFile = useCallback(async (file) => {
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File too large. Maximum size is 10MB.');
      return;
    }

    setUploadError(null);
    setParsing(true);
    setFileName(file.name);
    setFileSize(formatFileSize(file.size));
    setParsedOk(false);

    try {
      const text = await parseFile(file);
      if (text.length < 50) {
        throw new Error('File appears to be empty or could not be read properly.');
      }
      onFileParsed(text);
      setParsedOk(true);
    } catch (e) {
      setUploadError(e.message);
      setFileName(null);
      setFileSize(null);
    } finally {
      setParsing(false);
    }
  }, [onFileParsed]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleInputChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const clearFile = useCallback(() => {
    setFileName(null);
    setFileSize(null);
    setUploadError(null);
    setParsedOk(false);
    onFileParsed('');
  }, [onFileParsed]);

  const supportedLabels = SUPPORTED_TYPES.map(t => t.ext).join(', ');

  return (
    <div className="space-y-3">
      {/* Drag & drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative rounded-lg border-2 border-dashed p-6 text-center transition-colors"
        style={{
          borderColor: isDragging ? C.accent : parsedOk ? C.sage : C.border,
          backgroundColor: isDragging ? C.accentSoft : parsedOk ? C.sageSoft : C.bg,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
        onClick={() => !disabled && document.getElementById('file-input').click()}
      >
        <input
          id="file-input"
          type="file"
          accept={ACCEPT_STRING}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled}
        />
        {parsedOk ? (
          <FileCheck size={28} className="mx-auto mb-2" style={{ color: C.sage }} />
        ) : (
          <Upload
            size={28}
            className="mx-auto mb-2"
            style={{ color: isDragging ? C.accent : C.inkMuted }}
          />
        )}
        <p className="text-sm font-medium" style={{ color: C.ink }}>
          {parsing ? 'Reading file...' : parsedOk ? 'File loaded successfully' : 'Drop your resume here, or click to browse'}
        </p>
        <p className="text-xs mt-1" style={{ color: C.inkMuted }}>
          Supports: {supportedLabels} · Max 10MB
        </p>
      </div>

      {/* File name + clear */}
      {fileName && (
        <div
          className="flex items-center justify-between rounded-md px-3 py-2 text-sm"
          style={{ backgroundColor: parsedOk ? C.sageSoft : C.accentSoft, color: parsedOk ? C.sage : C.accentDark }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="flex-shrink-0" />
            <span className="truncate">{fileName}</span>
            {fileSize && <span className="text-xs opacity-70 flex-shrink-0">({fileSize})</span>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); clearFile(); }}
            className="p-1 rounded hover:opacity-70 transition-opacity flex-shrink-0"
            aria-label="Remove uploaded file"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div
          className="flex items-start gap-2 rounded-md px-3 py-2.5 text-sm"
          style={{ backgroundColor: C.brickSoft, color: C.brick }}
        >
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CareerCopilotPrototype() {
  const [stage, setStage] = useState('resume');
  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');
  const [skipJd, setSkipJd] = useState(false);
  const [ats, setAts] = useState(null);
  const [gap, setGap] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setStage('resume');
    setResumeText('');
    setJdText('');
    setSkipJd(false);
    setAts(null);
    setGap(null);
    setQuestions(null);
    setAnswers([]);
    setFeedback(null);
    setError(null);
  }, []);

  const handleFileParsed = useCallback((text) => {
    setResumeText(text);
    setError(null);
  }, []);

  const runAts = useCallback(() => {
    const trimmed = resumeText.trim();
    if (!trimmed) {
      setError('Please paste or upload your resume before analyzing.');
      return;
    }

    setLoading(true);
    setError(null);

    setTimeout(() => {
      try {
        const result = analyzeAts(trimmed);
        setAts(result);
        setStage('ats');
      } catch (e) {
        setError('Could not analyze the resume.');
      } finally {
        setLoading(false);
      }
    }, 600);
  }, [resumeText]);

  const runGap = useCallback(() => {
    const trimmed = jdText.trim();
    if (!trimmed) {
      setError('Please paste a job description before comparing.');
      return;
    }

    setLoading(true);
    setError(null);

    setTimeout(() => {
      try {
        const result = analyzeGap(resumeText.trim(), trimmed);
        setGap(result);
        setStage('gap');
      } catch (e) {
        setError('Could not compare resume to job description.');
      } finally {
        setLoading(false);
      }
    }, 600);
  }, [resumeText, jdText]);

  const runQuestions = useCallback((skipping) => {
    setLoading(true);
    setError(null);
    setSkipJd(skipping);

    setTimeout(() => {
      try {
        const result = generateQuestions(resumeText.trim(), jdText.trim(), skipping);
        setQuestions(result.questions);
        setAnswers(new Array(result.questions.length).fill(''));
        setStage('interview');
      } catch (e) {
        setError('Could not generate interview questions.');
      } finally {
        setLoading(false);
      }
    }, 600);
  }, [resumeText, jdText]);

  const runFeedback = useCallback(() => {
    if (answers.every((a) => !a.trim())) {
      setError('Please answer at least one question before getting feedback.');
      return;
    }

    setLoading(true);
    setError(null);

    setTimeout(() => {
      try {
        const result = evaluateFeedback(questions, answers);
        setFeedback(result);
        setStage('feedback');
      } catch (e) {
        setError('Could not generate feedback.');
      } finally {
        setLoading(false);
      }
    }, 800);
  }, [questions, answers]);

  const atsCopyText = useMemo(() => {
    if (!ats) return '';
    return `ATS Score: ${ats.score}/100\n\nStrengths:\n${ats.strengths.map(s => `• ${s}`).join('\n')}\n\nWeaknesses:\n${ats.weaknesses.map(s => `• ${s}`).join('\n')}\n\nSuggestions:\n${ats.suggestions.map(s => `• ${s}`).join('\n')}`;
  }, [ats]);

  const feedbackCopyText = useMemo(() => {
    if (!feedback || !questions) return '';
    return `Overall Score: ${feedback.overall_score}/100\n\n${feedback.overall}\n\n${questions.map((q, i) => `Q${i+1}: ${q}\nFeedback: ${feedback.per_question[i]}`).join('\n\n')}`;
  }, [feedback, questions]);

  return (
    <div className="min-h-screen w-full font-body" style={{ backgroundColor: C.bg, color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
        .font-display { font-family: 'Fraunces', serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        textarea, input { font-family: 'Inter', sans-serif; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="max-w-2xl mx-auto px-5 py-10">
        <header>
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: C.inkMuted, letterSpacing: '0.1em' }}>
            Prototype — No API Required
          </p>
          <h1 className="font-display text-3xl mb-1" style={{ fontWeight: 600 }}>
            Career Copilot — working flow
          </h1>
          <p className="text-sm mb-7" style={{ color: C.inkMuted }}>
            Resume → ATS → job match → interview prep. Runs entirely in your browser. Nothing is saved.
          </p>
        </header>

        <StageRail stage={stage} ats={ats} gap={gap} skipJd={skipJd} feedback={feedback} />

        <ErrorBanner message={error} />

        {/* ─── STEP 1: Resume ─────────────────────────────────────────────── */}
        {stage === 'resume' && (
          <Card ariaLabelledBy="step1-label">
            <SectionLabel id="step1-label">Step 1 — Resume</SectionLabel>
            <p className="text-sm mb-3" style={{ color: C.inkMuted }}>
              Upload your resume file or paste the text below.
            </p>

            {/* File Upload */}
            <FileUploadZone onFileParsed={handleFileParsed} disabled={loading} />

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
              <span className="text-xs" style={{ color: C.inkMuted }}>or paste text</span>
              <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
            </div>

            {/* Text Input */}
            <label htmlFor="resume-input" className="sr-only">Resume text</label>
            <textarea
              id="resume-input"
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={10}
              placeholder="Paste your resume text here..."
              className="w-full rounded-md p-3 text-sm outline-none resize-y"
              style={{ border: `1px solid ${C.border}`, backgroundColor: '#fff' }}
              disabled={loading}
            />
            <div className="mt-4 flex justify-end">
              <Btn
                onClick={runAts}
                disabled={loading || !resumeText.trim()}
                icon={loading ? Loader2 : ArrowRight}
                ariaLabel="Analyze resume for ATS score"
              >
                {loading ? 'Analyzing...' : 'Check ATS score'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ─── STEP 2: ATS Score ──────────────────────────────────────────── */}
        {stage === 'ats' && ats && (
          <Card ariaLabelledBy="step2-label">
            <div className="flex items-start justify-between">
              <SectionLabel id="step2-label">Step 2 — ATS score</SectionLabel>
              <CopyButton text={atsCopyText} />
            </div>
            <ScoreDial value={ats.score} label="out of 100, formatting & clarity" />
            <div className="grid sm:grid-cols-2 gap-4 mt-5 text-sm">
              <div>
                <p className="font-semibold mb-1.5" style={{ color: C.sage }}>Strengths</p>
                <ul className="space-y-1" style={{ color: C.inkMuted }}>
                  {ats.strengths.map((s, i) => <li key={`strength-${i}`}>• {s}</li>)}
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1.5" style={{ color: C.brick }}>Weaknesses</p>
                <ul className="space-y-1" style={{ color: C.inkMuted }}>
                  {ats.weaknesses.map((s, i) => <li key={`weakness-${i}`}>• {s}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-4">
              <p className="font-semibold mb-1.5 text-sm" style={{ color: C.accentDark }}>Suggestions</p>
              <ul className="space-y-1 text-sm" style={{ color: C.inkMuted }}>
                {ats.suggestions.map((s, i) => <li key={`suggestion-${i}`}>• {s}</li>)}
              </ul>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 justify-end">
              <Btn
                variant="secondary"
                onClick={() => runQuestions(true)}
                disabled={loading}
                icon={SkipForward}
                ariaLabel="Skip job description and go to interview prep"
              >
                Skip to interview prep
              </Btn>
              <Btn
                onClick={() => setStage('jd')}
                disabled={loading}
                icon={ArrowRight}
                ariaLabel="Add a job description for comparison"
              >
                Add a job description
              </Btn>
            </div>
          </Card>
        )}

        {/* ─── STEP 3: Job Description ──────────────────────────────────── */}
        {stage === 'jd' && (
          <Card ariaLabelledBy="step3-label">
            <SectionLabel id="step3-label">Step 3 — Job description (optional)</SectionLabel>
            <p className="text-sm mb-3" style={{ color: C.inkMuted }}>
              Paste the job posting to see how well this resume matches it.
            </p>
            <label htmlFor="jd-input" className="sr-only">Job description text</label>
            <textarea
              id="jd-input"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={8}
              placeholder="Paste the job description here..."
              className="w-full rounded-md p-3 text-sm outline-none resize-y"
              style={{ border: `1px solid ${C.border}`, backgroundColor: '#fff' }}
              disabled={loading}
            />
            <div className="mt-4 flex justify-end">
              <Btn
                onClick={runGap}
                disabled={loading || !jdText.trim()}
                icon={loading ? Loader2 : ArrowRight}
                ariaLabel="Compare resume to job description"
              >
                {loading ? 'Comparing...' : 'Compare to this job'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ─── STEP 4: Job Match ──────────────────────────────────────────── */}
        {stage === 'gap' && gap && (
          <Card ariaLabelledBy="step4-label">
            <SectionLabel id="step4-label">Step 4 — Job match</SectionLabel>
            <ScoreDial value={gap.match_percentage} label="% match to this job description" />
            <div className="grid sm:grid-cols-2 gap-4 mt-5 text-sm">
              <div>
                <p className="font-semibold mb-1.5" style={{ color: C.brick }}>Missing skills</p>
                <ul className="space-y-1" style={{ color: C.inkMuted }}>
                  {gap.missing_skills.map((s, i) => <li key={`missing-${i}`}>• {s}</li>)}
                </ul>
              </div>
              <div>
                <p className="font-semibold mb-1.5" style={{ color: C.brick }}>Keyword gaps</p>
                <ul className="space-y-1" style={{ color: C.inkMuted }}>
                  {gap.keyword_gaps.map((s, i) => <li key={`keyword-${i}`}>• {s}</li>)}
                </ul>
              </div>
            </div>
            <div className="mt-4">
              <p className="font-semibold mb-1.5 text-sm" style={{ color: C.accentDark }}>Recommendations</p>
              <ul className="space-y-1 text-sm" style={{ color: C.inkMuted }}>
                {gap.recommendations.map((s, i) => <li key={`rec-${i}`}>• {s}</li>)}
              </ul>
            </div>
            <div className="mt-6 flex justify-end">
              <Btn
                onClick={() => runQuestions(false)}
                disabled={loading}
                icon={loading ? Loader2 : ArrowRight}
                ariaLabel="Generate tailored interview questions"
              >
                {loading ? 'Generating...' : 'Generate interview questions'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ─── STEP 5: Interview Prep ───────────────────────────────────── */}
        {stage === 'interview' && questions && (
          <Card ariaLabelledBy="step5-label">
            <SectionLabel id="step5-label">Step 5 — Interview prep</SectionLabel>
            <p className="text-sm mb-4" style={{ color: C.inkMuted }}>
              Answer each question as you would out loud. Feedback is based on what you write.
            </p>
            <div className="space-y-5">
              {questions.map((q, i) => (
                <div key={`question-${i}`}>
                  <label htmlFor={`answer-${i}`} className="text-sm font-medium mb-1.5 block">
                    {i + 1}. {q}
                  </label>
                  <textarea
                    id={`answer-${i}`}
                    value={answers[i]}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                    rows={3}
                    placeholder="Your answer..."
                    className="w-full rounded-md p-2.5 text-sm outline-none resize-y"
                    style={{ border: `1px solid ${C.border}`, backgroundColor: '#fff' }}
                    disabled={loading}
                  />
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Btn
                onClick={runFeedback}
                disabled={loading || answers.every((a) => !a.trim())}
                icon={loading ? Loader2 : ArrowRight}
                ariaLabel="Get feedback on interview answers"
              >
                {loading ? 'Reviewing...' : 'Get feedback'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ─── STEP 6: Feedback ─────────────────────────────────────────── */}
        {stage === 'feedback' && feedback && (
          <Card ariaLabelledBy="step6-label">
            <div className="flex items-start justify-between">
              <SectionLabel id="step6-label">Step 6 — Feedback</SectionLabel>
              <CopyButton text={feedbackCopyText} />
            </div>
            <ScoreDial value={feedback.overall_score} label="overall interview score" />
            <p className="text-sm mt-4 mb-5" style={{ color: C.inkMuted }}>{feedback.overall}</p>
            <div className="space-y-3">
              {questions.map((q, i) => (
                <div
                  key={`feedback-q-${i}`}
                  className="text-sm pb-3"
                  style={{ borderBottom: i < questions.length - 1 ? `1px solid ${C.border}` : 'none' }}
                >
                  <p className="font-medium mb-1">{i + 1}. {q}</p>
                  <p style={{ color: C.inkMuted }}>{feedback.per_question[i]}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <Btn
                variant="secondary"
                onClick={reset}
                icon={RotateCcw}
                ariaLabel="Start over from the beginning"
              >
                Start over
              </Btn>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
