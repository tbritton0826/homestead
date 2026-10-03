# Public V1 visual polish

Branch: `codex/public-v1-polish`. Starting commit: `9a6523a` (completed startup/derivation performance batch). This batch contains scoped UI corrections; it does not change appearance persistence, API contracts, progressive mounting, search caching, Music derivation, lazy features, or dependencies. No merge or push is performed.

## Prioritized problems and causes

The following list was reported before implementation:

1. Music and YouTube details squeezed mobile titles, metadata, and actions. Fixed artwork widths and absolute hero content left too little room for copy.
2. Ribbon statistics could consume mobile title space; long desktop ribbons clipped actions. Grid auto-placement and nonwrapping content conflicted with the available width.
3. Fixed media-card widths wasted mobile space; Music navigation buttons shrank into unreadable labels. Duplicate `!important` grid/image rules bypassed appearance settings.
4. The appearance editor extended beyond a 390 px viewport. Its viewport-based width plus overlay padding exceeded the available container.
5. Some cards inherited panel appearance, and broad nested-image rules forced artwork to crop regardless of the selected fit.
6. Buttons using `primary-button` could retain native browser styling because the base class had no shared treatment.

Production validation additionally exposed a real blur bug: the CSS minifier removed the unprefixed, variable-based `backdrop-filter` when a matching WebKit declaration followed it. Local reproduction confirmed the declaration-order cause. The declarations now put the WebKit form first and the standard form last; a regression check verifies emitted standard declarations for panels, cards, and overlays.

Family/Pets also reserved large decorative hero areas after banner failures. Failed images now leave layout flow, and missing-art heroes size to their text.

## Changes and observed results

| Area / applied principle | Before | After |
| --- | --- | --- |
| Responsive headers | AI/Cloud/Adult mobile titles could have zero width | Title, scrolling stats, and action group occupy explicit rows; AI title measured 277.83 px |
| Readable navigation / touch size | Shrinking Music labels; hidden AI/Inventory mobile tabs | Scoped horizontal scrollers with nonshrinking labels and 40 px minimum button height |
| Media grids / stable artwork geometry | Mobile Movies single fixed 190 px column; conflicting Books rules | Two columns at default mobile size; Books tracks measured 158 px; selected poster ratio remains accurate when width is capped |
| Music detail / content flow | Approximately 80 px copy beside 220 px artwork; 700 px hero | 328 px copy, 160 px artwork, approximately 519 px hero at 390 x 844 |
| YouTube detail / metadata | Squeezed copy and stacked metadata | 100 px artwork, 212 px copy; metadata scrolls within its row; hero approximately 253 px |
| Appearance modal / spacing | Right edge approximately 398 px in a 390 px viewport | Editor remains within the viewport with 12 px overlay padding; fields and footer remain scrollable/reachable |
| Token-respecting surfaces | Cards could use panel settings; variable-based blur compiled incorrectly | Distinct card/panel/overlay tokens; configured 24 px blur confirmed on production cards and panels |
| Shared controls / explicit transitions | Native gray primary actions | Rounded, aligned primary actions with disabled and keyboard-focus treatment; named color/shadow transitions |
| Desktop proportions | AI tools stacked across the full width; Cloud empty state occupied one grid cell | Three AI tool columns at 1440 px; Cloud empty state spans its complete row |
| Missing artwork | Broken decorative banner glyph and empty hero space | Text-sized fallback: Family Archive approximately 143 px on mobile; Pets detail approximately 140 px |

Poster width, height, spacing, and artwork fit use existing appearance variables. A new ratio variable also follows the buffered live preview, so changing dimensions does not stretch artwork after responsive scaling. The non-Photos editor exposes the already-supported `posterFit` field as Artwork fit. Photos retain their existing fit control. Direct poster selectors replace broad rules that also affected nested artwork.

Existing Family launch tiles, profile metadata, library actions, filtering, artwork sources, and detail navigation remain available. CSS consolidation is limited to the conflicting grid/image/header rules and variable-based blur declaration ordering; the new stylesheet introduces no `!important` declarations.

## Files changed

- `src/PublicVisualPolish.css`: scoped headers, primary actions, scrollers, media grids, details, modal sizing, AI/Cloud/Inventory surfaces, and Family/Pets missing-art fallback.
- `src/App.css`: remove conflicting fixed-size media overrides; scope legacy mobile rules; separate card/overlay surfaces; correct production blur declaration ordering.
- `src/App.jsx`: action-group markup, Music detail classes, ratio variable, Artwork fit control, Settings scope class, and decorative banner failure handling.
- `src/utils/appearance-preview.js`: publish the live poster ratio.
- `scripts/test-public-ui-responsiveness.cjs`: ratio extremes and production CSS minification regressions.
- `scripts/profile-public-ui.mjs`: opt-in small visual fixtures, complete library navigation, non-explicit photos/profiles, production mode without profiling overlay, and forwarding Homestead request headers through the isolated proxy.
- `scripts/visual-public-ui.mjs`: visual-fixture entry point; default performance fixtures remain unchanged.
- `PUBLIC_VISUAL_POLISH.md`: this report.

## Manual validation

The runnable checkout used a separate local API on port 7313 and synthetic visual fixtures on port 7314. Final visual review used production assets, with desktop 1440 x 900 and mobile 390 x 844 browser viewports. These are local fixture checks, not device or provider certification.

| Screen | Desktop and mobile checks actually performed |
| --- | --- |
| Home | Header/actions, recent-content rows, panel proportions and mobile navigation |
| Movies | Library grid, detail/actions, back navigation, appearance dialog, fit/ratio preview and page overrides |
| TV | Library/detail, episode entry, metadata/actions, back navigation and detail appearance reset |
| YouTube | Creator library/detail, artwork, metadata scroller, tabs and back navigation |
| Music | Artist grid/tabs, artist details, artwork, copy flow, action placement and back navigation |
| Books | Grid, detail modal sizing, styled Read/disabled Listen actions and closing details |
| Family | Home, Archive, missing-banner fallback, section navigation, photo viewer close/reopen |
| Pets | Landing, details, missing-art fallback, metadata/tabs and back navigation |
| Adult | Home stats/actions, performer grid, profile metadata/tabs and back navigation |
| Cloud | Empty state, header stats, tabs and visible New Folder/Upload controls |
| Inventory | Empty/loading state, search control, categories and restored mobile tabs |
| AI | Three-column desktop tools, one-column mobile tools, title and restored tabs |
| Settings | Header, section scroller, server panels and mobile scrolling |

Appearance checks included card/panel transparency at zero, card/panel blur at 24 px, artwork containment, poster dimensions at 320 x 180, default two-column mobile grids, background selection from the synthetic photo picker, opacity at 100%, background blur at 30 px, contain fit and full-viewport coverage. The background pseudo-element reported the selected URL, opacity 1, `blur(30px) brightness(1)`, contain fit and left inset 0.

Global width 120 px was inherited after a library reset. A Movie page detail width of 160 px survived editor reopening, then returned to inherited 300 px after page reset. Banner brightness preview was checked at 25%. TV detail controls/reset worked; its existing This Page option is disabled because that page does not publish a supported page scope. All test appearance values were reset in the isolated checkout.

The image viewer measured viewport coverage of 390 x 844 with its close, navigation and bottom controls inside the viewport. Performer screenshots initially appeared blank in clipped capture mode; full-page capture and DOM inspection confirmed content paints correctly, with no product stacking change required. Production console inspection returned no JavaScript errors in the final review. An earlier development-fixture maximum-update-depth warning was not reproduced in production; this does not establish that every provider-driven effect is loop-free.

Representative saved evidence: `music-mobile-before.png` and `music-mobile-after.png` in `C:/Users/tbrit/.codex/visualizations/2026/10/03/01a1034a-41c2-73b3-adf4-78def2dfaf4f/`.

## Automated validation and build

- `npm run test`: passed after the final changes. Includes appearance persistence/reset/inheritance/race/failure tests, buffered preview/progressive grid/search tests, startup lazy-loading/profile/Music/reader/scanner/HLS checks, media polish and public baseline checks.
- `node scripts/test-unified-profile-overlay-pass.cjs`: passed.
- `node scripts/test-family-profile-tree-pass.cjs`: passed.
- `npm run build`: passed. CSS 755.71 kB (gzip 126.22 kB); entry JS 1,740.76 kB (gzip 430.18 kB). Previous performance report recorded CSS 748.61 kB and entry JS 1,740.05 kB. Deferred feature chunk sizes remain unchanged; Vite still emits the existing large-chunk warning.
- `git diff --check`: passed.

## Remaining inconsistencies and final V1 recommendation

The legacy stylesheet remains large. Movie/TV and person-profile heroes still use different composition and back-action placement; profile metadata is intentionally more extensive and creates a long mobile page. Some tabs/pages lack a published page appearance scope, including TV details. Nested specialized forms, provider dialogs, extreme real-world metadata and plugin-owned surfaces were not exhaustively restyled or checked at every token value.

Fixture integrations are unconfigured, so provider results/playback and real uploaded artwork need live-installation QA. The initial upload attempt through the fixture proxy failed because it omitted the content-type metadata header; the proxy forwarding was corrected, but upload success was not revalidated. Background selection/rendering was verified through the photo picker. Mobile Safari, real touch hardware, camera capture and device safe areas were not tested here.

The recommended final V1 batch is focused accessibility and real-content QA: keyboard focus/return and modal trapping, icon-only labels and contrast at transparency extremes, missing/long artwork metadata, live upload/provider error and loading paths, and iOS/Android checks. Consolidate further CSS only when those checks identify a concrete conflict; avoid a redesign or another architectural/performance rewrite.
