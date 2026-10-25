# Library settings and clean-install testing pass

Movies and TV now use a single Library Settings action for Filter & Sort,
Appearance, and owner/admin discrepancy review. Collection-detail filtering uses
the same menu; the pencil editor, Activity, Add, and Search remain available.
The Movies/Collections and Shows/Collections navigation tabs are restored with
counts visible in both views. Collection loading/error labels are preserved.

TV's root header no longer gets overwritten by its detail-header effect on
initial load. Movie filters report their active state in Settings and restore
focus when closed. Settings and diagnostics support Escape, focus trapping,
and return focus to the Settings trigger when dismissed.

Validation on Windows, October 24, 2026:

- Production build passed (existing large-bundle warning remains).
- Seven final UI regressions, six server-content checks, request/collection
  checks, and Windows storage/setup API checks passed.
- Isolated browser: both navigation tabs and counts, empty collections, Movies
  filtering, initial TV filter availability, applied TV genre feedback,
  discrepancy review, and Escape/focus recovery passed. Fixture media only.
- The current iOS source remains v3.19 (20). Its source/JavaScript suite passed
  55 checks with one skipped Swift compiler check. Its complete tracked source,
  including the current NEXT-PASS notes, was zipped, checked against every
  source file, and copied to AppleStorage with checksum verification. Xcode and
  physical iPhone/iPad acceptance remain pending.

The refreshed Windows package must include the already-merged null-index Home
startup correction (`c013d41`), which was absent from Windows revision 5.
Installer and public download verification are recorded separately with the
release artifacts. No sustained connection or large-library loading claim is
made by this header pass.

Deployment history correction: the earlier local-image test was replaced via
PR #22 and GitHub's publishing workflow. The installed Unraid repository was
restored to `ghcr.io/tbritton0826/homestead:latest`, revision `fd9b129`, with
its normal update indicator working and all preservation checks passing.
Future server releases must continue through that published-image path.
