# Book scanning, matches and edition separation

This fix addresses distinct novels collapsing into one title, failed edition
unlinking, and saved matches disappearing from the web library after refresh.
It does not move, rename, duplicate or delete original media files.

The live library and background scanner now use the same book grouping code.
Multiple named EPUBs in `Author/Series/` become separate books. Files with the
same work title in different formats can remain together, and audiobook parts
join an identifiable work rather than the entire series. An author/title match
alone never transfers an existing ID between different folders or storage roots.

Existing IDs, chosen artwork and timestamps are retained when exact file
membership identifies a single previous record. When splitting a previously
collapsed record, the old ID is reused for at most one uniquely identified work,
using the saved match title and explicit alternate titles in filenames. A match
is never broadcast to all the newly separated novels. Unresolved historical match
records remain in `metadata-matches.json`; new records retain `splitFromIds` for
review rather than guessing where that metadata belongs. Exact-file bookmark
lookup and preserved path aliases keep reading positions usable after ID/path
normalization, without transferring a bookmark to a different novel.

Older live scans used a hash of the exact ebook path as their metadata identity,
while CLI scans used a filename slug. The shared scanner checks those historical
path hashes and reconnects an existing match through `localId`, keeping the
current row ID for collection membership. It chooses among verified identities
using saved update times, never a title/author-only search. Historical metadata
records and cover URLs are not rewritten. A read-only production inspection and
an offline scan of its book-only API snapshot verified this recovery path before
release; that dry run did not modify the server.

Server-loaded matches are retained in memory; browser storage is an optional
cache. Failed browser writes preserve the previous cache, and failed match loads
show a retry message. Unreadable server match/edition-link storage fails closed
so saving cannot overwrite damaged data with an empty set.

Unlinking saves an explicit separation on the server for the current account.
That separation overrides automatic work grouping after reload and restart.
The UI changes its links only after the server confirms the save. Errors remain
visible and recoverable. An empty server link set is authoritative; a stale
browser cache no longer resurrects deleted links or another account's choices.

## Release acceptance

Use the normal reviewed GitHub/GHCR → Unraid update path. Before the first
production rescan, preserve independent copies of `media-index.json`,
`metadata-matches.json`, and `next-version/book-edition-links.json`, plus existing
artwork recovery points. Do not clear browser storage, delete match records or
overwrite current indexes with a historical snapshot as part of this update.

Verify the deployed revision, book roots and existing saved-match counts first.
Check Alex Cross and Maximum Ride before/after one book scan, refresh, and server
restart. Confirm separate titles, retained matches/covers, a known reading
position and persistent unlinking. If an old collapsed record cannot be mapped
unambiguously, review its retained metadata and exact file identities rather
than asking the user to rematch the whole library or applying one cover to every
novel. Deployment and production-data reconciliation are separate from the
isolated acceptance tests; do not claim existing production matches restored
without inspecting them.

`npm run test:book-formats` runs filesystem/CLI/live-scanner parity, 33/11-novel
fixtures, repeated scans, metadata-cache failure, failed saves, persistent unlink,
damaged-storage preservation and bookmark identity tests. Also run `npm test`,
`npm run test:customer` and `npm run build` before release.
