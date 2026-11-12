# Implementation roadmap

DiffLens is a client-side text comparison app; all user text stays in the browser.

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

## Next milestones
- [x] Strengthen accessible descriptions and focus behavior for diff rows, minimap, and editor drawer, including keyboard minimap navigation, focused section announcements, modal focus trapping/restoration, Details focus restoration, and reduced-motion handling.
- [ ] Add optional import/export of named comparison sessions without sending data to a server.

Before closing any milestone, run `npm run lint`, `npm run test`, `npm run build`, and `npm run test:e2e`.
