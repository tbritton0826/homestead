# Final UI polish verification

## Changes

- One two-step collection dialog for details/artwork/import/title search, then exact ordering. Backdrop clicks retain the draft; explicit Close/Escape asks before discarding changes. Save failures retain the draft. New drafts have unique IDs, including over local HTTP. Editing retains existing IDs and appearance fields.
- TV selections default to seasons, including season 0. Individual seasons can split into episodes and regroup while preserving authored episode order. Newly indexed episodes require an explicit Add action; missing saved episodes stay visible and cannot substitute another episode in playback.
- Quick Add/Remove Collection actions reconcile the saved sequence; newly added whole-series references remain readable and can explicitly switch to season arrangement in the editor.
- Watch order and membership persist together in the custom collection record. URL imports preview without changing saved orders; unmatched imported titles remain labeled unavailable. Retrieval is timed and bounded to 2 MiB.
- Smart suggestions are separate from saved collections/counts. Create opens an editable draft; Remove suggestion persists per account. Saved/converted groups suppress corresponding suggestions.
- Numeric collection counts outside Collections use the same saved/legacy group rules, exclude stale overrides, and expose loading/unavailable states. TV genre/year choices and sorting share one dialog; duplicate TV collection creation controls are removed.
- The right pane retains full timeline section heights. Virtual orders fill the available pane with one internal scrollbar.
- Grid construction is bounded before card creation, not just before DOM mounting. Movies/TV/Photos/profile cards use progressive loading; local artwork uses version-preserving image previews with original-artwork retry.
- Read-only Movie/TV count diagnostics explain merged folders, ISO/disc images, empty/artwork-only/unindexed/stale folders and unavailable storage. An unavailable root is never reported as empty or deleted.
- Native v3.19 (20) removes Family Home's repeated navigation cards. The existing permitted-section header menu remains.

## Completed checks (Windows, October 22, 2026)

- Production Vite build and default npm regression suite passed. Vite still reports the existing large-bundle warning.
- Seven new functional regressions cover season grouping, Specials, authored playback order/missing episodes, count/list parity, thumbnail revision URLs, filesystem diagnostics, atomic collection save/read and persistent account preferences.
- Existing grid regression now verifies the number of renderItem calls, not only mounted nodes.
- Isolated browser checks used the real Movies/TV pages with 3,002 generated movies, 502 series, book/author search and generated media. Verified create/save/reopen, exact episode edits reflected in the open detail, save-error retention, backdrop retention, Escape's discard prompt, fresh zero count, saved count, TV combined genre/year/sort, and sized preview URLs. No user library/VM data was used.
- Desktop right pane reached the final entry of a 121-row order via keyboard; virtual content remained bounded. The pane's usable list height increased from 260px to 638px at the tested desktop size.
- Dialog checks at 1024×768 and 390×844: internal body scrolls, footer remains reachable, no horizontal overflow. These are browser viewport checks, not native iPad validation.
- Native JavaScript/source suite: 55 passed, one existing skipped check. SwiftUI/Xcode compilation is unavailable on Windows.

## Performance evidence and limits

`node scripts/benchmark-library-grid.cjs` compares the actual pre-pass grid at commit 5bf8348 with this implementation. With 10,000 records and equivalent React cards, seven-run median card-construction time was 28.72ms before and 0.47ms after; initial constructed cards fell from 10,000 to 120. This isolates client construction; it is not an end-to-end page-load benchmark.

In the local Vite browser fixture, the first grid frame measured 140.0ms on a first test visit, 86.7ms on a warm repeat, and 100.8ms when switching to TV. These exclude module download/bootstrap and use one local cached fixture image. They do not establish a production loading target or measure NAS transport, distinct full-size artwork, slow networks, HEIC decoding, or an actual iPhone/iPad.

Production index/artwork transport, sustained connection recovery, and physical-device visual checks remain follow-up validation. Existing detail-return scroll/window behavior is unchanged. The wider settings roadmap remains deferred.

Run `node scripts/serve-ui-polish-fixture.mjs` for isolated UI reproduction and `npm run test:final-ui-polish` for the new regressions. Native users should run `bash scripts/validate-ios.sh` on the Mac before installing.

## Additional release verification (October 23)

The generated MCU Timeline List retained all eight sections at full content height (327–1,633px in the tested desktop view). The 675px right pane contained approximately 5,994px of timeline content; wheel scrolling reached the last Connected Multiverse Branches section without moving the left overview pane. The current public Windows installer is documented in [release verification](WINDOWS-UI-POLISH-RELEASE.md).

A separate existing limitation surfaced in this legacy built-in timeline view: its fuzzy title fallback can classify a missing numbered sequel as an earlier owned title in a sparse catalog. This pass does not change that matcher. New wizard orders use exact saved library/source IDs and leave ambiguous imported titles unmatched; the legacy matcher needs a separate correction before final v1.
