# v3.18 (build 19) — connection checks, compact posters and shared pet photos

## Included

- Lightweight authenticated `/api/auth/connection` probe with no cached authentication decisions or subscription/profile payload. Revoked/expired sessions still return 401. Older servers fall back to the full session route on 404 only.
- A transient probe retry replaces its small connection pool while retaining the private cookie jar. Uploads and playback are not cancelled/replayed. Cancellation does not become a disconnect warning. Successful real API/image responses received during a failing probe establish reachability; cached images do not. Checks continue with the existing bounded recovery schedule. Settings shows check timings/categories and the most recent 30 checks; diagnostic history contains no URLs, cookies or media names.
- Strict HTTP support for Tailscale IPv4 `100.64.0.0/10`, with scoped ATS CIDR exceptions for that range and existing private LAN/loopback ranges. Public HTTP is still rejected; HTTPS keeps certificate validation and never silently downgrades. For the reported `https://100.88.187.82:7312` TLS failure, use that address with `http://` only if the server's port actually serves HTTP, or a properly configured tailnet HTTPS hostname/Serve route. Tailscale must be connected on both endpoints. The screenshot alone does not prove the server protocol or reachability.
- Adult poster pills use compact stored values (for example S, 32B, 25), ordered size/bra/age. Full accessibility labels and existing metadata permissions remain. Settings → Profile posters → Show poster metadata persists the choice. Per-poster toggle buttons are removed.
- Normal and Adult Photos album headers are compact. Ribbon navigation/counts are used once; the existing ribbon Add action opens the selected Adult album's import card. Move To remains separate. Folder tabs and photos start higher on the page.
- Pet photo import supports selecting multiple existing pets in web and native mobile. Single-pet imports use that pet's Photos folder. Multi-pet imports store one original in `Shared Photos/Bella + Cookie/` (or the actual selected names), with optional nested folders. Each gallery references the same original; shared folders never become profile cards or pet-count entries.
- Exact name tokens in existing group folders resolve to stable pet IDs and persist in `.pet-group.json` beside the originals. Substrings do not match. Unknown/ambiguous tokens require confirmation in Organize pet photos → Shared folder membership. Membership survives profile name edits and includes nested event/date folders. Removing an association does not delete media.
- Web/mobile Organize pet photos includes selection of existing authorized Photos/Pets originals, multiselect pets, optional destination folder, explicit source/destination review and Move originals. Filenames are retained; conflicts and changed originals are rejected. Journals on the Pets share make retries/restarts reconcile completed moves without copying to each pet. Cross-filesystem moves verify destination bytes before unlinking the original. Upload identities and content-addressed destinations prevent repeated submissions from adding another original to the same destination.
- Pet file jobs run in serialized worker threads, away from server connection/playback requests. Pets and Photos index reconciliation uses one scanner writer and retries when an existing scan is busy. The scanner and live Pets API use the same group/catalog rules. Existing pet artwork remains independent of shared photos.

## Verified here (Windows, generated fixtures only)

- Full server `npm test` suite passed; the final focused pet/connection suite passed (22 checks including the existing v3.7 suite). The account regression script also passed.
- Production web build and focused lint passed. Existing bundle-size warning remains.
- Real React browser fixtures passed at 320, 390, 768, 1024 and 1366 pixels: compact Photos heading/count/navigation, responsive organizer, focus, explicit Close, upload over HTTP without randomUUID, reviewed moves and unknown-name confirmation. No React errors/warnings remained.
- Native JavaScript/source/resource checks: 55 passed, 1 skipped because Swift is unavailable. These do not compile the iOS app.
- Added runnable Mac Swift model checks for HTTP range boundaries, stale probe warnings, compact values/accessibility originals, the probe contract and shared-folder decoding.
- Pet fixtures cover exact/ambiguous names, nested folders, stable membership across rename/restart, one original after import/retry/restart, reviewed bulk moves, filename/source conflicts, denied sources, interrupted rename recovery, cross-filesystem staging, artwork separation, worker execution, scanner rebuild, session/feature/write/library permissions and revoked authentication.
- No production media was moved or copied, and no live server/tailnet settings were changed.

## Required Mac/device acceptance — still pending

Run `bash scripts/validate-ios.sh` from the extracted complete project on the Mac (Node + Xcode). This runs the portable model tests and simulator build. Install 3.18 (19).

1. iPhone: browse/play for 20–30 minutes over LAN, then separately over Tailscale; include background/resume, server restart, network changes and an actual expired session. During a warning compare Settings → Server → Recent connection checks with whether fresh media/API requests still work. The recurring five-minute production failure's cause is not proven or claimed fixed by fixture checks.
2. Confirm the actual Tailscale HTTP port or trusted HTTPS hostname from the phone. This workstation has no available Tailscale CLI, so end-to-end phone/tailnet connectivity is unverified.
3. Verify minimal pills and persisted Settings toggle, including hidden metadata/account changes.
4. Create two fixture pets on a test mapping; import one group photo, confirm one file on disk and both galleries on web/mobile; rescan/restart, rename a pet, change membership, retry a move and confirm no combined profile appears. Test a cross-share move on the actual storage filesystem, including write failure. Use the explicit reviewed move for production organization only when ready.
5. iPad: verify portrait/landscape and supported window sizes independently, especially Settings, poster overlays, the media picker/multi-pet form and original-move review. Browser viewport checks are not native iPad acceptance.

## Server update

Server branch: `codex/pet-sharing-connection-polish`, based on merged v3.17 main `5e9781e`. Update/rebuild the server before testing shared pet workflows. The ZIP includes a development patch against that exact baseline; do not stack historical patches or apply it to an already updated tree. Mobile packaging does not deploy the server.

References: [Apple scoped IP/CIDR ATS exceptions](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains), [Apple local networking behavior](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking), [Tailscale addresses](https://tailscale.com/docs/concepts/tailscale-ip-addresses), [Tailscale HTTPS setup](https://tailscale.com/docs/how-to/set-up-https-certificates).
