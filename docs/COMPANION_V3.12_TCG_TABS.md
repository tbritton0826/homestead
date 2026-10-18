# v3.12 (build 13) — TCG fixes and library tabs

October 17, 2026. Server and app branches: `codex/public-v3-12-tcg-tabs`.

## Included

- TCG lookup accepts a name, printed set code or passcode. Choose multiple printings from a name search, configure quantity/condition/edition/language, artwork, up to four photos and physical location per group, then review and explicitly Add all copies. Up to 30 groups and 20 MB of prepared photos per queue.
- Cards show one master record with total owned copies and location breakdowns. Physical locations include decks, binders, bins/boxes, loose cards and custom locations. Create/rename locations; binders have page/pocket fields. Move some or all copies without changing totals. Deck build references do not increase owned quantities. Wishlist remains separate.
- Share storage retains all holdings that share one set folder. Card/printing edits, quantities, condition, costs, notes and photo references persist to the Inventory share. Card snapshots and location membership JSON support cold reload. Successful queue entries and partial moves are not replayed after an interrupted reply. A saved queue can explicitly repair missing share files without importing more copies.
- Prices require a matching set code AND rarity. An absent/zero/conflicting quote is unavailable, never another printing's price. Generic USD estimates remain separate; no EUR amount is labeled USD. Manual estimates and purchase costs survive refresh. Provider set/rarity estimates do not establish edition/condition/language-specific prices. Existing incorrect provider values need Refresh printing prices after the server update.
- Music: Songs, Artists, Music Videos, Albums and Playlists, including Shuffle All and ordered playlist creation/editing from available files. Albums support both indexed album groups and ordinary artist/album folders.
- YouTube: Creators, Series, Playlists and Collections, with playable native lists and manual grouping wizards. Automatic series remain scoped to their creator. Only deliberately selected manual groups combine creators. Group membership/order uses the existing shared server collection API.

## Server update and share layout

The companion ZIP does not update the running server. Apply/review the enclosed `Server-Update/server-v3.12-after-v3.10.patch` on a development checkout containing server commit `662c5ab` (or its equivalent merged v3.10 support). New phone features need this server update. Nothing was merged or deployed here.

Retain the writable Unraid host `/mnt/user/Inventory` → container `/media/inventory` mapping (or an intentional HOMESTEAD_INVENTORY_ROOT override). Back up Inventory and server app data before upgrading the running installation. Existing card directories and older snapshots are retained; generated metadata changes are not downgraded automatically.

Share files:

- `tcg/yugioh/<card>/<set>/metadata.json`: backward-compatible printing metadata plus all holding groups for that folder; per-group photos below `photos/`.
- `tcg/records/<card-id>.json`: complete master card snapshot. Edits retain verified existing printing directories instead of creating duplicate holdings after a set/title edit.
- `tcg/locations/<kind>/<location-id>/metadata.json`: location name/details. Stable IDs keep folders stable when renamed.
- `tcg/locations/<kind>/<location-id>/cards/<card-id>.json`: quantity and holding references for that location. Empty membership tombstones preserve history; they do not count as owned copies.
- `tcg/wishlist.json`: wanted cards; excluded from owned cards/quantities.
- `tcg/receipts/`: save confirmations used to distinguish complete share saves from an index-only or interrupted write.

## Verification completed on Windows

- Full server `npm test` passed, including 33 Inventory/TCG checks. These exercise actual canonical read/write functions against generated temporary share files, multiple holdings in one set folder, photo recovery, edits/removal, move quantity conservation, strict prices, preserved manual estimates, group normalization, failed-entry-only retries, concurrent request locking, stale-index nonce recovery, share repair and permission boundaries.
- `npm run lint:inventory-native`, `node --check server.cjs`, production web build and diff whitespace checks passed. Existing large web bundle warning remains.
- App JavaScript/source checks: 51 passed, zero failed, one skipped because Swift is unavailable. New executable Swift model tests cover tab mapping, folder albums, creator-scoped series, ordered authorized memberships, queue payloads and missing-price editing. They have not run on this Windows host.
- Read-only public provider inspection found Red-Eyes Dark Dragoon MP22-EN264 currently reports set_price zero. It is therefore unavailable in the new matching logic. See https://ygoprodeck.com/api-guide/ for provider field scope.

## Pending Mac and device verification

Run `bash scripts/validate-ios.sh` from the fresh extracted folder. This runs the app checks, `swift test`, and an unsigned iOS Simulator Xcode build. **Swift compilation, Swift tests, iPhone/iPad interaction and production share writes are unverified.**

1. On iPhone/iPad, More → Inventory → TCG. Test each subtab and contextual +. Create a deck, binder, box and custom location using an approved test collection.
2. Search one card name, queue several set/rarity variants, choose different quantities/conditions/locations/photos, edit queued entries, use Back and review before Add all. Verify total quantity and exactly one master card entry on web/mobile after refresh.
3. Move one copy from a multi-copy holding to another location. Total must remain unchanged; check both location membership files. Rename a location and edit a printing, then restart/reload server index and compare all fields/photos.
4. Interrupt a queue save, reopen the app and Check save status. Retry only unsaved groups. If an existing entry has an unconfirmed share save, repair its share files; no extra copies should appear. General Inventory's existing save recovery remains separate.
5. Refresh prices. RA01 missing rarities must not all borrow the same unrelated quote; MP22 missing quote stays unavailable. Set a manual estimate and purchase cost, refresh again and confirm both remain. Change set/rarity and confirm the previous provider quote is invalidated.
6. Check Music songs/artists/videos/albums, Shuffle All and playlist creation/edit/order. Check YouTube creators/series/playlists/collections; create a manual collection containing selected videos. Refresh web/mobile and verify server persistence. Unavailable saved paths must not become playable.
7. Repeat read/write checks with owner, administrator, viewer, denied-library and disabled Inventory entitlement accounts. Verify network errors remain visible and controls do not bypass server permissions.

Deferred: blank EPUB reader report, home cleanup, additional AI integrations/workflow controls, standalone AI Photos/hide-PIN behavior, plugins/Worlds and Plex-style remote access. These were not included in this pass.
