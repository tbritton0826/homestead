# Audiobook format recovery — October 16, 2026

Branch: `codex/audiobook-format-recovery`, based on current main `a08245c` (the merged v3.7 server changes).

## Confirmed defects

The nested book scanner recognized `audiobook/` as part of its parent work but created a separate group for `ebook/`. When the original scanner had already indexed both directories under one saved record, each group reused that record ID. The last group overwrote the earlier group: an ebook-only record could replace all 15 audio parts. A retained total-file count was not proof that the returned file list still contained audio. The earlier v3.7 tests exercised already-assembled records and missed this filesystem-to-record collision.

Both supported format directories now group under their parent before ID assignment. The book identity, existing metadata, and original file paths are retained; nothing moves or renames the files. The format lookup also recognizes legacy ebook-child records alongside authorized audio-child records. Unrelated same-title books remain separate.

Separately, web Listen published the audio queue without dismissing the book detail dialog. That dialog (z-index 9200) covered both existing player layouts (4500/4700). Listen now dismisses the detail dialog and explicitly opens the existing player. Music keeps its mini-player launch behavior; Listen does not enable Read Along.

## Verification

`npm run test:book-formats` runs the actual scanner against generated temporary filesystem fixtures (root EPUB, ebook child, 15 MP3 parts, persisted shared ID, cold/warm cache, and unrelated authors), the authorized format endpoint, the actual Listen handler, and the transformed global player. It is included in `npm run test`. Full public tests, focused lint, syntax checks, and production build passed. Existing large-chunk warnings remain.

No private production index, book, or media file was downloaded or changed. Actual production playback and iPhone/Xcode checks remain pending.

## Update and confirm

1. Review/merge this branch separately; publishing source alone does not update a running container. Wait for the existing GitHub Docker publish workflow, then update/recreate the server container using that image. No deployment is performed by this repair.
2. Refresh the Books library and reopen the book after restarting the updated server. A Books rescan can persist the repaired index if needed; it should not require moving files out of `audiobook/` or removing the `ebook/` folder.
3. In web Books, choose Listen and confirm the player opens, Part01 starts, all 15 parts are present in order, and next chapter works. Read Along remains a separate choice.
4. The native companion v3.8 adds matching ebook-child identity handling and keeps Check formats again visible even after a successful lookup finds no audio. Existing v3.7 native details should obtain the repaired audio list when reopened against the updated server. Install v3.8 for its native refresh-control improvement; run its Mac validation script first.
5. If the actual book still has no audio, inspect its selected authorized record/format response through a separately approved diagnostic session. Do not broaden matching by title or accept a caller-supplied filesystem folder as authorization.
