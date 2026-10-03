# Public UI responsiveness batch — 2026-10-03

Branch: `codex/public-v1-polish`. Baseline: appearance reliability commit `7b9f103`. No merge, push, dependency upgrade, broad CSS cleanup, or App decomposition. The live installation on H: was not modified.

## Runnable checkout restored before optimization

`App.jsx` imports `shared-collection-presets.json` as static smart-collection seeds and `mcu-timeline.json` as ordered timeline sections/entries. No generator was found. Both canonical files exist in Git commit `83c565179f97dc34338941a0afe7fa2c4433c687`, remote main, and the original source folder, with identical Git blob hashes:

| File | Canonical blob | Shape |
| --- | --- | --- |
| `src/data/shared-collection-presets.json` | `18eb9d257c90c8f00a391a79e2818a7bd6a20434` | 8 presets with id, name, description, terms, exactTerms and defaultDisplay |
| `src/data/mcu-timeline.json` | `948787fa556895620054a3ee0e1ee9e2701bb565` | 8 sections with id, title, range and entries containing title/detail/date/type |

Recovered those exact files. The unanchored `.gitignore` rule `data/` also hid `src/data`; narrowed it to `/data/`, retaining runtime-state and explicit private-source exclusions. No replacement data was invented. Dependencies were installed from the existing lockfile with `npm ci --ignore-scripts --no-audit --no-fund`; the lockfile and versions were not changed. Node 24.15.0 and locked Vite 8.0.16 were used. The prerequisite production build passed before performance work.

## Measurement method and limits

The real React app ran in the Codex in-app Chromium browser, using Vite development StrictMode and React Profiler. An isolated public-checkout API server on localhost:7313 supplied actual APIs and appearance persistence. `scripts/profile-public-ui.mjs` served the app on localhost:7314, replacing media indexes with synthetic records: 2,000 movies, 1,000 TV shows, 500 books, 500 music artists with audio tracks, and 300 YouTube creators. Small local PNG artwork avoided private media and network variability. Both paired captures used identical fixtures and instrumentation; baseline App source came from `7b9f103` without reverting the working tree.

Captured React commit durations, component function-call counts, main-thread long tasks, native input-to-next-animation-frame latency, synchronous storage writes, DOM counts and loaded grid images. Function counts include StrictMode's repeated calls; input-to-frame is a responsiveness proxy, not a paint trace. A subsequent desktop regression used 1440×900 and mobile used 390×844. Timing varies by machine, cache and background browser work. These are synthetic local measurements, not production-user percentiles. No isolated layout/paint/compositor trace was available, so backdrop blur was not blamed or changed.

Raw captured summaries: `scripts/public-ui-profile-measurements.json`. Main comparisons below were captured after the core preview/grid/search changes; later bounded-alpha and mobile-root refinements were separately verified.

| Comparable interaction | Before | After core changes |
| --- | ---: | ---: |
| Initial Movies: total React time across 3 commits | 440 ms | 242 ms |
| Initial Movies: largest React commit | 403 ms | 225 ms |
| Initial Movies: DOM nodes | 8,168 | 650 |
| Initial Movies: mounted grid images | 2,000 | 120 |
| Initial Movies: loaded grid images | 2,000 | 24 |
| Poster-width slider, 10 native ArrowRight inputs: input-to-frame p95/max | 194 ms | 17 ms |
| Same slider: total React time | 684 ms | 88 ms |
| Same slider: root / Movies function calls | 30 / 28 | 4 / 4 |
| Same slider: main-thread long tasks | 13 | 0 |
| Same slider: synchronous storage writes | 4 | 1 |
| Search, six native typed characters `Sample`: input-to-frame p95/max | 299 ms | 29 ms |
| Same search: total React time | 3,296 ms | 945 ms |
| Same search: main-thread long tasks | 19 | 6 |

Resource timing's default buffer filled during some runs. Its `artRequests` field is incomplete and is not evidence of exact request savings. Loaded-image/DOM counts above are actual observed DOM state. Artwork byte size, decode cost and real-server latency need a representative production library for further measurement. Native continuous slider drag also remained live and saved/reopened its final 292px value; its automation overhead makes the keyboard sample the more useful paired timing comparison.

## Optimizations, evidence and behavior

### Appearance previews

**Original/root cause:** every numeric input updated root React appearance state and repeated visible-library work. The before sample measured 30 root calls and 28 Movies calls for ten inputs, plus 13 long tasks.

**Files:** `src/App.jsx`, `src/utils/appearance-preview.js`, `scripts/test-public-ui-responsiveness.cjs`, and the existing appearance test's studio VM helper import.

**Implementation:** editor-local draft values provide immediate labels/dialog styling, and the existing scope resolvers produce temporary numeric CSS variables directly on content/detail/sidebar elements. Pointer-held input commits only on release; keyboard changes commit after 180ms idle. Blur, Close, Done and scope changes flush the final changed fields through the existing persistence queue. Reset cancels pending preview timers before the existing reset operation. Preview does not write application state or storage. Non-numeric controls keep their existing save path. Global/library/page/album inheritance still uses the prior resolver and explicit overrides.

**After/testing:** paired timing is in the table. Browser close/reopen showed the correct final value and Saved status; mobile 190→192px closed/reopened correctly, and Reset worked. Appearance regression tests cover persistence, failed save/retry, reset races, profile/account separation, album legacy migration and inheritance. New tests cover held-pointer release, captured stale timer cancellation, idle save, close flush, numeric CSS mapping, and actual root preview resolution without mutating saved scope data. Parent preview respects explicit child-page overrides and album scope.

**Remaining:** CSS geometry, blur and painting still cost work on every visual input. Color controls retain the original update cadence. No blanket memoization or redesign was applied.

### Shared incremental grids and bounded alphabet jumps

**Original/root cause:** Movies mounted all 2,000 cards/images, TV all 1,000, Books all 500, and Music artists all 500. Photos already rendered incrementally; the new small shared component follows that approach without adding a virtualization dependency.

**Files:** `src/components/ProgressiveLibraryGrid.jsx`, `src/App.jsx`, focused responsiveness tests.

**Implementation:** first 120 cards, subsequent 120-card batches near the scroll boundary, and an accessible Show more fallback. Full datasets continue to drive totals, filtering, sorting and alphabet letters. Identity/order changes reset the visible batch; equivalent new objects retain expansion and show fresh metadata. Existing card classes, layout, appearance CSS and click handlers are retained. Desktop observes the scrolling main; mobile's content-sized main uses the viewport instead.

**Measured follow-up:** an initial implementation revealed the entire prefix for a distant Z jump, producing an exploratory 3,183ms React commit. That warranted a narrow memo: reuse unchanged card elements while expanding, invalidate on item/renderer changes, and reveal 120 cards per animation frame. The final 2,000-movie Z test had 16 React commits totaling 56ms, maximum 10ms, and one 52ms long task. This exploratory follow-up used an explicit desktop viewport and is not a controlled production speedup ratio. The requested Z card rendered, scrolled into view, and opened the correct detail page.

The mobile check exposed a content-sized main with equal client/scroll heights and all 2,000 cards mounted under the first observer-root implementation. The viewport-root correction was browser-verified: a fresh mobile load remained at 120 cards. Resizing from desktop can reveal one extra batch before the observer rebinds. No broad CSS changes were needed.

**Testing:** component behavior checks exercise intersection loading, mobile root selection, scoped alpha events, bounded distant jump/scroll, cancellation when a newer letter is selected, sort reset, filtered totals, new metadata objects and observer cleanup. Browser TV/Books/Music each initially had 120 cards. TV Title Z-A reordered correctly. Movies Title Z-A plus Comedy displayed the correct full 1,000-result total/order. Selecting a movie reached its real detail page; detail Back returned to the library. YouTube creator detail and Back worked.

**Remaining:** this is incremental mounting, not full virtualization. Scrolling through the entire library or jumping to its end eventually mounts the full prefix. Very large libraries will still accumulate DOM. Music's follow-up took 335ms total React time for 500 artists despite only 120 mounted cards, so its full-data derivation remains a bottleneck; no large music speedup is claimed. Books follow-up totaled 57ms. These secondary page timings are exploratory rather than matched before/after comparisons.

### Scrolling artwork and safe fallbacks

**Original/root cause:** Movies/TV and shared-collection grid artwork loaded eagerly. Books, Music artists and YouTube already used lazy loading. Poster/banner fallbacks referenced files absent from the public checkout and could repeatedly assign the same failed URL.

**Files:** `src/App.jsx`, `src/utils/image-fallback.js`, focused tests.

**Implementation:** native lazy loading and async decoding on scrolling movie/TV/collection artwork; async decoding added to existing lazy Music/YouTube images. Existing poster/banner candidates are attempted once, then a terminal inline SVG prevents repeated failed requests. YouTube's candidate chain and Music's existing fallback chain are preserved. Existing dimensions/aspect/layout classes remain. Hero and background artwork loading was not changed; no undocumented thumbnail API was introduced.

**Evidence/testing:** initial Movies loaded images fell from 2,000 to 24 with the combined chunking/lazy-loading change; those contributions are not independently attributed. DOM checks verified lazy+async on movie/TV/book/music scrolling cards. Fallback tests execute repeated errors and prove only two source changes. The retry-loop fix is a **CONFIRMED CODE ISSUE**; async decoding alone is a **LIKELY PERFORMANCE IMPROVEMENT**, with no isolated decode benchmark. YouTube retained 300 creators and its exploratory render had no long tasks, so it was not unnecessarily chunked.

**Remaining:** real artwork sizes, alternative thumbnail URLs and compositor cost require real-library traces.

### Focused local search cache

**Original/root cause:** typing rebuilt normalized records and artwork metadata, then filtered them during root renders. Six typed characters across 4,300 records measured 3,296ms React time and 299ms input-to-frame p95/max.

**Files:** `src/App.jsx`, focused responsiveness tests.

**Implementation:** memoize the active local corpus, artwork and normalized text against data/metadata/inventory/plugin/people sources and permissions, then filter it against current tokens. No input debounce was introduced. Closing/clearing search avoids retaining an active corpus needlessly. Existing remote-search effects and result navigation remain.

**After/testing:** paired search figures are in the table. Tests execute actual search declarations and verify reuse across typing plus permission/source invalidation and empty-input behavior. The existing artwork-scope test still fails at its pre-existing candidate assertion (see below); no candidate-building behavior was changed by this batch.

**Remaining:** root/list work and remote-search updates still produced six long tasks, largest 165ms, in the after sample. A broad search rewrite was intentionally outside this batch. An automation click on the global-search close control unexpectedly opened an underlying movie in both baseline and changed app; this pre-existing/automation interaction is unresolved, so normal close-click behavior is not claimed as verified.

## Validation

Passed after the implementation:

- `npm run build` (926 modules; CSS 748.61kB, JS 4,260.58kB; gzip JS 1,144.43kB).
- `npm run test:appearance`.
- `npm run test:responsiveness`.
- `test-auto-match-photos.cjs`, `test-0.6.8.46-pass.cjs` through `test-0.6.8.63-pass.cjs`, `test-quick-instruction-edit-poster-pass.cjs`, `test-plugin-host-ui-pass.cjs`, `test-unified-profile-overlay-pass.cjs`.
- `test:full-pass` passed appearance, responsiveness, full-public and .40–.44 checks before stopping at .45.
- `git diff --check`; Node syntax checks for the profiling harness and fallback utility.
- Browser desktop libraries, detail/Back, sorts/filter counts, card-size preview/save/reopen/Reset, mobile navigation/layout and appearance editor. Album/profile isolation and failure/retry behavior were covered by executable regression tests rather than fabricated real-media browser fixtures.

Known failures reproduced against baseline App source `7b9f103` with canonical JSON available:

1. `test-0.6.8.45-pass.cjs:17`: scanner function-extraction regex expects LF separators, but this Windows checkout has CRLF. Scanner was unchanged.
2. `test-artwork-scope.cjs:26`: existing `posterCandidates` assertion fails.
3. `test-request-collections-pass.cjs:69`: its VM omits `buildYouTubePlayerSource`, causing ReferenceError after the canonical smart-collection assertions pass.

These were not repaired as unrelated test cleanup. Build still warns about the large main JS chunk. App decomposition/code splitting, backdrop-filter/compositing changes, full-grid virtualization and Music derivation optimization remain future measured work.

## Reproduce profiling locally

Use a disposable public checkout with no live installation configuration. Build/run the actual API server there, using a checkout-local MEDIA_ROOT and PORT=7313; it creates disposable runtime state under ignored root `data`. Do not point this harness at a live media server. In a second terminal in the same checkout run:

```powershell
node scripts/profile-public-ui.mjs
```

Open `http://localhost:7314/?library=movies`. The Local synthetic profiling disclosure contains Reset measurements and JSON counters. Reset before each interaction; wait for the next 500ms panel refresh after finishing. For a baseline replay, save `git show 7b9f103:src/App.jsx` to a temporary JSX file, set `HOMESTEAD_PROFILE_APP_SOURCE` to that file's absolute path in the profiling-server terminal, restart the harness and reload the browser. Clear that environment variable before the changed-code run. Use the same viewport, data, cache conditions and interaction sequence. Ten ArrowRight inputs on Poster width and six typed characters `Sample` were the paired input samples. Do not mix initial setup/account hydration or unrelated interactions into a sample. Profiler code is injected only by this local harness; it is not in the production build.
