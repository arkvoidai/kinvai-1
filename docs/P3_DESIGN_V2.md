# P3 — Premium design system v2 and shell

## Scope implemented in this branch
- Added the Volt token (#D9F44E) and a dedicated Button variant named volt with an ink label and round ink arrow.
- Added the Volt pairing to the contrast reference on /design; ratios are calculated from the project's WCAG utility.
- Added stage to the existing Tile primitive, with the single permitted radial stage surface; tile surfaces now share a hairline and inset highlight.
- Updated display, H2 and body scales, radius and spacing tokens; refined the floating shadow token.
- Removed SKU and collection-code metadata from fallback catalogue covers. SKU remains part of product data and detail views.
- Updated the mobile header card and dark floating five-item navigation. Main content and footer reserve bottom-navigation safe-area clearance.
- Removed JavaScript scroll listeners from Header, MobileBottomBar and ScrollProgressBar. Header compaction and reading progress use CSS scroll timelines with static fallbacks.
- Added a CSS motion-budget check and a GitHub Actions quality workflow. No deployment workflow is included.

## Deliberate compatibility choice
Direction-aware hide/reveal of the header and bottom bar was not reimplemented with JavaScript scroll handlers. The shell keeps navigation available; header compaction and reading progress are CSS-driven. This avoids a main-thread scroll callback and keeps controls discoverable. Revisit only if a direction-aware CSS-only solution can be validated across supported browsers.

## Project constraints
The repository contains docs/CHARTER.md, docs/MOTION_AUDIT.md and docs/PERF.md. At the time this change was made, docs/AUDIT.md and a separately named DO NOT BREAK contract were not present in docs/. No schema migration or backend contract change was made.

## Not yet verified
- Visual review and before/after screenshots at 320, 360, 390, 430, 768, 1024, 1280, 1440 and 1920 CSS px.
- Playwright checks for tile occupancy (maximum 35% unused tile area), anchor offsets, bottom-nav overlap, focus and working interactions.
- Lighthouse mobile results, measured home-entry gzip size, LCP and CLS on a mid-range device.
- Cross-browser scroll-timeline fallback behavior and reduced-motion behavior in a real browser.
- The full /design inventory for every state of every shared component.
