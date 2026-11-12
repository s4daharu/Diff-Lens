# Implementation roadmap

DiffLens is a privacy-first, client-side comparison app. User content should stay in the browser by default; new features should preserve that property unless a future roadmap explicitly says otherwise.

## Completed

- [x] Dual-input workspace, side-by-side and inline views, search, navigation, collapse/expand, and exports.
- [x] Background diff calculation with stale-result protection.
- [x] Unit tests and Playwright browser smoke tests.
- [x] Handle CR-only and mixed line endings consistently, and make leading/trailing hidden context expandable.
- [x] Run lint, diff-engine regression tests, production build and Chromium smoke tests in GitHub Actions on pushes and pull requests.
- [x] Add a consolidated View menu for hiding whitespace changes, hiding unchanged lines while preserving the prior context preference, and controlling line wrap.
- [x] Add browser coverage for file upload, drag-and-drop, and keyboard navigation.
- [x] Replace the 12,000-row truncation/render-all flow with measured, overscanned virtualization for large side-by-side and inline diffs; keep off-screen change navigation and lazy syntax highlighting working.
- [x] Keep source entry visible until both sources are explicitly provided, including empty-file support; collapse desktop details by default; navigate contiguous change sections instead of individual changed rows.
- [x] Strengthen accessible descriptions and focus behavior for diff rows, minimap, and editor drawer, including keyboard minimap navigation, focused section announcements, modal focus trapping/restoration, Details focus restoration, and reduced-motion handling.
- [x] Add optional import/export of named comparison sessions with versioned local JSON files that restore sources, filenames, comparison options, and view preferences without sending data to a server.

## Competitive review: Diffchecker

Reviewed on 2026-11-12 against:
- https://www.diffchecker.com/
- https://www.diffchecker.com/pricing/
- https://www.diffchecker.com/image-compare/
- https://www.diffchecker.com/desktop/

DiffLens already covers much of Diffchecker's core text workflow: side-by-side and unified views, word/character granularity, syntax highlighting, live source editing, whitespace/case/line-ending controls, hidden unchanged lines, line wrapping, large-file rendering, local persistence, and local named sessions.

The most valuable missing features that still fit DiffLens's privacy-first/browser-only architecture are:
1. custom ignore rules;
2. smart per-change diff precision;
3. moved-block detection;
4. per-section merge/accept actions with undo;
5. PDF-quality report export;
6. image comparison;
7. structured spreadsheet comparison.

Cloud sharing, inline comments, accounts, and cloud AI summaries are intentionally not near-term priorities because they require server-side storage or processing and would weaken the current privacy promise.

## Planned milestones

### Milestone 1 — Custom ignore rules and Smart precision ✅

Goal: make noisy logs, generated files, IDs, timestamps, prose, and identifiers easier to compare without changing the source text.

- [x] Extend diff options with ordered, enabled/disabled custom ignore rules.
- [x] Support literal rules first; add regex rules only with validation, pattern-length limits, and execution inside the diff worker so a bad pattern cannot freeze the UI thread.
- [x] Allow rules to be added, edited, reordered, toggled, and removed from Diff options.
- [x] Apply ignore normalization before line/intra-line comparison while retaining the original text for rendering.
- [x] Persist rules in local preferences and named comparison sessions.
- [x] Add a `smart` granularity mode alongside fixed character and word modes.
- [x] Make Smart precision choose character-level highlighting for short identifiers/numbers and word-level highlighting for prose-like edits, using a deterministic heuristic covered by tests.
- [x] Audit patch/Markdown/HTML exports under ignore rules so ignored differences never produce a misleading replayable patch. If an active ignore rule makes a patch non-replayable, either build the patch from the raw diff or clearly disable/label that export.
- [x] Add unit and browser coverage for timestamps, UUID/build-number noise, invalid regex input, prose edits, and identifier edits.

Acceptance:
- A repeating timestamp/session-ID pattern can be ignored without editing either source.
- Smart mode improves readability for prose while still catching single-character identifier changes.
- Existing case/whitespace/line-ending behavior does not regress.
- Large-file comparisons remain responsive.

### Milestone 2 — Moved-block detection ✅

Goal: distinguish content that moved from content that was independently deleted and re-added.

- [x] Add post-processing in the worker that pairs sufficiently similar deleted and added change sections using normalized line hashes plus bounded similarity scoring.
- [x] Keep the algorithm bounded for large diffs; avoid an unrestricted O(n²) section comparison.
- [x] Extend change-section metadata with moved-from / moved-to relationships without changing patch semantics.
- [x] Render moved sections with a distinct visual treatment and accessible description.
- [x] Add Previous/Next moved-section navigation and links between paired locations.
- [x] Preserve ordinary added/deleted classification when similarity is below threshold or ambiguous.
- [x] Add regression tests for exact moves, lightly edited moves, duplicate blocks, and large files.

Acceptance:
- Moving an unchanged paragraph/block is identified as a move rather than only an unrelated deletion plus addition.
- Ambiguous duplicates do not create incorrect pairings.
- Unified patch export remains standards-compatible.

### Milestone 3 — Merge / accept change sections

Goal: let users resolve a comparison directly instead of manually copying text between editors.

- [ ] Add per-section actions for applying Changed → Original and Original → Changed.
- [ ] Handle added, deleted, modified, mixed, and moved sections.
- [ ] Base edits on source-line ranges rather than rendered/virtual row positions.
- [ ] Recompute the diff immediately after each merge while keeping the nearest section in view.
- [ ] Add undo/redo for merge operations with keyboard shortcuts and a bounded history.
- [ ] Make merge controls keyboard-accessible and expose clear ARIA labels describing direction and affected line ranges.
- [ ] Keep filename/readiness/session state consistent after merges.
- [ ] Add browser tests for multi-line sections, beginning/end-of-file changes, repeated merges, undo/redo, and virtualized off-screen sections.

Acceptance:
- A user can resolve an entire comparison section by section without opening the source editor.
- Undo/redo restores exact source content.
- Merge actions remain correct after prior merges shift line numbers.

### Milestone 4 — PDF-quality comparison reports

Goal: make comparisons easy to archive, review, or attach to tickets without introducing server-side rendering.

- [ ] Add a print-focused report layout with session name, filenames, timestamps, active comparison options, stats, and the diff.
- [ ] Support side-by-side and unified report layouts with sensible page breaks and repeated column headers.
- [ ] Add a `Print / Save as PDF` export path first, using the browser's native PDF printing to avoid a large PDF dependency.
- [ ] Evaluate a direct-download PDF library only if native print output cannot meet layout/quality requirements.
- [ ] Ensure ignored rules and hidden context are disclosed in the report metadata.
- [ ] Add print CSS regression coverage where feasible and browser checks that the export view contains all expected metadata.

Acceptance:
- A comparison can be saved as a clean PDF through the browser without sending data anywhere.
- Long diffs paginate without clipped lines or overlapping headers.

### Milestone 5 — Image comparison v1

Goal: expand DiffLens beyond text while keeping all image processing local.

Scope for v1:
- [ ] Add an explicit comparison-type selector: Text / Image.
- [ ] Load PNG, JPEG, and WebP locally with `createImageBitmap`/Canvas.
- [ ] Provide synchronized side-by-side, slider, fade, subtract, and highlight modes.
- [ ] Add synchronized zoom/pan for side-by-side viewing.
- [ ] Add configurable pixel-difference threshold and ignore-alpha option.
- [ ] Group changed pixels into bounded regions and expose a navigable change list.
- [ ] Compare basic metadata: dimensions, format, and file size.
- [ ] Export the visual comparison/highlight result as PNG.
- [ ] Keep large-image processing off the main thread where practical using OffscreenCanvas/worker support with graceful fallback.
- [ ] Add browser tests with generated fixtures; do not depend on external image services.

Deferred from image v1:
- OCR/text-inside-image comparison.
- EXIF parsing beyond basic browser-available metadata.
- Automatic rotation/scale/perspective alignment.
- PDF-page rendering.

Acceptance:
- Two screenshots can be compared entirely offline with slider/fade/subtract/highlight views and a navigable region list.
- A visual diff can be exported as PNG.

### Milestone 6 — Structured spreadsheet comparison

Goal: compare tabular data semantically instead of as raw lines.

Phase A:
- [ ] Add CSV and TSV parsing with delimiter detection and quoted-cell handling.
- [ ] Align rows so a single inserted row does not make every following row look changed.
- [ ] Show cell-level additions/removals/modifications in a virtualized grid.
- [ ] Add row/column navigation plus hide-unchanged rows and columns.
- [ ] Reuse case/whitespace ignore options and add optional date normalization.

Phase B:
- [ ] Add XLSX import with a browser-safe library after bundle/security review.
- [ ] Compare sheet names, formulas, and values separately.
- [ ] Add sheet selector and formula-change indicators.
- [ ] Export structured results as CSV/XLSX only after the core compare UI is stable.

Acceptance:
- Inserting one CSV row near the top does not mark all remaining rows as modified.
- Large tables remain virtualized and keyboard navigable.

## Exploratory / later

These are feasible but significantly larger than the milestones above and should start with design/technical spikes before implementation.

- [ ] Browser folder comparison using the File System Access API where supported, with recursive tree diff and a fallback multi-file picker.
- [ ] PDF text extraction and page rendering entirely client-side.
- [ ] DOCX/PPTX comparison after evaluating browser parsing fidelity, formatting preservation, and bundle cost.
- [ ] OCR only if a local/browser OCR engine can meet performance and download-size targets.
- [ ] Local comparison profiles/presets for teams without adding accounts or cloud storage.

## Intentionally deferred

- Cloud-hosted saved comparisons and share links.
- Server-backed inline comments/review threads.
- Cloud AI summaries of user content.
- Account/SSO/team administration.

Those features can be reconsidered only if DiffLens deliberately adds an opt-in hosted mode with an explicit privacy model. They should not be mixed into the current local-only product implicitly.

## Quality gate for every milestone

Before closing any milestone:

1. Run `npm run lint`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Run `npm run test:e2e`.
5. Add regression coverage for the new behavior and the closest existing behavior it could break.
6. Verify keyboard navigation, focus behavior, accessible names/descriptions, reduced-motion behavior, and responsive desktop/mobile layouts.
7. Re-check large-input performance and virtualization where the feature touches rendering or diff computation.
8. Confirm that no feature sends source content off-device unless the roadmap has explicitly introduced an opt-in hosted mode.
