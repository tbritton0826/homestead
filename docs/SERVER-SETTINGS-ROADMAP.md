# Server settings requirements

Status: requested capability checklist, not implemented by this document.

Delivery preference: add settings incrementally when related features require them. This backlog is not a prerequisite for final UI polish or a request to implement all settings now. Final UI polish remains the next planned pass. Each new setting should ship with working behavior behind it; defer unrelated controls until their supporting feature is ready.

Source: user-provided library/scanning/playback/analysis settings reference, October 22, 2026. Adapt the behavior to Homestead rather than copying product-specific plugin or agent names. Existing server and mobile follow-ups remain open.

## Current implementation evidence

- `scripts/library-watch-worker.cjs` watches Movie and TV directories, refreshes its watcher inventory every minute, and polls file snapshots every five minutes. These intervals and library selections are currently fixed in code. Music and other libraries need equivalent configurable coverage.
- `server.cjs` debounces automatic Movie/TV scans and exposes watch status. Watch-change messages currently provide a reason, not a validated changed-folder scan target.
- `scripts/scanners/scan-media.cjs` accepts a single-library `--folder` target. Automatic partial scanning still needs changed-path validation and a merge strategy that preserves unaffected folders, especially on unreachable network storage.
- `src/utils/server-home.js` currently limits resume results to 24 and excludes video progress at 95 percent. These need saved user preferences and coordination with the shared played-state logic, rather than a Home-only threshold.
- `src/App.jsx` contains placeholder Preview Thumbnails/Credits Detection controls and static account progress preferences. Their displayed active state is not evidence of a functioning setting.

## Settings organization

| Area | Scope | Controls |
| --- | --- | --- |
| Library updates | Owner/server defaults, per-library overrides | Watch folders, changed-folder scans, music watching, periodic scans, interval, maintenance window |
| Cleanup and deletion | Owner/server, library access enforced | Remove confirmed missing index entries after scans; separately allow owner-requested media-file deletion |
| Playback and Home | Per account where possible | Continue Watching age/count, season premieres, played threshold, completion policy |
| Music | Server analysis defaults, per-library overrides and account playback preferences | Smart shuffle, album-type grouping, loudness analysis, sonic analysis |
| Media analysis | Server queue with per-library overrides | Preview/chapter thumbnails, intro/credits/ad markers, voice activity, source and scheduling |
| Privacy and performance | Server owner, account permissions respected | Location-name visibility, worker priority/concurrency, applicable database cache budget |
| Appearance | Per-account settings shared by supported clients | Poster metadata pills on/off and compact values; existing mobile Family navigation cleanup |

Settings must persist, survive restart, and affect the corresponding job/player/library behavior. Show inherited defaults and overrides clearly. Unimplemented capabilities should not appear as working switches. Report actual queue state, failures and last successful scan; identify settings requiring restart.

## Incremental functional settings backlog

The groups below describe dependencies and desired behavior, not a single scheduled implementation pass. Select only settings needed by the feature being developed.

### Library updates

- Enable or disable automatic folder monitoring globally and per enabled library.
- Scan only the changed folder when partial scanning is enabled; coalesce repeated events and serialize conflicting scans.
- Separate music inclusion control; expose watch-capacity failures and use polling when native watching is unavailable or unreliable, including SMB/NAS storage.
- Periodic scan toggle and intervals: 15 minutes, 30 minutes, 1 hour, 2 hours, 6 hours, 12 hours, daily.
- Manual full and folder scans remain available. Avoid overlapping scheduled, automatic and manual work. Show next scheduled scan and last successful result.
- Folder-level scans merge only their authorized subtree. A missed watch event must still be recoverable by reconciliation/full scans.

### Cleanup and deletion

- Treat library “trash” as index records for confirmed missing media, distinct from deleting files on disk.
- Configurable cleanup after a successful scan. An unavailable share, denied access, interrupted scan or missing configured root must not be treated as proof that all media was removed.
- Separate Allow Media Deletion setting, off by default as a proposed initial default. Only the authenticated server owner can request file deletion, within authorized library roots, with a concrete file-specific confirmation and accurate partial-failure reporting.
- Preserve progress, artwork overrides and collection links where appropriate when a missing file is restored. Define retention/recovery behavior before automatic cleanup is enabled.

### Continue Watching and played state

- Weeks of inactivity to retain entries; maximum visible resume items.
- Optional inclusion of an unwatched season premiere after a previously watched season, even outside the age window. Respect unavailable/private/disabled media and existing watched state.
- Played threshold choices: 70, 75, 80, 85, 90 and 95 percent.
- Completion modes: selected percentage; first credits marker; final credits marker; earliest of percentage and first credits marker. Fall back to the selected percentage when a usable marker is absent.
- Use the same completion decision in web/native playback, saved progress and Home. Changing a display filter must not erase history or retroactively mark the library watched without an explicit operation.
- Preserve reading/audio resume behavior when video-specific preferences change.

### Functional release checks

Verify saved settings across restart, rapid file changes, add/rename/remove, nested folders, inaccessible SMB shares, interrupted jobs, supported platforms, owner/read-only permissions, and disabled/Free-entitlement libraries. For progress settings, verify edge thresholds, missing markers, TV premiere selection and consistent web/mobile behavior.

## Analysis and music follow-up

Every generation/analysis feature needs a real worker, durable job state, cancellation/retry, bounded resource use and per-library controls before its setting is enabled. Scheduling choices: Never; Scheduled maintenance; Maintenance and when media is added. Show disk usage and allow removal of generated artifacts without deleting original media.

- Generate seeking-preview thumbnails.
- Generate chapter thumbnails.
- Detect intros and expose working Skip Intro controls.
- Detect credits and use markers in completion policies.
- Detect advertisements and expose supported playback controls.
- Generate voice activity data for supported subtitle alignment workflows.
- Analyze audio loudness for actual leveling/transition support.
- Analyze sonic features for actual similarity/radio support.
- Smart music shuffle using available rating/popularity/recent-play data, with a normal shuffle fallback.
- Album grouping: Off/On, using LP, EP/Single, Compilation, Live, Demo and Remix metadata where present.
- Marker source: Local only, Online only, Online then local fallback. Requires a supported provider; provider access and marker uploads are separate choices. Do not silently send locally detected markers to an external service.

## Advanced and product-specific follow-up

- Location-name visibility: owner/admin only or permitted viewers. Enforce at the API/metadata boundary, not only through hidden labels.
- Lower-priority background workers and configurable analysis concurrency; platform-appropriate behavior and an explicit restart indicator where necessary.
- Database cache size only for a datastore/backend that supports it; show units, valid range and restart requirements. A numeric setting alone cannot tune JSON-file indexes.
- Optional iTunes XML import if the user needs it; no fictitious iTunes plugin toggle or restart requirement before an integration exists.
- Legacy-agent visibility only if Homestead actually supports legacy agents. Keep unsupported provider compatibility out of ordinary library setup.

## Related outstanding work

- Final UI polish includes [library count diagnostics](LIBRARY-COUNT-DIAGNOSTICS.md): labeled folder/title/video counts and a review view for merged, unsupported, empty, missing and unavailable entries.
- Mobile Family Home: remove repeated navigation cards beneath the header; this was not included in the server content pass.
- Poster metadata pill visibility belongs in Settings; use compact displayed values such as `S`, `32B`, `25`, with full labels available accessibly.
- Final visual polish can proceed before this backlog is implemented. During polish, do not style unsupported controls as enabled; add working settings alongside their related features over time.
