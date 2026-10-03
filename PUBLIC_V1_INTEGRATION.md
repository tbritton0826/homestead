# Public V1 integration with current main

Integration branch: `codex/public-v1-integration`.
Main baseline: `ddb0fcc` (account-playback merge). Public V1 tip: `105cf17`.
Common ancestor: `44e24c8`. Pre-polish snapshot: `74bb931`.

This is a two-parent merge preserving both histories. Main was not reset, pushed, or merged into. Version remains **0.6.8.64**; dependency versions and package-lock.json remain exactly as on main.

## Reconciliation

The initial merge produced **54 conflicts**, primarily older snapshot add/add conflicts. Reviewing the graph and comparing the five completed polish commits against their snapshot identified 49 intentional V1 paths. Those changes were reconciled against current main using a three-way comparison with the snapshot as the content baseline. Older snapshot differences outside that implementation were excluded so they could not roll back newer main work. All 195 main files outside these changes and the four additional test-harness reconciliations retain main's contents and tracked file modes. No tracked main file was deleted.

| Conflict group | Semantic resolution |
| --- | --- |
| `src/App.jsx` | Retained main's account-aware playback wiring, Home music lookup, bounded recent YouTube selection, shared media-index loader/version guard, Free integration gates, recipe storage status, mobile navigation and stylesheet. Applied V1 appearance, derived Music/search caches, progressive grids, visual/accessibility fixes, and deferred profiles. Replaced main's bare lazy/Suspense model wrapper with the V1 loading/error/retry boundary. |
| Startup overlap within App | The V1 profile loader uses main's `loadMediaIndex`, so startup and request status share the same index request. Profile enrichment only publishes the media index initially; later completion cannot roll back a newer index from main's request refresh. Added regressions for coalescing, explicit refresh, and prevention of late index replacement. |
| `src/App.css` and shared appearance/modal components | Main App.css matched the pre-polish snapshot after EOL normalization, so the reviewed V1 changes were applied without discarding newer main CSS. Main's separate `mobile.css` remains unchanged and imported after the legacy/V1 styles. Retained focus trapping/restoration, nested dialogs, bounded image fallback, long-content fixes and buffered appearance previews. |
| `server.cjs` | Applied only the V1 appearance API changes: preserve scope identity and support replacing explicit overrides on reset/save. Retained main's recipe transactions/migration/recovery, compressed/conditional media-index responses, cached Seerr discovery, Free feature gates and other endpoints. Server diff against main is limited to the appearance implementation. |
| `src/server/next-version.cjs` | Retained the active main implementation exactly, including authenticated account playback registration, owner setup, account privacy and version 0.6.8.64. Did not introduce the obsolete root-level snapshot copy. |
| `package.json` and lockfile | Kept release 0.6.8.64, main scripts, Docker checks, release-64 checks, all existing dependencies and the exact main lockfile. Added the V1 test scripts and combined them with main account/Home/recipe and retained library/search/playback tests in the full suite. |
| Dockerfile, compose example and `.gitignore` | Kept main's dependency install before production mode, build then prune, release version, runtime configuration, compose content, security/runtime exclusions and legacy-file exclusions. Main already anchored `/data/`; the JSON collection/timeline fixtures already existed on main and remain identical. |
| Test add/add conflicts | Retained main's active server paths, version and stronger owner/authentication fixtures. Applied V1 appearance/hook assertions and lazy-loader harness support. Updated stale extraction to normalize CRLF and use current main's YouTube helper/status-route boundary; retained behavioral assertions. Fixed the NFL fixture clock rather than changing production filtering. |

## Main functionality preserved

- `81db7ea`: authenticated account playback persistence, isolation, validation, completion and bounds.
- `fcfdd07`: phone headers/cards, touch navigation, safe-area padding, input focus sizing, active-page accessibility and reduced-motion rules.
- `4bb6c3f`: portable recipe metadata/categories/artwork, migration, backup recovery, atomic writes, concurrent saves and storage diagnostics.
- `b8e60aa`: cheaper Home derivation, on-demand music enrichment, shared startup index fetches, conditional/gzip index transport and Seerr cache/coalescing.
- `83c5651`, `4dd264d`, `d9cbbc5`: Free 0.6.8.64 entitlements, owner setup, Docker release/version/dependency-order fixes, Windows install assets and Community Apps configuration.
- All earlier main commits remain ancestors through the merge's first parent.

## Public V1 functionality preserved

All five completed batches (`7b9f103`, `9a6ea75`, `9a6523a`, `b55ba57`, `105cf17`) are represented in the integrated content and merge history:

- Explicit appearance overrides, inheritance/reset, account/device/library/page scope isolation, ordered saves and retry/error handling.
- Buffered live appearance preview, progressive library rendering, memoized Music normalization/grouping/artwork and cached local search corpus with immediate typing.
- First-use model/calendar/EPUB/HLS/scanner loading with loading/error/retry/cancellation handling; early profile lists with deferred bounded enrichment and edit preservation.
- Public visual/responsive polish, dialog focus/keyboard/restoration, nested menu handling, image fallback/viewer limits, long content, recipe navigation and upload outcome/same-file retry fixes.
- Historical performance, visual and QA reports and their fixtures/tests. Their measurements describe the original polish runs; this document records integration validation separately.

## Validation

- `npm run test`: passed after reconciliation, then passed again after the final startup fix.
- `npm run test:full-pass`: passed with **52 script commands**, including V1 appearance/responsiveness/startup/QA; main account playback, Home and recipe tests; release 40–64; calendars, subscriptions/plugins; and retained music/books/search/collections/YouTube/account routes. Home has 7 runtime tests; recipe storage has 10 runtime tests.
- `npm run test:docker-release`: passed.
- `npm run test:requests`: passed.
- `node --check server.cjs` and `node --check src/server/next-version.cjs`: passed.
- `git diff --cached --check`: passed; no unresolved conflict markers or index entries.
- Production-browser smoke checks in a disposable copy with synthetic fixtures: desktop Movies/Music navigation and totals at 1440×900; mobile Home/Movies at 390×844; no horizontal document overflow; 53px bottom navigation controls and active `aria-current`; Home single-column layout; immediate search results, Escape closure and launcher focus restoration; appearance scopes/controls and dismissal. Browser tab closed, viewport restored, temporary servers stopped.

### Final production build

`npm run build`: **passed** (Vite 8.0.16, 936 transformed modules).

| Output | Size | gzip |
| --- | ---: | ---: |
| Initial JS | 1,749.61 kB | 433.41 kB |
| CSS including preserved main mobile rules | 762.96 kB | 127.54 kB |
| Calendar | 265.48 kB | 76.80 kB |
| EPUB | 345.77 kB | 103.66 kB |
| Barcode/scanner | 436.28 kB | 115.28 kB |
| HLS | 509.70 kB | 157.63 kB |
| Model viewer | 967.37 kB | 262.61 kB |

The heavy features remain deferred. The build still emits the existing large-chunk advisory; it is not an error. No dependency upgrade or broad CSS rewrite was introduced.

## Remaining differences and limits

No unresolved merge conflicts or known integration-specific behavior differences remain in the tested paths. Main's release 0.6.8.64 and current implementations take precedence over older snapshot release/packaging copies, while the completed V1 behavior is retained.

An additional `npm run test:free-preview` check fails before assertions because it references **`scripts/release/build-free-preview.ps1`**, which is absent from both main and the public-polish branch. The missing builder was not introduced or hidden by this merge. Docker release, release-64 Free integration enforcement and subscription tests pass; Windows Free-preview packaging cannot be verified until that separate source file is restored.

Browser checks used synthetic data on Windows. Native iOS, a real Docker image build, live media playback/provider services, camera permissions and a production user's library were not exercised in this integration run. Existing V1 reports retain the earlier detailed feature checks; they are not presented as newly repeated here.

## Original conflicted paths

- `.gitignore`
- `Dockerfile`
- `docker-compose.media.yml`
- `package-lock.json`
- `package.json`
- `scripts/test-0.6.8.40-pass.cjs`
- `scripts/test-0.6.8.41-pass.cjs`
- `scripts/test-0.6.8.42-pass.cjs`
- `scripts/test-0.6.8.43-pass.cjs`
- `scripts/test-0.6.8.44-pass.cjs`
- `scripts/test-0.6.8.45-pass.cjs`
- `scripts/test-0.6.8.46-pass.cjs`
- `scripts/test-0.6.8.47-pass.cjs`
- `scripts/test-0.6.8.48-pass.cjs`
- `scripts/test-0.6.8.49-pass.cjs`
- `scripts/test-0.6.8.50-pass.cjs`
- `scripts/test-0.6.8.51-pass.cjs`
- `scripts/test-0.6.8.52-pass.cjs`
- `scripts/test-0.6.8.53-pass.cjs`
- `scripts/test-0.6.8.54-pass.cjs`
- `scripts/test-0.6.8.55-pass.cjs`
- `scripts/test-0.6.8.56-pass.cjs`
- `scripts/test-0.6.8.57-pass.cjs`
- `scripts/test-0.6.8.58-pass.cjs`
- `scripts/test-0.6.8.59-pass.cjs`
- `scripts/test-0.6.8.60-pass.cjs`
- `scripts/test-0.6.8.61-pass.cjs`
- `scripts/test-0.6.8.62-pass.cjs`
- `scripts/test-0.6.8.63-pass.cjs`
- `scripts/test-auto-match-photos.cjs`
- `scripts/test-bindery-lidarr-integration.cjs`
- `scripts/test-calendar-sources-pass.cjs`
- `scripts/test-full-public-pass.cjs`
- `scripts/test-media-polish-pass.cjs`
- `scripts/test-media-search-pass.cjs`
- `scripts/test-music-books-pass.cjs`
- `scripts/test-music-polish-pass.cjs`
- `scripts/test-next-version.cjs`
- `scripts/test-person-discovery-pass.cjs`
- `scripts/test-plugin-runtime-compatibility-pass.cjs`
- `scripts/test-request-collections-pass.cjs`
- `scripts/test-youtube-player-pass.cjs`
- `server.cjs`
- `src/App.css`
- `src/App.jsx`
- `src/components/ArtworkPicker.jsx`
- `src/components/BookMetadataMatchModal.jsx`
- `src/components/BookSeriesAppearanceEditor.jsx`
- `src/components/ItemFixMatchModal.jsx`
- `src/components/PhotoLibraryPicker.jsx`
- `src/components/PhotosLibraryPage.jsx`
- `src/components/ProfileToolPortal.jsx`
- `src/components/adult/AddAdultProfileModal.jsx`
- `src/server/next-version.cjs`
