# Connection recovery and episode search — companion v3.21 (22)

This pass includes the complete native source at `companion/ios` so its model
tests and simulator build can be reviewed and checked with the matching server.
The folder is excluded from the server Docker image. No Compose network,
database, key, account, media file or live deployment is changed by this pass.

## Server contract

- `GET /api/tv/episodes?showId=tv:<local-id>`: session and TV permission required.
  Combines exact local video-file evidence with Sonarr's known episodes. Provider
  metadata requires the existing external-integrations entitlement. Missing or
  inaccessible Sonarr returns local episodes plus a warning, not a failed login.
- `POST /api/tv/episodes/search`: `{showId, episodeId}`. Owner/admin and eligible
  integration required. Returns a short-lived account/show/episode-bound token
  and redacted release choices, without submitting a download.
- `POST /api/tv/episodes/grab`: `{showId, episodeId, searchToken, releaseId}`.
  Accepts only an allowed release from that account's prior results. Local files,
  air date and Sonarr's queue/file state are rechecked. Submission is coalesced
  across users for that show/episode for ten minutes, including ambiguous
  upstream failures. No automatic write retries. A process restart invalidates
  all search tokens; new actions must search/check provider state again.

Sonarr's configured v3 API is used (also supported by Sonarr v4). Exact TVDB/TMDB
IDs link the local series; when needed, configured Seerr provides TMDB→TVDB
external IDs. There is no title-only match or automatic series creation. Episode
images are optional and go through the existing validated artwork cache.
Sonarr `hasFile` without verified Homestead file access is shown separately from
Available. Unknown dates, incomplete/unmapped queue state and upcoming episodes
do not authorize a grab. Local playback remains usable without Sonarr.

Members without direct search access can use the existing Seerr season request
flow, subject to its permissions/configuration. That provider workflow requests
whole seasons; it does not promise per-episode submission. Search itself is
episode-specific for authorized owner/admin accounts.

## Connection changes

The native client separates large index transfers from the small API pool,
renews draining read/control pools on route changes or retryable read failures,
and keeps writes in flight without replaying them. One failed probe does not
establish disconnection: repeated failures and no successful traffic for at
least 45 seconds are needed to display the warning. Real successful requests
clear stale banners. Definitive session expiry still requires sign-in. Failed
watch-order loads retry on recovery, without erasing loaded order content.

These changes address reproduced recovery gaps. They do not prove the root
cause of the recurring production outages; sustained LAN/tailnet phone/tablet
acceptance remains required, as described in `companion/ios/V3.21-QA.md`.

## Validation

- `npm run test:tv-episodes`: 14 passing behavior/API tests, using fake Sonarr
  responses and temporary loopback HTTP servers. No real indexers/downloads.
- Full `npm test` passed and `npm run build` passed. The existing large-chunk
  build advisory remains.
- Exported native JavaScript/source checks: 56 passed, one Swift syntax check
  skipped on Windows. Five new Swift tests cover connection/episode behavior.
- Mac CI runs those model tests and an unsigned iOS Simulator compilation.
  CI/device outcomes must be recorded separately; they cannot be inferred from
  Windows checks. No deployment is authorized by creating the review PR.
