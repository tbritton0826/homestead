# Current delivery — v3.21 (22)

Improves connection recovery and adds complete TV episode cards with Sonarr
interactive search. The companion needs the matching server update for the new
episode API; older servers retain local playback with a recoverable warning.
See [V3.21-QA.md](V3.21-QA.md) for scope, permissions and verification limits.

Extract the complete source project, run `bash scripts/validate-ios.sh` on your
Mac, then build over the existing app with the same team/bundle identifier.
Sustained iPhone/iPad LAN/tailnet testing is still required.

# Previous delivery — v3.20 (21)

Collection details now open on the server's saved Watch Order, with a separate Titles tab. Saved sections, seasons and exact episode sequences are shown; season entries expand to their episodes, and missing episodes remain unavailable. The collection list follows the server's saved-only policy rather than mixing in unsaved automatic groups. See [V3.20-QA.md](V3.20-QA.md).

Extract this complete source ZIP into a new folder. Run `bash scripts/validate-ios.sh` on your Mac, then build and test NCIS Universe on iPhone and iPad. Windows source checks pass; Swift/Xcode/device acceptance remains pending. No additional server update is required.

# Previous delivery — v3.19 (20)

Removes the duplicate Family Home navigation cards. All enabled Family destinations remain available in the existing header menu. This is a small native follow-up to the server UI polish pass. See [V3.19-QA.md](V3.19-QA.md).

Extract the complete project and run `bash scripts/validate-ios.sh` on your Mac before installing. Xcode and physical iPhone/iPad validation are still required.

# Previous delivery — v3.18 (19)

Complete native companion source with connection/Tailscale compatibility improvements, Settings-controlled minimal poster metadata, shared pet-photo imports/membership and reviewed original moves. The matching server pass also compacts Photos album headers. See [V3.18-QA.md](V3.18-QA.md) for verification and the remaining Mac/iPhone/iPad checks.

Update the server from the reviewed v3.18 branch, extract this entire project, then run `bash scripts/validate-ios.sh` on the Mac before installing. Tailscale still needs a working network route and the correct HTTP port or trusted HTTPS hostname. The recurring five-minute connection failure remains subject to sustained device testing.

Historical delivery notes follow.

### v3.17 — connection recovery and library polish (build 18)

Extract the complete `Homestead-iOS-companion-v3.17.zip` fresh into `Homestead-Companion-v3.17`. This pass adds automatic connection recovery, external profile links, toggleable poster metadata and detected folder tabs, plus responsive audio controls. The matching web update adds folder tabs and a compact TCG settings card.

See [V3.17-QA.md](V3.17-QA.md) and [Server-Update/README.md](Server-Update/README.md). Swift compilation and native iPhone/iPad verification remain pending; run the included Mac validation before installation. Existing working book/Read Along behavior is retained.

### v3.16 — mobile parity Pass 2 (build 17)

Use the single complete `Homestead-iOS-companion-v3.16.zip`, extracted fresh into `Homestead-Companion-v3.16`. This pass adds movie Play/version cards and cast/related ribbons, TV/YouTube season pills, consistent playback choices, the native audio card and Read Along polish, poster metadata pills and the mobile Home Continue ribbon.

See [V3.16-QA.md](V3.16-QA.md) for evidence, remaining native checks and installation. Existing v3.15 server support is sufficient; this pass does not add server implementation changes. Mac/Xcode compilation and iPhone acceptance remain pending. EPUB reading progress remains on the device and account where it was saved.

# Homestead for iPhone and iPad

### v3.15 — first library/loading parity pass (build 16)

Use the single complete `Homestead-iOS-companion-v3.15.zip`, extracted fresh into `Homestead-Companion-v3.15`. Install the matching server update before using normal photo uploads and resized artwork previews.

Includes normal Photos in Media/Home, album selection/creation and photo import, separated normal/private photo routing, individual Adult video browsing and folder refresh, consistent loading cards and single-line selectors, contextual Add buttons, bulk EPUB download/render recovery and bounded media-opening retries. Original photos and native HEIC support are retained. Later-pass detail/player/transcoding work remains deferred.

See [V3.15-QA.md](V3.15-QA.md) and [server installation notes](Server-Update/README.md). Run `bash scripts/validate-ios.sh` on the Mac before installing 3.15 (16). Automated server/browser/source checks passed; Mac compilation, model tests and the reported iPhone book/audio behavior still need verification.

### v3.14 — pricing, card grids, reader and library polish (build 15)

Use the single complete `Homestead-iOS-companion-v3.14.zip`, extracted fresh into `Homestead-Companion-v3.14`.

This pass adds TCG poster grids and value/quantity pills, shared optional TCG Price Lookup pricing, safer EPUB loading, saved-group refresh/delete and preservation of unavailable group members, and a compact Home layout. Prior card-save repairs and all v3.13 features are retained. Server Settings → Integrations contains the optional pricing key setup; no key belongs in the iOS project.

See [V3.14-QA.md](V3.14-QA.md) for validation and remaining live-key/Mac/device checks. Install the matching GitHub server update, refresh the web page, and rebuild the app. The included Server-Update patch is a cumulative alternative for its documented older base, not a patch to apply over an already-updated GitHub checkout.

Run `bash scripts/validate-ios.sh` on a Mac before installing. Windows does not provide Swift/Xcode validation.


### Inventory printing form compiler repair (v3.13, build 14)

Use the single complete `Homestead-iOS-companion-v3.13.zip`, extracted fresh into `Homestead-Companion-v3.13`. The reported Swift type-check timeout in InventoryPrintingFields is addressed by separate identity, valuation, location and deck-link views. Picker choices are prepared as typed values outside view builders, and deck toggle bindings use an explicit Bool binding.

This is an app-only repair retaining the v3.12 TCG queue and library tabs. No further server changes are required beyond v3.12; the same server patch remains included for installations that still need it. See [V3.13-QA.md](V3.13-QA.md). Run `bash scripts/validate-ios.sh` on the Mac before installing. Windows source checks pass; Swift/Xcode compilation and device checks remain pending.

### TCG holdings and library tabs (v3.12, build 13)

Use the single complete `Homestead-iOS-companion-v3.12.zip`, extracted fresh into `Homestead-Companion-v3.12`. Install the matching server update before using the new TCG queue, physical locations, Wishlist and editable Music/YouTube groups. Keep the writable `/mnt/user/Inventory` → `/media/inventory` mapping. Details and validation: [V3.12-QA.md](V3.12-QA.md) and [Server-Update/README.md](Server-Update/README.md).

TCG supports name/code lookup, multiple queued printings, quantities/condition/photos per group, deck/binder/box/loose/custom storage, quantities by location, and quantity-preserving moves. Missing set/rarity quotes stay unavailable; manual estimates and purchase costs remain separate. Music has Songs, Artists, Music Videos, Albums and Playlists; YouTube has Creators, Series, Playlists and Collections. Manual groups support selection and ordered review before saving.

Server tests, lint and web build run on Windows. **Swift model tests, Xcode compilation and iPhone/iPad checks are pending.** Run `bash scripts/validate-ios.sh` on the Mac before installing. No server deployment or GitHub merge has been performed.

### Inventory wizard navigation repair (v3.11, build 12)

Use the complete `Homestead-iOS-companion-v3.11.zip`, extracted into `Homestead-Companion-v3.11`. Inventory wizard Back, Continue and Save now have an explicit independent button style so the form row cannot combine their actions. Required fields and all v3.10 card lookup/camera changes are retained. See [V3.11-QA.md](V3.11-QA.md).

This is an app-only fix. No additional server changes beyond v3.10 are required; its server patch remains included for installations that still need it. Run `bash scripts/validate-ios.sh` on the Mac before installing. iPhone/iPad navigation and Swift/Xcode validation remain pending.

### Yu-Gi-Oh lookup and card camera (v3.10, build 11)

Use the complete `Homestead-iOS-companion-v3.10.zip`, extracted into `Homestead-Companion-v3.10`. Card lookup accepts a printed set code by itself. Scan card with camera photographs the card face for the existing server recognition service; other Inventory items keep barcode scanning. Choose the suggested printing and review it before saving. **The matching server fix is required:** the provider removed an option Homestead was sending, causing searches to fail in both clients. See [V3.10-QA.md](V3.10-QA.md) and [Server-Update/README.md](Server-Update/README.md).

Server tests/build and the live public CORI-EN029 lookup passed. Run `bash scripts/validate-ios.sh` on the Mac; Swift/Xcode, real camera/OCR and an actual Inventory save remain pending. Older release sections below are historical.

### Native Inventory and Add wizard (v3.9, build 10)

Use the single complete `Homestead-iOS-companion-v3.9.zip`, extracted into `Homestead-Companion-v3.9`. More → Inventory now provides native browsing/search/details/editing, and + opens the item/Yu-Gi-Oh Add wizard with camera barcode lookup, card/printing search, photo recognition, photos and explicit review/save. The global Add hub also offers Inventory. **Install the matching server support separately** before using these APIs. See [V3.9-QA.md](V3.9-QA.md) and [Server-Update/README.md](Server-Update/README.md).

Run `bash scripts/validate-ios.sh` on the Mac before installing. Swift/Xcode, camera/device runtime and live provider/playback verification remain pending. Existing v3.8 audiobook fixes are retained; older release sections below are historical.

### Audiobook format recovery (v3.8, build 9)

Use the single complete `Homestead-iOS-companion-v3.8.zip`, extracted into `Homestead-Companion-v3.8`. This release recognizes ebook/audio sibling folders and always offers Check formats again after an empty lookup. The separate server repair is essential: it prevents ebook-only data from replacing audio parts and opens the web player when Listen is pressed. See [V3.8-QA.md](V3.8-QA.md) and [Server-Update/README.md](Server-Update/README.md). Run `bash scripts/validate-ios.sh` on the Mac before installing; Swift/Xcode/device validation is pending. Earlier sections below describe previous releases.

### Native pets, ComfyUI images, and audiobook lookup (v3.7, build 8)

Use the single complete `Homestead-iOS-companion-v3.7.zip`, extracted fresh into `Homestead-Companion-v3.7`. This includes the v3.6 biography/loading fixes, native pet creation/media uploads with folder selection, a separate ComfyUI Images screen, and server-side audiobook lookup reconciliation. Read [V3.7-QA.md](V3.7-QA.md) for validation and remaining checks.

**The included server support must be integrated separately for the new APIs. It has not been deployed.** [Server-Update/README.md](Server-Update/README.md) explains which single patch to apply. Older servers retain existing read-only pet browsing, existing book actions, and chat functionality.

Your ComfyUI address is `http://10.0.0.224:8188`. After the server update, open Homestead AI → Images → Image settings, enter that address, and Save and test connection. You can connect first with the workflow/node fields empty. To generate, add a trusted workflow exported from ComfyUI in API format and its positive text-prompt node ID. The desktop health check passed; reachability from the Homestead container and actual generation remain unverified. See the [ComfyUI server API documentation](https://docs.comfy.org/development/comfyui-server/comms_routes).

**Mac compilation and iPhone/iPad testing are pending.** Run `bash scripts/validate-ios.sh` on the Mac before installing. No Swift/Xcode toolchain is available on the Windows development host.

### Books, profile presentation, and photo folders (v3.6)

This release improves book file extraction and sibling audiobook-folder grouping, keeps Listen separate from opt-in Read Along, and checks additional authorized book formats when details open. Profiles show a larger adjustable poster, biography directly beneath the name with tap-to-expand, and configured banner image/video. The top-right pencil menu opens Appearance and permission-checked Edit Profile. Photo uploads can browse/create a folder within the selected profile's photo tab.

Use the single complete `Homestead-iOS-companion-v3.6.zip`. Extract it into its own `Homestead-Companion-v3.6` folder and open the enclosed Xcode project. Run `bash scripts/validate-ios.sh` on the Mac before installing. **Swift compilation, executable Swift tests, and real-device testing remain pending on this Windows development host.** See [V3.6-QA.md](V3.6-QA.md).

The ZIP includes a separate, **undeployed** `Server-Update` directory. Folder browsing/custom destinations and fresh book-format lookup require that server integration. Existing indexed Read/Listen actions and default uploads remain usable without it; unsupported custom destinations fail explicitly. Review the enclosed server patch against the current server branch instead of replacing newer server code. Nothing has been merged or deployed by this pass.

### Connection and photo reliability (v3.5)

The app automatically restores its saved server at launch and rechecks the session on foreground/network recovery. Account session cookies are stored in this device's Keychain; passwords are never saved. Temporary failures keep the configured server and already loaded content. Expired/revoked sessions require sign-in; the explicit **Sign Out and Change Server** action removes the saved connection.

Photo transfers now use a four-request queue, shared in-flight requests, bounded memory caching, and bulk downloads instead of processing each network byte individually. HEIC/HEIF files use the existing authenticated raw-file endpoint and native ImageIO decoding. The picker requests original files and preserves supported photo formats. Failed profile thumbnails offer retry, and refreshing a profile fetches a fresh index without resubmitting uploads. Home/Media show one library-loading overlay.

Open the complete `Homestead-iOS-companion-v3.5.zip` project on your Mac. Run `bash scripts/validate-ios.sh` before installing; it runs the JavaScript checks, Swift tests, and an unsigned iOS Simulator build. See [V3.5-QA.md](V3.5-QA.md) for the exact validation status and device checklist. **Xcode compilation, executable Swift tests, and iPhone/iPad checks are pending; this package was prepared on Windows.** No server update is bundled or deployed.

A native SwiftUI companion for your Homestead server, with Home, Media, Family, Adult, and Search tabs and Settings on Home. v3.0 adds a fullscreen photo viewer, native direct video/audio playback, and account-specific resume progress.

The companion supports native requests and Add forms, including recipes and Adult profiles. Expanded playback, background audio, offline storage, pinned libraries, and TestFlight distribution remain future work. The website still stores watch progress in browser local storage; this first player pass syncs progress between companion devices through the server, not the existing browser player.

Media uses the authenticated, account-filtered `/data/media-index.json` endpoint. Home and Media reuse an in-memory library snapshot. Saved metadata matches supply synopses, years, and missing posters; provider artwork loads through the server's authenticated artwork cache. **v3.0 needs the server update from Homestead PR #4 for progress syncing and Continue Watching.**

### Header and metadata fixes (v3.2.1)

Glass effect containers are scoped to individual headers instead of spanning the entire tab/navigation hierarchy. Saved metadata enriches only indexed items, preserving stable TV/book/music identities. Continue Watching uses the indexed profile poster when no ordinary media item owns the file. Servers without the matches endpoint retain local metadata. Items without any indexed or saved artwork still show a placeholder; missing source synopses are not invented.

Regression tests cover metadata aliases/cycles, TV identity, account-index boundaries, and artwork proxy addressing. The Mac CI build checks compilation; tab switching, visible back buttons, and artwork rendering still require simulator/device verification.

## Open on your Mac

### PIN-protected Adult visibility (v3.3.1)

Settings → Adult visibility → Show Adult library controls this account's visibility on this device. The first hide requires a six-digit PIN and confirmation. Hide again instantly; revealing or changing the PIN requires the existing PIN. The Keychain stores a random salt, PBKDF2-HMAC-SHA256 verifier (210,000 rounds), hidden state, and failed-attempt delay. Five wrong attempts impose a one-minute delay. Neither sign-out nor appearance reset clears the PIN; there is no in-app forgotten-PIN bypass. Keychain read errors fail closed.

Hidden mode removes the Adult tab/wizard, filters Adult Continue Watching, and limits search/requests to recognized non-Adult libraries. Plugin search and embedded Family web pages are disabled in this mode because their results/navigation cannot be safely classified by the native app. Native Recipes stays available, and Settings hides its Open web app link. This is a local UI lock, not a replacement for server permissions or a restricted child account; it does not restrict Safari or another device. The saved hidden/visible state survives reconnecting; showing it does not grant server access.

Regression coverage checks PIN format, salted derivation, serialization without plaintext PIN, and concealed history/search filtering. Simulator testing should also cover hide/cancel/wrong PIN/correct PIN, restart, and switching accounts.

### Appearance, banners, and native collections (v3.3)

Home → Settings offers System/Light/Dark themes, Blue/Teal/Green/Purple/Pink/Orange accents, Glass/Solid panels, live preview, and reset. Preferences are isolated by server and account in this device's local storage; they do not sync between devices. Native controls, borders, and backgrounds follow the accent. Embedded Family web pages retain the server's appearance. System Reduce Transparency takes priority over glass.

Media details display indexed banners or saved metadata backdrops, with poster/title below and metadata/synopsis afterward. Missing banners do not reserve an empty block.

Media → Shared Collections opens native poster grids for saved, metadata, and bundled smart collections, with saved order and artwork overrides. Collection members resolve only against the current account's authorized index; unavailable members and collections without accessible members are omitted. The browser opens native details/playback. Collection creation/editing and episode-by-episode universe timelines remain on the server website. Smart presets are bundled from the server source and update with the app.

### First player and viewer pass (v3.0)

Open the complete v3.0 project and run the Homestead scheme. Photos open fullscreen with category-scoped paging, pinch/double-tap zoom, a close control, and retry on loading failure. Fullscreen images are bounded to 32 MB downloaded data and downsampled to 4096 pixels; thumbnails keep the smaller preview route. The gallery remains underneath the viewer so closing returns to its position.

Indexed movie, episode, music, audiobook, archived YouTube, and profile files open Apple's native player, with seeking and supported embedded audio/subtitle controls. Library and owned Search details list the files. This pass is direct playback: unsupported codecs/containers show an error rather than automatically transcoding. There is no background playback, PiP, offline downloading, next-episode queue, or ebook reader in this pass. Playback pauses when inactive and releases its item when the viewer closes.

Resume positions are sent at 15-second intervals and on pause/close/completion to authenticated GET/PUT `/api/account/playback`. History is stored under server appdata `next-version/playback`, isolated by the authenticated user. The client never selects a target account. Only hashed file IDs, positions, durations, completion state, and timestamps are persisted; no media titles or paths are saved in history. Continue Watching appears before Recently Added and resolves saved IDs against the current account-filtered index. Completed videos (95% or more) are omitted. Audio positions can resume from their file screen. A failed save is visibly reported while the player is open; there is no offline save queue. Two devices writing the same item use the latest server-received update.

Validation: GitHub Actions run https://github.com/tbritton0826/homestead-ios/actions/runs/36776562180 passed Swift model tests and Xcode 26.3 iOS Simulator compilation for code commit c043ee5. Server tests pass authentication, isolation, validation, completion, disk persistence, and the 500-entry bound. Playback, gestures, orientation, and device networking still require runtime testing on the Mac/iPhone; no real user history or media was changed during automated testing.

After the updated Docker image publishes, update the Unraid container. Test a photo (zoom/swipe/close), a compatible movie and episode, an audio file, pause/close/reopen/resume, Continue Watching, then sign out and verify a different account sees only its own history and allowed libraries. The newer player does not migrate existing browser-local progress.

### Contextual Add and profile structure (v2.13)

The floating + follows the active library. Adult opens a native three-step profile wizard with the selected Personal, Performers, or Celebrities library preselected when permitted. It supports manual details, optional provider metadata lookup, source URLs, and review before creating through the existing server API. Creation requires administrator access and never overwrites an existing profile. Uncertain submissions are not automatically retried. Family Recipes offers recipe, quick-instruction, and category forms; other Family sections explicitly indicate when their native Add wizard is not yet available. Media offers discovery, requests, and manual entries.

Adult profile pages now place the banner above the overlapping poster/name row, followed by a horizontal metadata strip, optional About disclosure, category tabs, and the selected gallery. Folder paths determine Photos, Nudes, Videos, Sex, Keepsakes, AI, Artwork, and Other; only populated tabs appear. Profile artwork is kept separate from normal galleries. Video banners reserve the header space but do not autoplay. This is a structural pass, with customization and appearance polish still pending.

Source/diff checks completed and model regression tests were added for category precedence and artwork paths. Swift tests and Xcode compilation cannot run in this Windows workspace. No real profile was created during validation. On the Mac, verify library-specific + routing, profile creation with an intended new entry, gallery tabs, and the header layout. No Docker update is required.

### Compact Home and Adult media (v2.12)

Home now has one compact top ribbon with Welcome home at left and Settings at right. The separate Home navigation title, HOMESTEAD branding, and introductory tagline are removed.

Adult profile details retain the server-filtered file list and render a native photo gallery and video entries, with Show more after 60 items. Media fetches use the existing authenticated /media and /api/file routes, only on the configured server. Image downloads are bounded to 12 MB and decoded to previews. Videos use direct AVPlayer playback with session cookies via Apple's documented AVURLAssetHTTPCookiesKey option (https://developer.apple.com/documentation/avfoundation/avurlassethttpcookieskey). Playback stops on leaving the viewer. This is direct playback only: unsupported containers/codecs still need server transcoding, and progress sync is not implemented. Profile imports that exist outside the indexed file list are not yet fetched separately.

Source/diff checks passed; model tests cover retained file lists, deduplication, source-path routing, and rejecting off-server/traversal URLs. Swift tests, compilation, image loading, and direct playback need verification in Xcode on the Mac. No media or personal file paths were printed during schema checks; no real image/video playback was validated here. No Docker update is required.

### Adult tab and tab lifecycle (v2.11)

The bottom bar is Home, Media, Family, Adult, Search. Settings moves to the gear on Home, keeping five primary tabs. Adult is a native, read-only index browser with the canonical compact picker for Personal, Performers, Celebrities, Photos and Videos. It requires the server's enabled Adult library, plan feature, and account/sublibrary permissions; children are denied. The server-filtered index remains authoritative for linked-profile restrictions and redaction. Unavailable accounts see an access message. This does not add playback, editing, adult live TV, or full web-detail parity.

Search now retains its navigation view between tab selections. Add → Search waits for sheet dismissal before changing the tab. These remove potentially disruptive view transitions, but are not a confirmed fix for the reported EXC_BAD_INSTRUCTION: no crash stack or failing source line was supplied. If it recurs, capture the highlighted line, the preceding console message, and Thread 1's call stack.

Source checks pass. Permission and legacy-index regression tests were added; Swift tests, compilation and rapid-tab-switch simulator checks must run on the Mac because Xcode is unavailable here. Use the complete v2.11 project. No server/container update is needed.

### Native Add and resilient Requests (v2.10)

This release replaces the v2.9 embedded Add menu. The + menu now opens native actions: Find and request media, Requests, Add recipe, Add quick instruction, Create category, and Manual library entry. No Add action opens a WKWebView. Family browsing outside Recipes still uses its existing web pages.

Recipes support manual fields and a URL preview imported into editable fields before a separate Save. Quick instructions submit the server's quickSteps schema. Category creation and recipe saves use the existing authenticated APIs; recipe metadata persistence is still handled by the server. Manual entry sends title, barcode/ISBN, library, and notes to the server intake endpoint. It creates a record, not a downloaded file. Duplicate-code and adapter errors are shown as returned by the server. Saves cannot be automatically retried after an uncertain response.

Native photo/file uploads, barcode camera scanning, specialized profile forms, and full importer parity are not implemented. The menu says so explicitly and no longer offers misleading web-backed library links.

Requests first loads account-scoped saved requests and acquisition jobs without contacting providers. Then it attempts live lifecycle status with an 8-second inactivity timeout. Saved/previous results stay visible after a live failure and are labelled as not freshly updated. Polling backs off to 60 seconds after failure (30 seconds after success). The in-memory snapshot belongs to the current client session and resets on sign-in. This handles slow-provider failures without claiming to fix the server's sequential Seerr pagination.

Read-only checks against the current server returned saved requests in 0.08 seconds and live status in 1.53 seconds; the reported timeout was not reproduced during that check. Source/diff checks passed. Swift tests were added for recipe payloads, preview mapping, library filtering, and account scoping. Xcode compilation, Swift tests, native save flows, and simulator layout remain unverified on Windows. Run the full v2.10 project on the Mac; test native recipe save, quick instruction, category, and Requests with a slow/unavailable provider. No Docker rebuild is needed.

### Global Add and requests (v2.9, superseded by v2.10)

Every main tab now has a circular + control at the bottom right, above the native tab bar. Its menu opens the single native Search tab, a native Requests list, or the server's existing Add/import workflow for a selected library. Add forms remain embedded web content using the current session; Search remains native. The launcher opens only the Add menu, never submits a form. Closing Add refreshes the phone's media and recipe lists.

Seerr search details now check server status and offer movie or selected-season TV requests. TV seasons already imported, requested, or processing are excluded from selection; partially available series can request remaining eligible seasons. Book requests offer ebook, audiobook, or both. Music artist/album requests keep the provider identities and payload returned by discovery. All request buttons require explicit confirmation, disable during submission, and do not automatically retry uncertain outcomes. Server permissions and service configuration still apply.

Requests reads the server's account-filtered lifecycle endpoint, supports pull-to-refresh, and polls every 15 seconds while the page is active. It displays provider warnings and status transitions such as requested, downloading, importing, scanning, and available. Native playback is not part of this release. YouTube and plugin-specific submissions remain in their server Add workflows where supported; native request buttons cover Seerr and book/music discovery.

Validation: four Add-launcher tests pass on Windows. Live read-only checks confirmed the Seerr search/status contracts, season responses, and the server request queue. No test download was submitted. Payload regression tests cover selected TV seasons, history tracking, provider identities, book format, and rejection of invalid/non-requestable results; run `swift test` on the Mac. Xcode compilation and full submit-to-import validation remain pending. Open the complete v2.9 project and verify + placement, Add → Search, search detail → Request, Requests progress, and Add/import forms. Use a title you actually want for the end-to-end request test. No Docker update is needed.


### One native Search screen (v2.8)

The Search tab now uses SwiftUI, with one search field and native results/details. It no longer loads the website's search dialog or exposes duplicate Close buttons. Media and Recipes have no local search fields. Their compact library headers, pickers, and Favorites only filter remain unchanged. This release focuses on layout and search behavior, not a new appearance.

Search reads the current account-filtered server index and recipes, and calls the server's existing Seerr, books/music acquisition, YouTube channel, and opted-in plugin search APIs when enabled and permitted. Queries wait 400 ms after typing; cancellation and query generation checks discard obsolete responses. Large index decoding happens off the UI actor. Provider errors appear without discarding successful results. The server remains responsible for authorization.

This is native text search and result previews, not complete parity with every web search mode. Photo search, browse-without-query, and external adult discovery are not implemented. Playback and plugin actions still require the web app. Native media requesting is added in v2.9 below. Other Family sections continue to use their existing embedded pages.

Open the full v2.8 project. In Xcode, check one Search tab, no Media/Recipes search fields, an owned title, recipe ingredients, Seerr discovery, enabled plugin results, rapid query changes, clearing input, restricted accounts, offline errors, and detail/back navigation. No Docker update is required. Swift compilation, tests, and simulator validation are pending because this update was prepared on Windows without Xcode.

### Glass appearance (v2.4)

Native screens now use a blue accent, light/dark gradient canvas, rounded material cards, and blue borders. Media and recipe rows use the same card treatment. The Family Library picker uses Apple's Liquid Glass on iOS 26 and later, with a material fallback on earlier supported systems. The native system tab bar is retained, including its system-provided appearance. See [Apple's custom Liquid Glass guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views).

Reduce Transparency replaces custom material panels with solid system backgrounds, and Increase Contrast strengthens their borders. There are no new decorative animations. Embedded family pages receive a companion-only stylesheet for rounded panels, blue borders, selected states, and visible keyboard focus; existing website text/background colors are preserved. This does not change the deployed website.

Open the full v2.4 project, which includes `GlassTheme.swift`. Check light/dark mode, Reduce Transparency, Increase Contrast, larger text, scrolling and taps on the Mac simulator/device. Source checks pass, but compilation, visual inspection and performance measurements still require Xcode; this styling update has not been run from the Windows environment.

### Family Library

The former Recipes bottom tab is now **Family Library**, with a menu for Family Home, Archive, Households, Family Tree, Pets, Calendar, and Recipes. Recipes remains the native screen and the initial selection. Other family sections display the existing server web interface inside the app; these are not newly implemented native screens. Those pages retain the web app's editing features and permission checks. Disabled sections may redirect to Family Home or Home according to server configuration.

The embedded family browser uses an [in-memory WebKit data store](https://developer.apple.com/documentation/webkit/wkwebsitedatastore), seeded with only the current server's session cookies. It does not persist a second login to disk. Navigation to other origins is blocked with an explanatory message. The picker seeds the web app's existing sessionStorage navigation preference before page startup. Reload retries failed loads. Selecting another family section recreates its page, so finish any unsaved edits before switching.

On the Mac, check the picker on iPhone and iPad, open each enabled section, confirm the intended page and account load, return to native Recipes, and test reload with the server unavailable. Compilation and these WebKit checks are pending; Xcode is unavailable on the Windows development machine.

1. Extract the companion ZIP into a new folder, keeping your original project as a backup.
2. Open `Homestead.xcodeproj` with your installed Xcode 26.3. No macOS upgrade or third-party dependencies are required by this project.
3. Choose the **Homestead** scheme and an installed iPhone or iPad simulator, then press **Run**. If no iPhone simulator is available, use your installed iPad simulator initially.
4. For a physical device, select your own team under **Signing & Capabilities** and select a device that Xcode can pair with. Device OS/Xcode compatibility must be checked on your VM; this source package does not establish support for debugging iOS 27 from Xcode 26.3.
5. Enter `http://10.0.0.224:7312` (or your server's HTTPS address). Allow Local Network access if prompted. The VM/simulator or physical device must be able to reach the server.
6. Sign in with your Homestead account when prompted. Home opens first. Tap a library card or the Media tab to browse. Pull down to refresh Home, Media, or Recipes. Settings includes the server address, library refresh time, a web-app link, and sign-out.

The deployment target is iOS/iPadOS 17.0. The app deliberately uses APIs available on that target and retains your existing bundle identifier. The app icon is still the starter project's empty icon set; replace it before distribution.

## Sessions and transport

Only the server address is saved on the device. Passwords are not stored. Session cookies stay in an ephemeral URLSession and are discarded when disconnecting or closing the process, so a new launch can require sign-in again. Disconnect attempts to revoke the session on the server; when offline it can only discard the local session.

Local HTTP is unencrypted. Prefer HTTPS where configured, and use HTTPS for internet-facing addresses. HTTP is restricted by the app to local IPv4 ranges, localhost and local hostnames. Redirects are rejected: enter the final server address. Artwork is fetched through the authenticated server session and only from the recipe-artwork endpoint. Server permissions and subscription restrictions remain enforced.

## Validation

The initial recipe prototype ran successfully in the user's simulator. The latest Family Library update was edited on Windows, where Xcode and the iOS SDK are unavailable, and **has not yet been compiled or run**. On your Mac, use Run in Xcode or run this from the project directory:

```sh
xcodebuild -project Homestead.xcodeproj -scheme Homestead -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
swift test
```

Check these flows before household distribution:

- Connect to the server; try an invalid address and an offline server.
- Check Home counts against the web app; open a card and confirm its Media filter.
- Change Media libraries, use Show more, and open details with and without posters.
- Refresh while navigating between tabs; confirm a failure displays Retry and retains existing results.
- Sign in with incorrect and correct credentials; disconnect and reconnect.
- Open recipes with and without images, ingredients, directions and notes.
- Use the single Search tab, clear search, then return to Recipes to filter favorites and pull to refresh.
- Rotate iPad, navigate back on iPhone and try larger accessibility text.
- Verify an expired session returns to sign-in and denied recipe access shows the server's error.

The Swift package tests cover keyed and array library formats, nested metadata, numeric years and IDs, duplicate IDs, omitted fields, dates, empty accounts, and invalid responses. Run these on the Mac using `swift test`; they were not executable in the Windows environment. The companion makes no recipe writes. Portable recipe metadata remains the server's responsibility.

## Working between Windows and macOS

Keep this as a separate repository from the Homestead server. After cloning on the Mac, open the project from that checkout. Commit any Mac-side edits before pulling future changes, and never commit signing keys or personal provisioning profiles. Changes to this app do not require rebuilding the Homestead Docker container.

## Later customization

- Account-specific poster count per row, including three- and four-column options.
- Homestead app icon and default artwork for items without a poster.


## v3.3.2 — More and plugin navigation
- Bottom tabs are Home, Media, Family, Adult (when visible), and More.
- More contains permitted enabled plugin libraries, Shared Collections, and Settings.
- The Home ribbon and compact library headers open the same native global search sheet.
- Plugins use their own client inside an authenticated plugin host, with native section pickers and contextual Add commands from the installed plugin manifest. This is not a native rewrite of each plugin's forms and does not load the full Homestead website shell.
- All plugin entries remain concealed while Adult visibility is locked because the plugin contract does not reliably classify private content. Server account permissions still apply.
- PIN setup is presented from the stable Settings navigation container instead of a recycled Form section; it closes only on explicit Cancel or successful save.
- Validate plugin client/wizard behavior and PIN presentation in Xcode/on device; CI compiles the simulator target but does not run the app UI.

## v3.3.3 — Selective plugin concealment and direct plugin loading
- Hiding Adult now asks which plugins to hide too. Choices are stored with the account's Keychain PIN record; cancel changes nothing. Existing records retain hide-all until a selection is saved. PIN changes preserve the selection.
- More and global plugin search honor the selected list. Unchecked plugins remain accessible while Adult is concealed; ordinary server permissions still apply.
- Plugin pages load directly from their server URL, avoiding the server's frame-ancestors security policy blocking a locally generated iframe host. The host still supports manifest Add commands and plugin API messages. HTTP errors and load timeouts expose Retry.
- Back, centered plugin title, and Search share one top ribbon; the separate native navigation bar is hidden on plugin pages.
- The currently installed server plugin catalogue reports no hostIntegration for AI, Dominion, or Panty Archive. These versions use their own on-page navigation/Add controls; a native floating Add requires a plugin manifest advertising commands.
- Simulator runtime verification remains necessary after the successful CI build.

## v3.3.4 — Device media for profiles
- The native Photos picker selects photos and videos for a new profile's media step, and the floating + on an existing profile opens Add media for that profile.
- Media stays queued until Create profile / Upload to profile. Images are converted to JPEG for server compatibility. Photos can be assigned to Photos, Nudes, Artwork, or References; videos use the server's video destination.
- Profile creation happens once, then uploads use the returned profile ID. Partial failures retain pending files and do not resend confirmed uploads or recreate the profile. Connection errors advise checking the profile before retrying an unconfirmed file.
- Uploads use authenticated multipart requests from temporary files, sequentially, rather than loading video request bodies into memory. Temporary files are discarded when the picker queue is released.
- Existing profile pages refresh on closing the upload sheet and support pull-to-refresh while the server indexes new files.
- Server upload permissions apply; this version enables submissions for owner/admin accounts. Images are limited to 32 MB and videos to 512 MB, matching server defaults.
- Device Photos/iCloud selection and real upload behavior require on-device/simulator testing. Automated checks do not upload personal media.

### Plugin landing page fix (v3.3.5)

Accept both forms of a plugin root URL, with or without a trailing slash, while retaining same-server and plugin-path boundaries. This fixes the native navigation guard rejecting the initial plugin page. Regression checks cover root URLs, nested routes, other plugins, traversal, and external origins. Live plugin rendering still needs simulator verification.

