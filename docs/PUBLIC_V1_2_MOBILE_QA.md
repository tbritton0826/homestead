# Public V1.2 mobile polish handoff

Both the server/web repository and the companion repository use branch `codex/public-v1-2-mobile-polish`. The web branch starts at upstream main `d8f8e42`, including merged Public V1, commercial, and artwork-retention work. The companion starts at its latest local main `482b275`. No production files, installed app, deployment, or main branch were changed.

## Implemented fixes

- Native photo pages and the pager use explicit current viewport dimensions and clipping. Local image scroll views disable bounce, fit the image's actual aspect ratio, center letterboxing, and reset on image/viewport changes. Pinch/double-tap zoom remain; panning activates only above fit scale and swipe paging remains at fit scale.
- Native profile metadata uses the existing library tab capsule styling with SF Symbols, biography navigation, birthday aliases, nested body fields, clothing sizes, and available classifications. Web profiles reuse library-tab pills. Missing fields are omitted. Intimate values require authorized Adult/body-details access and are excluded for child/minor profiles; children retain generic metadata. Web desktop cards remain available.
- Native recipe detail has a trailing pencil opposite native Back. It opens the existing form in edit mode, rechecks access, uses PATCH, preserves artwork/favorites/visibility/timers, and updates detail, library, and search results from the saved response. Web detail now offers editing for ordinary recipes using the existing wizard, while Quick Instructions retain their existing editor. Read-only and account restrictions are enforced. The existing PATCH route now also saves category, tags, and source-link changes safely.
- Native views rely on the existing tab bar and Global Add safe-area inset instead of duplicate fixed bottom padding. Embedded Family pages hide duplicate web navigation and use modest content clearance. Web fixed TV scrollers reserve bottom-navigation space in portrait/landscape; photo and recipe overlays stay within their viewport/safe-area bounds.
- TV detail already had Public V1 inheritance and persistence. Its fixed background layer now consumes the existing scoped image, opacity, blur, fit, position, and preview variables. Item appearance opens at the existing page scope. Default TV artwork behavior remains unchanged when no custom background is selected. Poster sizing and panel color use existing appearance settings.

## Validation performed on Windows

- 8 focused web tests: data-driven pills, child/unauthorized privacy, recipe draft preservation, actual PATCH handler persistence/reopened storage, denied edits, category preservation, explicit zero appearance values, and page/device override preservation.
- New helper/server code lint; production web build; server and fixture JavaScript syntax checks. Existing large-bundle warnings remain.
- 14 companion JavaScript bridge/wiring checks passed. Six new XCTest methods cover fit geometry, rotation dimensions, metadata schemas/icons/privacy, account access, preserved recipe payload/timers, and read-only permissions. These Swift tests have not been run locally.
- Synthetic browser fixtures tested real web components at 390 x 844, 844 x 390, and 1365 x 900. Pencil/editor/save/return worked; read-only detail omitted the pencil. Profile overflow remained local (portrait pill region 346 px, scroll content 534 px; document width and scroll width both 375 px). Child pills contained only Bio and Birthday. Photo selection survived viewport changes with one centered contain-fit image. Portrait viewer controls ended at 828 px in an 844 px viewport. TV used the selected image, opacity 0.45, blur 7 px, panel alpha 0.3/blur 8 px, and 92 px mobile bottom clearance without horizontal page overflow.
- Browser fixtures use synthetic data and mocked API responses, never production household data. Run `node scripts/mobile-v12-browser-fixture.cjs` from the web checkout and open `http://127.0.0.1:7377/__mobile-v12` to reproduce.

## Pending Mac CI / toolchain validation

This machine has no Swift or Xcode installation. Run `swift test` and the existing unsigned iOS Simulator `xcodebuild` command on a Mac. The companion CI now runs bridge checks and Swift/model compilation on pull requests. No native compilation or simulator run is claimed as passed.

## Pending Manual Device Testing

- Install the updated companion after the matching server changes are available.
- iPhone/iPad: swipe rapidly through portrait/landscape/mixed-size images; pinch, pan, double-tap, hide/show controls, close/reopen, and rotate while zoomed. Confirm settled pages never reveal an adjacent image.
- Profile pills: swipe horizontally, change text size/VoiceOver, tap Bio from another tab, test missing metadata, restricted Adult/body-detail accounts, child profiles, and hiding Adult visibility.
- Recipe detail: Back, pencil, Cancel, Save, denied access, offline/error retry, quick-step timers, unchanged artwork/favorites/visibility, search results, and reopening after server/app restart.
- Check home-indicator/notch clearance, keyboard and form scrolling, tab bar/Add-button clearance, native and embedded Family pages, and portrait/landscape transitions on actual devices.
- Confirm native device/account appearance preferences survive app relaunch; confirm TV global/library/item/device settings and explicit overrides survive navigation and refresh in Safari and embedded contexts.

No real-device touch, native rendering, or installed-app behavior is marked passed. The fixture browser uses Chromium, not iOS WebKit.

## Final automated results — October 14, 2026

Passed `npm run test:full-pass`, `npm test`, `npm run test:mobile-v12` (8 tests), `npm run lint:mobile-v12`, and `npm run build`. Existing recipe source assertions were updated to recognize the shared add/edit wizard and the detail overlay hidden while editing. Passed `node --test Tests/*.test.cjs` in the companion checkout (14 tests). Both repositories passed `git diff --check`. Swift/Xcode compilation and device testing remain pending as documented above.
