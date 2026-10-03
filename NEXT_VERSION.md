# Homestead 0.6.8 — Adult library polish and display normalization

- Adult Home uses horizontally scrolling Recent Profiles and Birthdays panels, then separate full-width Performer and Celebrity recommendation rows.
- Public discovery uses bounded occupation queries, independent provider failures, deduplicated cache and a labeled stale-cache fallback. No paid provider is required.
- Models.com is optional, strong-identity, fill-missing enrichment. Name-only matches and blocked public pages contribute no data. Existing values/manual locks are preserved.
- Adult Photos uses the normal Photos components, library/album-scoped Appearance settings and a private-library-only photo picker.
- Adult Videos uses smaller cards and conservative display-only filename parsing, with only studio/source and date pills. No media files are renamed.
- One central formatter applies account date/height/weight/body-length preferences to display and typed metadata editors. Saves retain ISO dates and explicit canonical cm/kg units; no bulk rewrite of legacy metadata.
- Profile artwork is contained in its hero stacking context; tool dialogs render above it in a body portal.
- Includes the already-live null-user guard when updating account-preference normalization. No plugin installation, infrastructure cleanup, Bindery, rembg or deferred feature changes.
- Verified: 26 local regression suites, production build, and negative-time-zone date tests. Live Unraid/iPad validation remains necessary. Models.com returned an access challenge from the build environment; fixture parsing/identity/merge tests pass, but live enrichment is not claimed.

# Homestead 0.6.7+hotfix.1 — Library navigation scroll

- Reset the shared library content panel and document scroll when changing libraries, before painting the destination. Covers desktop, kiosk and mobile scroll containers.
- Leave the sidebar, horizontal rows, player queues, same-library filters and polling updates alone. No timers or delayed resets.
- Focused scroll hotfix only; the next-pass feature list and Adult discovery/preferences are unchanged.

# Homestead 0.6.7 — Media polish, Read Along, and matching controls

- Audiobook player adds Queue / Chapters / Read Along. A paired EPUB/PDF opens in a compact reader while audio continues; chapter filenames distinguish queue entries. Page turning is manual, not narration-synchronized. EPUB display no longer waits for full-book location indexing.
- Book Actions has Fix Match with title/author/ISBN searches, candidate identity details, explicit conflict confirmation, and persistent manual locks. Selected book details refresh after metadata changes. No import/move pipeline changes for books.
- Owned music artists use a confirmed MusicBrainz ID or one unambiguous exact normalized name. Removed first-result fallback. Added Fix Match to owned artist actions, disabled catalog requests for unresolved identities, and recognizes CD/Disc subfolders as part of the parent album.
- Artwork actions open a thumbnail picker with current/local choices, provider choices where available, uploads, Save and Cancel. Books browse covers from the matched Open Library work's editions. Full movie/TV alternate images use TMDB_API_KEY when configured; otherwise use images provided by Seerr and local/upload options. The UI explains unavailable provider choices.
- Owner/admin artwork saves validate the indexed target and library access. Uploads are bounded, decoded/re-encoded, and stored under unique names without overwriting existing art. Artwork choices persist separately from identity and survive later Fix Match/Auto Match.
- Media Home memoizes movie metadata derivation instead of reparsing the complete match cache per movie per render. Unchanged request heartbeat timestamps no longer replace root request state. Server-side request reconciliation reuses metadata/file evidence within each poll; discovery posters lazy-load.
- Home displays Continue Watching and Recent Activity side by side on desktop and stacked on mobile, with horizontal Continue Watching overflow.
- Downloads and Media Tools / Downloads share a transfer/import diagnostic view with provider-reported progress, ETA/speed when supplied, errors, and no made-up percentages. Monitored Lidarr items without queue entries stay Requested. Transfers are read-only in this pass; pause/resume/retry remain in provider diagnostics.
- Tests: all 24 local regression suites and production build. New tests cover artwork author/ID isolation, restricted access, manual locks, unsafe image paths, artist ambiguity, multi-disc albums, request state identity, transfer rendering, and EPUB initial-display order. A 400-movie / 10-render fixture reads the match cache once and invalidates on metadata changes.
- Not live-tested against the user's Unraid/provider instances or physical playback devices. No CarPlay features, offline downloads, synchronized narration, or changes to private plugins.

# Homestead 0.6.6 — Requests, trailers, and editable collections

- Separates Requests into Movies, TV, Books, Music, and YouTube horizontal shelves, with smaller cards, status pills, spacing and all five header counts from the same snapshot.
- Pages through all Seerr requests, deduplicates media identities, and polls visible request/search views every 8 seconds (30 seconds elsewhere). Static artwork warms in a bounded background queue.
- Request details poll lightweight lifecycle state every 5 seconds; verified playable local movies override stale Seerr processing status. One local TV episode remains partial unless Seerr confirms the request is available.
- Provider-confirmed imports trigger a scan of only the affected Movies/TV library, sharing watcher locks and a two-minute retry throttle. Download completion alone is never availability. Stalled mappings and scan failures remain visible.
- Movies/TV filesystem-watch debounce drops from 45 to 15 seconds of quiet, so imports can be indexed sooner even while Seerr's media-server status is behind.
- Refreshes the browser's media index when the scanned index changes. Includes richer request details and actual collection browsing, with optional IMDb/RT ratings and no empty score boxes.
- Finds trailers in Seerr's relatedVideos/videos data and plays them in the existing overlay. Offers a YouTube search fallback when no playable trailer is returned. Removes Watchlist only on request/search details.
- Makes original smart/metadata collections editable in the collection picker and member editor. Defaults/timeline move to JSON assets; first manual edit persists membership under the same ID, retaining artwork and imported watch-order keys.
- Fixes the member editor not opening from collection details, separates membership from exact playback-order editing, and keeps deliberately empty custom collections visible.
- Removes the redundant Photo Albums heading/count panel; album headings and explicitly selected banner artwork remain supported.
- Keeps Books import/matching repairs deferred. Existing Bindery/Lidarr acquisition jobs are displayed without changing their importer behavior.

# Homestead 0.6.5 — Search artwork and album appearance

- Owned global-search results retain local and saved-match artwork, with fallbacks and recovery when artwork changes.
- Renames the public Photos header to Photo Albums and moves artwork controls into the global Appearance menu.
- Saves album-specific backgrounds, banners, sidebars and layout overrides without modifying the Photos library or other albums.
- Isolates album-uploaded files by user, album and artwork target while retaining legacy library image URLs.
- Moves the YouTube series Back control to the top-left and groups poster/banner uploads and settings under a matching appearance icon.
- Retains Media Home, unified requests, Auto Match and the previous pass; Books download/import remains deferred.

# Homestead 0.6.4 — Conservative Auto Match and Photos

- Fixes Media Home's header initialization crash (enabledLibraries used before initialization).
- Unifies movie/TV/book/music search request pills in quick search and All Results, with per-account request history and duplicate protection.
- Adds asynchronous music artist/album/track and book matching after scans, including CLI/import scans detected through the media index.
- Requires compatible title and author/artist identity; mismatched ISBNs, editions, album versions, durations and provider IDs need review.
- Preserves manual matches across scans/restarts and protects a manual save made during a lookup.
- Adds persisted Needs Review results, per-item retry, manual search/confirmation and a library auto-match toggle.
- Removes title-only metadata aliases for books/music so same-title records cannot inherit another item's match.
- Metadata auto-matching links existing Lidarr identities read-only. The explicit Link Local Artists action remains separate; Auto Match does not add/monitor/download catalogs.
- Replaces Photos cloud cards with uniform poster cards, adjustable fit/corners/size/opacity and album-poster choices.
- Adds paged Photos browsing for library background, Photos banner and sidebar art, alongside native upload/clear controls.
- Leaves the unresolved Books download/import workflow unchanged.

# Homestead 0.6.3 — Music polish pass

- Parses local song titles from embedded tags or cleaned filenames instead of reusing the album folder for every track.
- Keeps album folders as album metadata and removes track-number/artist prefixes from titles.
- Uses compact responsive track cards with artist artwork on the Songs page.
- Aligns article-insensitive sorting with alphabet-rail buckets so A/An/The artists and songs jump correctly.
- Makes Shuffle All a persistent, reversible queue that advances automatically.
- Keeps Queue and Lyrics panels open between tracks and prevents the expanded player from clipping them.
- Publishes Media Session position state alongside play, pause, seek, previous, and next actions.
- Leaves Books/Bindery behavior unchanged for a separate follow-up pass.

# Homestead 0.6.2.1 — Acquisition status hotfix

- Keeps acquisition state live on the full All Results page instead of freezing the search-panel snapshot.
- Reconciles Bindery catalogue results with Bindery's library and queue, including requests made directly in Bindery.
- Displays import failures as Needs Attention and prevents duplicate requests while a book is already wanted, downloading, importing, failed, or available.
- Continues polling recoverable Bindery failures so Retry Import can advance back through import and Homestead scan.

# Homestead 0.6.2 — Bindery and Lidarr acquisition pass

- Adds Bindery as the primary Books automation service while keeping Readarr available for legacy libraries and migration.
- Extends Global Search with Bindery book and Lidarr artist/album results plus one-click Request actions.
- Persists request lifecycle state through requested, downloading, importing, scanning, available, and needs-attention stages.
- Polls Bindery and Lidarr in the background and automatically rescans Books or Music only after the provider reports a completed import.
- Links existing local Music artists to Lidarr by MusicBrainz ID first and exact name second, adding metadata-only links unmonitored without triggering missing-album searches.
- Supports Roman-numeral YouTube seasons immediately after a series name, including Hermitcraft V, IX, X, and XI.
- Adds independent poster, banner, position, opacity, darkness, and blur controls to every YouTube series page.
- Removes the redundant Collection action from the global video player; collection membership stays on detail/video cards.

# Homestead 0.6.1 — Music and Books pass

- Repairs YouTube season inference when downloader hashes contain misleading numbers and restores creator artwork through local-first fallback and authenticated caching.
- Replaces the Songs page's oversized rows with a compact responsive track layout and correct alphabet jumps.
- Gives Shuffle All a persistent queue with automatic next-track playback, previous/next, shuffle, repeat, Queue, and Lyrics controls.
- Replaces slow Books detail navigation with an instant overlay, cached/lazy cover loading, EPUB/PDF reading, audiobook chapter playback, and author-library navigation.

# Homestead 0.6.0 — YouTube and global player pass

- Uses TubeArchivist channel metadata first and YouTube Data API fallback.
- Normalizes archived episode titles and resolves thumbnail fields plus local sidecars.
- Opens every series card into Season → all creators by release date.
- Adds persistent manual series posters and per-video custom collection actions.
- Uses the YouTube modal/native-controls design for Movies, TV, and YouTube.
- Shows live checkmarks on Watchlist and Collection buttons.
- Condenses collection ribbon commands into Display By and Manage overlays.

# Homestead 0.5.9 — TV identity and collection-order final pass

- Split duplicate-title TV shows by stable scanner ID, exact folder path, and release year.
- Migrate legacy Charmed, Avatar, and Being Human title aliases to the correct year-specific records.
- Reject stale aliases whose saved local ID belongs to a different scanned show.
- Require an exact candidate release year when the TV folder supplies one.
- Persist manual Fix Match locks against the exact local show across scans and restarts.
- Keep release years internal for matching while hiding them from TV poster labels.
- Retain exact per-episode collection ordering, imported-order editing, and independent collection backgrounds.

# Homestead 0.5.8 — Collections and accounts pass

- Fix the MCU collection crash by moving episode thumbnail/video lookup into shared collection scope.
- Add Books as first-class custom collection and manual watch/reading-order members.
- Allow exact per-episode imported order editing with drag-and-drop plus controller-friendly arrow controls.
- Add independent uploadable backgrounds and appearance controls to every collection.
- Persist legacy browser-only metadata matches so posters render consistently for other accounts and private sessions.
- Filter library indexes, header statistics, YouTube data, and local file access by each account's assigned libraries.
- Store default and named watchlists separately for every signed-in account while keeping collections shared.

# Homestead 0.5.7 — Collections episode and MCU pass

- Show only playable videos in collection episode timelines.
- Deduplicate scanner/trickplay assets to one row per SxxExx episode.
- Display the clean episode title while retaining the episode-code pill.
- Resolve MCU timeline ownership through one bounded title/version index.
- Replace recursive media wrapper traversal with a cycle-safe iterative lookup.

- Never overwrite an automatic Movie/TV canonical record with its own alias.
- Allow dangling Avatar 2024 and Charmed 2018 matches to be rebuilt.
- Remove years from the TV poster grid.

- Stop using display titles as TV metadata identities.
- Bind automatic and manual TV matches to stable folder/local IDs.
- Preserve the year in Fix Match searches and show it on TV cards.

- Preserve release years in TV scanner keys so same-title remakes coexist.
- Add season/episode download progress overlays.
- Share Seerr person pages across Movie and TV cast cards.
- Route related media by local ownership and restore local poster fallbacks.
- Standardize compact horizontal detail ribbons.

- Locks manually corrected TV matches to their exact local show identity.
- Resolves automatic-match aliases before deciding a show is already matched.
- Runs post-scan exact-title matching without replacing a manual lock.
- Keeps TV Add actions in TV search, import, and metadata tools.
- Bounds and deduplicates MCU collection resolution.
- Quietly handles profiles without metadata.json and adds a safe web-manifest fallback.

- Search-only links no longer count canned descriptions as biography.
- Source reports distinguish metadata contributors from identity and browse-only matches.
- Detail ingestion reads JSON-LD and follows supported public profile result links.
- Global Add exposes expanded identity, appearance, career, relationship, and social fields.
- Missing sizing data remains blank rather than being estimated.

# Homestead 0.5.3 — Person discovery and Activity Center

## Activity and notification center

- Activity Center now combines intake history with persistent background jobs.
- Live metadata searches, metadata refreshes, and Movies/TV scans report status,
  progress, provider/source details, completion, and failures in one dashboard.
- Active work is counted separately from items that need attention.
- Interrupted jobs survive a Homestead restart and return as reviewable items.
- Completed entries can still be removed automatically without touching the
  linked library records.

## Metadata change approvals

- Bulk Adult metadata refreshes no longer overwrite profiles automatically.
- Each provider change is staged as a field-level approval with previous and
  proposed values.
- Owners/admins can accept selected fields, reject them, or keep the current
  values and lock those fields against later automatic refreshes.
- Accepted related changes use the canonical metadata update service and create
  one combined timeline event with audit history.
- Manual fields and explicit locks are excluded before proposals are created.

## Global Add workflow

- Performer and Celebrity creation now follows Search → General → Sizes →
  optional Social → Media & Sources → Summary → Create.
- Search combines matching identities from enabled sources into one result while
  retaining each source candidate and its provenance.
- Bra band and cup are separate fields. A combined source value remains
  available when a provider supplies it.
- Personal creation remains manual: General → Sizes → Media & Folder → Summary.
- Personal profiles can link an existing folder in place or use the device's
  native file picker for imports.
- The global Home Add menu now offers Performer, Celebrity, and Personal flows
  directly.

## Global Search and source packs

- Global Search is browse-only for people; selecting a result opens an overview
  with Sources, Photos & Videos, and optional Social tabs without creating it.
- Advanced Person Search was removed from Global Search. Browse Content, Search
  by Photo, and View All remain available.
- Same-name source results are aggregated into one Celebrity or Performer card.
- Matched and searchable sources are displayed on that card, including enabled
  content sources such as Pornhub, Tiny4K, and ExxxtraSmall.
- Sources remain independent adapters and are organized into Public People,
  Adult Performer Metadata, and Adult Content source packs. This keeps each
  adapter independently replaceable and plugin-ready.

## Adult Home polish

- Recently Updated cards show compact timeline-style changes, for example
  `Panty size: 6 → 12 · Bra band: 34 → 32`.
- The old `Local recommendation` copy is no longer shown.
- Adult Home poster cards use one fixed aspect ratio and collapse to their actual
  content height, removing leftover gray space below the copy.

## Startup reliability

- Recursive Movies/TV filesystem watching and polling now run in a child worker.
- The API event loop no longer walks Unraid/FUSE media folders during startup,
  allowing `/api/platform` and installer health checks to respond immediately.
- Automatic scan activity is reported in Activity Center.

## Retained behavior

The overlay includes the Homestead 0.5.2.2 metadata timeout fixes when upgrading
directly from 0.5.2+hotfix.1. Authoritative profile metadata, backdated
timeline history, undo/revert, field locks, structured recommendations, Movies
0.4.3, TV 0.4.4, account permissions, plugins, mappings, appearance, and media
files are retained. The installer backs up changed source and automatically
restores the prior source/image if validation or startup fails.
