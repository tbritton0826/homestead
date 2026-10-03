# Public startup and derived UI performance

Branch: `codex/public-v1-polish`. Baseline: `9a6ea75` (the completed responsiveness batch). This is a separate performance commit; no merge or push was performed.

## What was measured

The local browser harness uses 2,000 movies, 1,000 TV records, 500 books, 500 music artists/tracks, and 300 YouTube creators. Grids still mount 120 cards. Search measurements open an empty global search and type `Sample` as six native input events, with Movies or Music visible underneath. Profile startup adds 30 profiles in each of personal, celebrities, and performers; each metadata response takes 80 ms.

Interaction and profile samples use development React StrictMode and the React Profiler. Production startup uses the actual built JS without React instrumentation, a 1440×900 viewport established before navigation, matching public assets/configuration, and Movies restored through the app's existing navigation storage. First-contentful-paint includes the loading screen; grid readiness measures the first Movies grid DOM. These are single local samples, not statistical guarantees or real-library SLAs. Input p95 from six events is effectively the worst event.

Raw counters are in [public-startup-profile-measurements.json](C:/Codex/homestead-public/scripts/public-startup-profile-measurements.json). The original incomplete-public-assets baseline and intermediate runs remain separately identified there; the primary production comparison uses the corrected matched baseline. Source/package ownership and emitted bytes are in [public-startup-bundle-analysis.json](C:/Codex/homestead-public/scripts/public-startup-bundle-analysis.json).

## Original bottlenecks and implementation

1. **Startup eagerly evaluated five feature dependency graphs.** The original entry had no dynamic imports. Largest source contributions included Three (1.20 MB), HLS (960 KB), ZXing library (812 KB), EPUB (229 KB plus JSZip 205 KB), and FullCalendar core (280 KB plus its plugins). These are rendered source lengths, not additive minified/gzip attribution. Model viewing and calendar rendering now use lazy component boundaries. EPUB, HLS, and scanner engines use shared, cached dynamic loaders at first use. PDF and native HLS paths bypass their unused engine. Manual/Zebra code input needs no camera decoder. Dependencies and lockfile are unchanged.
2. **Music rebuilt full datasets on unrelated renders.** Normalization, artist/album grouping, sorting, artwork request records and track aggregation ran for all 500 fixture tracks while only 120 artist cards were mounted. Artists also repeatedly searched/filtered entire track and folder arrays. The expensive datasets now have explicit memo dependencies, and artist/folder maps replace repeated full scans. Source or metadata changes invalidate normalization; artwork provider/priority changes invalidate artwork derivations without normalizing tracks again. No blanket `React.memo` was added.
3. **An empty plugin-search reset invalidated the previous search cache.** Every query change replaced an already-empty array with another empty array, rebuilding the owned corpus and artwork despite the earlier memoization. Empty resets now preserve identity. Search input stays immediate, and enabled-plugin and remote-search requests retain their existing timing, results and permissions.
4. **Profile lists waited for all metadata pipelines.** Three library pipelines ran before publishing their lists, and StrictMode replay duplicated startup requests. One loader per mounted account now publishes index-backed names/artwork/list records immediately and hydrates six profiles at a time. Completed libraries publish together; selected profiles are prioritized and published immediately. An initial timer-batched version still caused expensive active-page renders, so it was replaced by library-completion publications. The final loader preserves original row order, canonical IDs, fallback paths and metadata merging. It retains edits/new rows and does not resurrect deleted rows. Pending detail selection shows loading UI until its full record is ready, preventing edits to provisional defaults. The index and each enrichment job start once across StrictMode subscriptions; existing static/canonical fallback requests are retained.

## Bundle and chunk changes

Vite build output, decimal kB:

| Asset | Before | After | After gzip |
|---|---:|---:|---:|
| Entry JS | 4,260.58 | 1,740.05 | 430.09 |
| Entry gzip JS | 1,144.43 | 430.09 | — |
| CSS | 748.61 | 748.61 | 124.78 |
| 3D viewer, deferred | Included in entry | 967.37 | 262.61 |
| HLS, deferred | Included in entry | 509.70 | 157.63 |
| Barcode engine, deferred | Included in entry | 436.28 | 115.28 |
| EPUB, deferred | Included in entry | 345.77 | 103.66 |
| Calendar, deferred | Included in entry | 265.48 | 76.80 |
| Bundler shared helper | Included in entry | 1.08 | 0.62 |

The entry shrank about **59%**, and its reported gzip shrank about **62%**. Initial JS also includes the 1.08 kB shared helper and the unchanged 289-byte PWA register script. The production resource log confirms none of the five feature chunks were fetched during initial Movies startup. The ownership analysis found **zero duplicated rendered modules**. The small shared helper is automatic bundler deduplication; no tiny feature was split merely to increase chunk count. Loading all features still downloads roughly the original total JS, plus a small splitting/loader overhead.

The analyzer's gzip estimates use Node zlib level 6 and are labeled separately because Vite's reporter produces slightly different estimates. Build-reported gzip values above are used consistently for before/after comparisons.

## Before and after browser results

| Scenario / metric | Before | Final changed version |
|---|---:|---:|
| Production first-contentful-paint | 172 ms | 112 ms |
| Production first Movies grid | 249 ms | 157 ms |
| Production tasks over 50 ms | 1 / 74 ms total | 0 / 0 ms total |
| Music navigation: derivation total | 151 ms | 68 ms |
| Music navigation: normalization calls | 2,000 | 1,000 (StrictMode initial calculation) |
| Music navigation: React render total | 263 ms | 215 ms |
| Music navigation: worst long task | 153 ms | 162 ms |
| Typing with Music visible: derivation total | 868 ms | 1 ms |
| Typing with Music visible: normalization calls | 14,000 | 0 |
| Typing with Music visible: artwork derivations | 51,600 | 0 |
| Typing with Music visible: React render total | 1,491 ms | 306 ms |
| Typing with Music visible: long tasks | 14 / 1,538 ms total | 2 / 141 ms total |
| Typing with Music visible: input-to-frame p95 | 133 ms | 79 ms |
| Typing with Movies visible: corpus work | 217 ms | 2 ms |
| Typing with Movies visible: artwork derivations | 51,600 | 0 |
| Typing with Movies visible: React render total | 514 ms | 217 ms |
| Typing with Movies visible: long tasks | 3 / 219 ms total | 1 / 93 ms total |
| Typing with Movies visible: input-to-frame p95 | 82 ms | 93 ms |
| Profile lists first published, all three libraries | 6,011 ms | 423 ms |
| Profile metadata complete, all three libraries | 6,011 ms | 3,490 ms |
| Profile metadata requests | 360 | 180 |
| Profile startup: root renders | 48 | 38 |
| Profile startup: Movies renders | 18 | 16 |
| Profile startup: React render total | 586 ms | 446 ms |
| Profile startup: long tasks total | 601 ms | 403 ms |

Music's repeated derivation and search cache invalidation were removed. Its first-use mount remains costly: the worst task did not improve in that navigation sample. Movies search did less total work but its worst input event increased by 11 ms; no across-the-board input-latency improvement is claimed. Unrelated root/result rendering remains observable even when derivation work is cached. The final profile sample includes cold loading of the newly edited development module; earlier warm intermediate list timings were faster, but the conservative final value is reported above.

## Lazy feature safety

Desktop (1440×900) and mobile (390×844) viewport fixture checks covered first use, visible loading status, close/reopen, direct fixture URLs and refresh restoration for all five features. The actual app Calendar route also rendered its weekly view after navigation and reload. A local valid STL produced a canvas; a local EPUB displayed its chapter through the actual BookReader; a six-second local HLS video reached readyState 4 and its full duration through the actual LiveTvPlayer; ZXing decoded a generated QR into `fixture-code`. The blank-image path also returned its expected no-code status.

A deliberate calendar import failure reached an error boundary without a retry loop. Manual Retry demonstrated browser caching of failed module URLs; explicit **Reload app** recovered the same selected feature. Calendar/model boundaries offer Retry and Reload; HLS offers Retry and Reload; reader/scanner import errors expose reload recovery. Failed loader promises clear, fulfilled imports are shared across repeated opens, and no cache-busting duplicate chunks are created.

Tests execute the actual EPUB, HLS and camera setup functions with deferred imports to verify cancellation, rejected chunks, PDF/native bypass, cleanup and late scanner callbacks. A scan arriving before camera setup completes now safely stops its eventual controls. Native Safari HLS is covered by the bypass test, not a Safari device run. Physical camera permission/capture and Zebra hardware were not exercised. The app's existing `library` URL parameter is an output of persisted navigation, not a standalone input router; this behavior was preserved. Fixture deep links explicitly select features.

## Files changed

- [App.jsx](C:/Codex/homestead-public/src/App.jsx): loading boundaries/engines, Music derivations/maps, empty search resets, startup subscriptions and pending detail UI.
- [CalendarView.jsx](C:/Codex/homestead-public/src/components/CalendarView.jsx): calendar dependency boundary with the original plugins and props.
- [LazyFeature.jsx](C:/Codex/homestead-public/src/components/LazyFeature.jsx) and [feature-loaders.js](C:/Codex/homestead-public/src/utils/feature-loaders.js): shared first-use loading, fallback, explicit retry/reload recovery.
- [profile-startup.js](C:/Codex/homestead-public/src/utils/profile-startup.js): coalesced index/enrichment, selected-item priority, completion publications and edit-safe list merging.
- [test-public-startup-pass.cjs](C:/Codex/homestead-public/scripts/test-public-startup-pass.cjs): concurrency/publication/edit/canonical-ID safety, actual Music derivation invalidation and deferred engine lifecycle tests.
- [test-media-polish-pass.cjs](C:/Codex/homestead-public/scripts/test-media-polish-pass.cjs): EPUB mock adapted to the new loader.
- [profile-public-ui.mjs](C:/Codex/homestead-public/scripts/profile-public-ui.mjs) and [profile-feature-safety.jsx](C:/Codex/homestead-public/scripts/profile-feature-safety.jsx): disposable synthetic profiling and feature fixtures, excluded from the public entry/build.
- [analyze-public-bundle.mjs](C:/Codex/homestead-public/scripts/analyze-public-bundle.mjs): reproducible emitted chunk and package ownership analysis.
- [package.json](C:/Codex/homestead-public/package.json): adds `test:startup` and a default focused public `test` aggregate; dependency versions are unchanged.
- This report and the two measurement JSON artifacts named above.

CSS, server API contracts, previous appearance behavior and progressive grid behavior were preserved. No state-management framework or dependency upgrade was introduced.

## Validation

Passed on the final source:

- `npm run build` (the entry, ModelViewer and HLS still produce the standard >500 kB chunk warning).
- `npm run test` twice consecutively. The new aggregate runs appearance, responsiveness, startup, media-polish and retained full-public tests. It is not an alias for every historical repository test.
- Additional relevant checks: unified-profile-overlay, family-profile-tree, request-search-again, plugin-host-ui, adult-metadata-service, adult-metadata-coverage and the 0.6.8.60/.61/.62/.63 regression scripts.
- `git diff --check` and unchanged CSS/lockfile inspection.

Four older standalone tests were also run and fail identically when replayed with the baseline App source: music-books and music-polish require stale package version `0.6.8`; media-search lacks `activePlugin` in its VM fixture; library-scroll evaluates an unstripped ESM import as a script. They were not rewritten as part of this performance batch. The default public test aggregate passes; the legacy test collection should not be represented as universally green.

To reproduce: run the local API with `PORT=7313` and a disposable `MEDIA_ROOT`, then `node scripts/profile-public-ui.mjs` (port 7314). `HOMESTEAD_PROFILE_PROFILES=30` enables delayed profile fixtures; `HOMESTEAD_PROFILE_APP_SOURCE` replays a saved baseline App; `HOMESTEAD_PROFILE_DIST` serves a complete saved production build. The feature fixture is `/__feature-check?feature=calendar` (or model/epub/hls/scanner). Optional `HOMESTEAD_PROFILE_FIXTURES` points to a directory containing a local `fixture.m3u8` and its `fixtureN.ts` segments. `node scripts/analyze-public-bundle.mjs` reports the current graph without writing a production build. Never proxy a live installation for synthetic profiling.

## Remaining costs

The 1.74 MB entry still contains the app's eager page/UI code; the 748.61 kB stylesheet remains global. The synthetic startup media index itself is 2.45 MB. First-use feature chunks are necessarily substantial, particularly 3D. Initial Music derivation and card mounting remain measurable, and root/search-result rendering still produces occasional long tasks despite a reused corpus. Real libraries, mobile hardware, camera capture and Safari playback require device-specific measurements before stronger latency claims. Broad CSS cleanup, style-driven App decomposition and a new state framework remain outside this batch.
