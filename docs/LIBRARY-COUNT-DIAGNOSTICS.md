# Library count diagnostics

Status: implemented for Movies and TV through Review discrepancies in library settings; Movies also has a direct library action. Read-only root inspection distinguishes partial results from unavailable storage. See FINAL-UI-POLISH-QA.md.

Large libraries need counts whose meaning is clear and discrepancies that can be inspected without terminal commands.

## Count summary

Keep the normal library count labeled as movie records/titles. In the scan result or library settings, expose a compact breakdown:

- Folders found on disk within the scanned roots.
- Indexed movie records, including records with no supported video.
- Records with at least one indexed supported video. Do not describe these as verified playable unless playback/probing has actually been checked.
- Disc-image/unsupported-media-only records.
- Empty folders and folders containing only artwork/metadata, distinguished where possible.
- Merged groups, with the source-folder count for each group and the resulting reduction in record count.
- Unindexed folders, stale index references, unreadable/unavailable folders and skipped links when detected.

Example from the user's comparison: 439 disk folders, 435 movie records, 433 records with indexed supported video, four two-folder merged groups, one ISO-only record and one empty record. These are different measures, not interchangeable totals. A group's supported video count does not prove that each of its source folders contains video.

## Review discrepancies

Provide a single action near the count/scan summary that opens a searchable/filterable list. Each result identifies the title, source folder(s), reason/status, indexed video count and relevant file extensions. Show last scan time, scanned roots and scan success/completeness so the comparison's scope is visible.

- ISO-only: **Disc image — playback unsupported** for the current implementation. Finding an ISO must not imply ISO playback support.
- Empty: **No media found**.
- Artwork/metadata only: identify that condition instead of treating it as an empty directory.
- Merged: show every source folder linked to the record. Punctuation/case normalization is not proof of identical file contents or duplicate copies.
- Unavailable storage/access failure: display the error separately; never infer empty/missing media from an unsuccessful scan.

Use existing detail navigation and authorized rescan/open-folder actions where supported. Diagnostics are read-only by default; do not automatically delete, move, unmerge or rename files. Keep access scoped to permitted libraries and folders. Comparisons with Plex or another catalog require that catalog's actual inventory, not count arithmetic alone.

For other libraries, apply equivalent labels appropriate to their entities and files. Avoid mixing artist/album/track counts, show/episode counts, or album/photo counts under one unlabeled number.
