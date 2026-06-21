# Career Copilot

A fully client-side resume analysis, ATS scoring, job matching, and interview prep tool. No API keys, no data sent to servers — everything runs in your browser.

## Features

- **ATS Score** — Heuristic analysis of resume formatting, structure, and content
- **Job Match** — Keyword overlap analysis between resume and job description
- **Interview Prep** — Context-aware questions based on your resume and JD
- **Answer Feedback** — Heuristic evaluation of your interview answers

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the development server
npm start

# 3. Open http://localhost:3000 in your browser
```

## Build for Production

```bash
npm run build
```

The `build` folder will contain the optimized static files.

## How It Works

All scoring is done locally using heuristic functions:

- **ATS**: Checks for sections (Experience, Education, Skills), action verbs, quantified achievements, contact info, and length
- **Job Match**: Compares keyword overlap using a built-in tech keyword list
- **Interview Questions**: Adapts to your resume content (React, backend, etc.) and job description
- **Feedback**: Evaluates answers for length, specific examples, and quantified metrics

## Privacy

Nothing leaves your browser. No data is saved, logged, or transmitted.
