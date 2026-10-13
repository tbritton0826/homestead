# Artwork recovery snapshots

Homestead saves the existing `metadata-matches.json` and `media-index.json` before a meaningful metadata write, library scan, or artwork relink. Fix Match also saves existing `poster.jpg` / `fanart.jpg` before replacing them. Previously both paths produced timestamped directories without retention; frequent metadata writes copied the complete indexes even when unchanged.

New snapshots retain the timestamped directory layout and `backup.json` fields used by older versions, adding content hashes and protection status. Existing index snapshots and legacy `*-fix-match-*` artwork directories remain readable. Identical source contents reuse the newest matching point instead of copying the full files; identical serialized metadata writes are skipped entirely.

## Retention settings

Set these environment variables on the Homestead server/container and restart it:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOMESTEAD_ARTWORK_RECOVERY_MAX_SNAPSHOTS` | `20` | Maximum recent **unprotected** snapshots, across index and artwork snapshots |
| `HOMESTEAD_ARTWORK_RECOVERY_MAX_AGE_DAYS` | `30` | Remove unprotected snapshots older than this age |
| `HOMESTEAD_ARTWORK_RECOVERY_MAX_GB` | `5` | Total recognized snapshot storage budget in GiB (5 × 1024³ bytes), including protected points |

Values must be positive numbers; the snapshot count must be an integer. Invalid settings fail startup rather than silently using unsafe values. All three thresholds apply: being under the count limit does not exempt an old snapshot or an over-budget directory.

Pruning runs after a successful new snapshot, on server startup, and every 24 hours. It removes the oldest eligible points first. Protected snapshots are never removed. Safety takes precedence over thresholds: Homestead retains the newest validated recovery point for each index file, plus a validated artwork recovery point when available. These points can exceed the age/count/budget limits. A protected collection can exceed the budget; logs report this rather than removing protection. No pruning occurs if no valid recovery point can be found.

Only recognized, flat snapshot directories containing regular files are candidates. Symlinks, junctions, foreign directories, malformed manifests, and incomplete `.writing-*` directories are left alone and excluded from the reported budget. Review those separately; their storage may make disk usage exceed the managed budget. An archived snapshot directory inside `artwork-recovery` is not an active recovery point and is not automatically removed.

## Inspect, protect, and prune

Commands operate on local filesystem data, using `HOMESTEAD_DATA_DIR` (default: the checkout's `data` directory). They never contact a remote server. Point this variable at the correct mounted data directory before running maintenance. Make an independent backup first when restoring.

```sh
export HOMESTEAD_DATA_DIR=/app/data
npm run artwork:recovery -- list
npm run artwork:recovery -- protect EXACT_SNAPSHOT_DIRECTORY_NAME
npm run artwork:recovery -- prune
npm run artwork:recovery -- prune --apply
```

`prune` is a dry run unless `--apply` is supplied. Protection uses a `.protected` marker and also honors `protected: true` in a manifest. To remove explicit protection, use `unprotect NAME`. Protected points do not consume the unprotected count allowance, but their storage consumes the budget. Nothing in this change automatically deletes the manually archived production files.

## Restore indexes

**Stop the Homestead server and scan/import workers before applying a restore.** The snapshot lock coordinates snapshot creation, pruning, and restoration; it does not lock unrelated scanners or every media-index writer. Do not run restores against a live application.

```sh
npm run artwork:recovery -- protect EXACT_SNAPSHOT_DIRECTORY_NAME
npm run artwork:recovery -- restore EXACT_SNAPSHOT_DIRECTORY_NAME
npm run artwork:recovery -- restore EXACT_SNAPSHOT_DIRECTORY_NAME --apply
```

The first restore command validates and reports which index files would be restored. `--apply` validates the point, creates a **protected `before-restore` checkpoint** of the current files (even if current JSON is damaged), stages replacements, and renames each file atomically. A failed replacement rolls back replacements already completed. A machine/process crash between the two index-file renames cannot make the pair atomic; rerun the restore while the server remains stopped, using the protected checkpoint if the previous state is needed. Missing files in an old snapshot do not erase current files. Restart Homestead after checking the restored data. Inspect the protected checkpoint and explicitly unprotect it only when satisfied.

The existing `/api/admin/artwork/recover` endpoint still **relinks artwork references**; it does not restore a historical snapshot. Its behavior and API contract are unchanged.

## Restore artwork files

An artwork-only backup does not have a trustworthy destination path (legacy backups only contain a folder hash). The restore command deliberately refuses automatic artwork placement. Protect that point, stop Homestead, independently back up the intended media folder's current artwork, and manually copy its `poster.jpg` / `fanart.jpg` into the **verified original media folder**. Use the folder hash to cross-check the destination if necessary; do not infer the destination from a series title alone. Restart and run artwork relinking afterward.

## Locking and failures

Snapshot creation, local index restoration, and cleanup share an exclusive `.lock` directory. A second operation receives `RECOVERY_BUSY`; periodic checks retry the next day. The lock is not expired while its owning PID is alive. Abandoned locks are automatically recovered only when their owner is on the same host and that PID no longer exists. Reclamation itself is serialized by `.lock-reclaim` so concurrent reclaimers cannot steal a fresh lock. Unknown/missing owners fail closed. If a crash leaves a lock without a readable owner, a `.lock-reclaim` directory, or the hostname changed, first stop every Homestead/maintenance process, inspect it, and remove only those confirmed abandoned lock directories. Incomplete `.writing-*` and `.pruning-*` directories are not automatically deleted.

Logs contain operation names, counts, byte totals, and error codes, never index contents, media paths, provider URLs, or raw filesystem error messages. Snapshot failures prevent the protected metadata/artwork write. Pre-scan backup failures retain the existing scan error-handling behavior (a warning); inspect those warnings before relying on recovery coverage. Cleanup failures do not invalidate a successfully saved recovery point.

Run `npm run test:artwork-recovery` to exercise this behavior using isolated temporary data, never the production recovery directory.
