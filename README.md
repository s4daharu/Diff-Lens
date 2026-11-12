# DiffLens

An open source, privacy-first diff checker that runs entirely in your browser.
Compare two texts side by side — no data ever leaves your device.

Built with React, TypeScript and [jsdiff](https://github.com/kpdecker/jsdiff),
with all diff computation happening in a Web Worker.

## Features

- Workspace layout: diff canvas fills the viewport, with a summary sidebar
  (stats, change outline, options) and a compact toolbar
- Side-by-side and inline (unified) text diff views
- Local image comparison for PNG/JPEG/WebP with side-by-side, slider, fade, subtract, and highlight modes
- Intra-line highlighting at character, word, or Smart automatic granularity
- Landing screen with dual input panels; once a diff exists, sources collapse
  into an "Edit sources" drawer
- Change-section outline — navigate contiguous edit hunks instead of stepping line by line
- Bounded moved-block detection with paired-location navigation and ambiguity-safe matching
- Per-section Changed ↔ Original merge actions with source-range-safe edits and bounded undo/redo history
- Difference minimap gutter with pointer and keyboard navigation
- Image pixel threshold/ignore-alpha controls, bounded changed-region navigation, synchronized zoom/pan, and highlight PNG export
- Paste text, open files (up to 10 MB), or drag & drop
- Ignore case / whitespace / line endings (CRLF) plus ordered literal/regex custom ignore rules
- Adjustable context lines with hidden-region collapse
- Diff stats, find-in-diff, unified `.patch` / Markdown / HTML report export
- Browser-native Print / Save as PDF reports in side-by-side or inline layouts with full non-virtualized report rows
- Named `.difflens.json` comparison sessions for local import/export of both sources and view preferences
- Dark mode, wrap toggle, line numbers toggle
- Inputs and preferences persisted in `localStorage`

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + 1` | Side-by-side view |
| `Ctrl/⌘ + 2` | Inline view |
| `Ctrl/⌘ + S` | Download `.patch` |
| `Ctrl/⌘ + F` | Find within diff |
| `Ctrl/⌘ + E` | Open the source editor |
| `Ctrl/⌘ + Z` | Undo last section merge |
| `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` | Redo section merge |
| `Alt + N` / `Alt + P` | Next / previous change section |
| `←` / `→` | Switch view from the view-mode tabs |

## Getting started

```sh
npm install
npm run dev        # start the dev server
```

Production build:

```sh
npm run build      # type-check + build to dist/
npm run preview    # serve the production build
```

## Tests

```sh
npm run test       # diff engine unit tests (tsx)
npm run test:e2e   # Playwright smoke tests against a production build
```

## How it works

`src/lib/diffEngine.ts` runs a line-level Myers diff (via a `Diff` subclass
that adds `ignoreCase` support, which jsdiff's typed line options omit),
pairs removed/added lines into "modified" rows, and produces char- or
word-level spans for those pairs. The unified patch is generated directly
from the same rows so exports always match what is displayed.
`src/diffWorker.ts` keeps heavy text computation off the main thread.
Image comparison uses `src/imageDiffWorker.ts` with `createImageBitmap` and
`OffscreenCanvas` where available, plus a browser Canvas fallback. Image
files and generated visual diffs remain local to the browser.

## License

MIT
