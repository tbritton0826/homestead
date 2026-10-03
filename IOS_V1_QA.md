# iOS companion v3.3.5 — QA boundary and findings

Current user-supplied source: `\\10.0.0.224\applestorage\Homestead-iOS-companion-v3.3.5.zip`.
SHA-256: `f7ffa068b62d3ebe2518b562440e3e370709805088c3618726cb5d2c905422b6`.
Archive read only; not extracted, modified or rebuilt. README statements are source documentation, not evidence of a build/device test in this session.

## IOS APP — VERIFIED

**Source inspection only. No native runtime check is marked verified.**

The archive contains a SwiftUI companion with Home/Media/Family/Adult/Search navigation and Settings. Core screens are native; Family pages and plugin content also use WKWebView. The web repository's CSS fixes therefore do not automatically change the native UI.

Inspected `ContentView.swift`, `CompanionTabs.swift`, `CompanionModel.swift`, `HomesteadClient.swift`, `FamilyLibraryView.swift`, `PluginBrowser.swift`, `NativeMediaViewer.swift` and other client/library source referenced during the audit.

- HomesteadClient uses an ephemeral URLSession with `urlCache = nil`; server address is stored separately. In-memory session cookies are copied into WebViews.
- Family and plugin WebViews use a nonpersistent website data store. Family Reload changes its load identity and requests the page again; ordinary URLRequest cache policy is retained.
- Native appearance preferences persist in UserDefaults under server/account identity. The native preference model is separate from web appearance settings.
- Native photo viewing uses a paged TabView and ignores safe areas. Centering, accidental next-image exposure and system-inset behavior cannot be established from this source alone.

## IOS APP — ISSUE FOUND

**Source-confirmed parity gaps; no runtime defect reproduction claimed.**

1. Native `RecipeDetailView` presents the recipe, navigation title and artwork task but has no edit toolbar/action. The requested upper-right pencil is fixed in the web detail; v3.3.5's native recipe screen still needs a native editing implementation or deliberate web handoff.
2. Native appearance implements theme/accent/surface preferences rather than the web poster sizing, per-panel/card blur, library/page override and Reset model. Web QA cannot establish those controls' parity or persistence in the native screens. Changes to native feature parity require a separate companion implementation/release.

No native source changes were attempted as part of this web QA commit.

## IOS APP — NOT TESTABLE IN CURRENT ENVIRONMENT

This Windows host has no available Xcode/iOS simulator toolchain or connected iPhone control surface. Native app control is unavailable. Browser viewport testing is recorded only in `PUBLIC_V1_QA.md`.

The following remain device tests: launch; authentication/cold-launch session restoration; Home, Movies, TV, YouTube, Music, Books, Family, Pets, Adult, Cloud, Inventory, AI and Settings; details/Back; appearance; search; sheets/modals; upload and external links; media playback; hardware/software keyboard; rotation; status-bar/home-indicator insets; centered single-photo viewing; profile pill scrolling; recipe editing; touch targets; overscroll/bounce; scroll restoration; sticky headers; selection/long-press; offline/network retry.

The source's ephemeral session makes persistent authenticated cold-launch behavior uncertain; verify it rather than inferring it from stored server address. Native Cloud/Inventory/AI/plugin and book-reader parity also requires client-specific inspection/runtime acceptance; opening an equivalent web screen is not proof of native feature parity.

## Frontend freshness after deployment

The web service worker is network-first for GET shell/assets, excludes API/media, calls skipWaiting/clients.claim and never writes new cache entries. Vite fingerprints output JS/CSS assets. These source facts do not prove which deployed assets an iPhone has loaded.

Family WebView seeds `homesteadActiveLibrary` in sessionStorage because the web app prioritizes that preference; URL query alone is not a reliable deep-link assertion. Validate actual navigation in the app.

For a web-only deployment, verify the WebView loads the new fingerprinted asset URLs and the expected UI through the deployed server. Reload/reopen the embedded page; if stale, recreate the WebView or restart the app and inspect again. Nonpersistent storage and URLSession's disabled cache reduce caching scope, but default WebView request policy and server/CDN headers still need actual validation. No cache invalidation or app restart was executed here.

A native app version bump is needed when distributing native implementation changes, such as recipe editing or native appearance parity. A web-only change does not inherently require a companion version bump. No blanket hard-refresh, cache-purge or restart guarantee is made.

## Device acceptance sequence

1. Install/launch v3.3.5 against a staging server; record actual binary/build and deployed frontend fingerprints.
2. Check login, warm resume and cold restart; test online/offline recovery without exposing credentials.
3. Exercise every listed client screen, navigation path and available native versus WebView capability.
4. Recheck the four known mobile issues with real insets, keyboard and rotation; use VoiceOver/hardware keyboard where available.
5. Test appearance inheritance/Reset/persistence on the surfaces that implement them; record missing native controls explicitly.
6. Validate authorized real-provider searches, upload outcomes, external links and playback.
7. Deploy a known frontend change to staging and verify fresh embedded assets using the app's own reload/reopen lifecycle.

Live V1 client sign-off remains pending these checks and acceptance/resolution of the native parity gaps.
