# SideBySide Regulation Diff

A Next.js app that compares two framework PDFs side-by-side by paragraph number and visualizes redlines.

## What it does

- Upload `Base PDF` and `Compared PDF`
- Extract paragraph-numbered text (supports nested references like `25(a)` and `25(b)(i)`)
- Match paragraphs using strict normalized paragraph keys only
- Show side-by-side redline:
  - removed text as red strikethrough
  - added text as green
- Navigate quickly via paragraph index, search, and filters (`All`, `Changed`, `Added`, `Removed`)
- Sync scrolling between base and compared panes by paragraph anchor
- Export full comparison report as PDF, including appendix for unmatched/unextractable sections

## Tech stack

- Next.js 16 + TypeScript
- `pdfjs-dist` for PDF text extraction
- `diff` for word/sentence/paragraph diffs
- `@react-pdf/renderer` for PDF report export

## Run locally

```bash
npm install
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

## API endpoints

- `POST /api/compare` - upload and compare two PDFs
- `GET /api/compare/:id` - fetch comparison result
- `GET /api/compare/:id/export?granularity=word|sentence|paragraph` - download full report PDF

## Notes

- v1 supports text-based PDFs (no OCR).
- Comparison results are in-memory only for current runtime.

## Vercel deployment notes

- `pdfjs-dist@5` requires Node `>=20.16.0` (or `>=22.3.0`). Set Vercel Project Settings -> Node.js Version to `22.x`.
- Compare routes are Node runtime API functions and use `/tmp` for temporary PDFs.
- If default comparison fails, verify `public/samples/ifrs-base.pdf` and `public/samples/aasb-compared.pdf` exist in the deployed build.
