# Native Inventory support for companion v3.9

Development branch: `codex/public-v3-9-inventory`, based on main `622d4e2`, which includes the merged v3.7 and audiobook format recovery work. Nothing in this pass deploys a server, merges main, requests live provider data, or changes production records.

## Shared Inventory contracts

The native UI uses the existing intake Inventory records and canonical Yu-Gi-Oh printing files. It does not create a second mobile database. `GET /api/inventory/native` returns version 1, the current account ID, editing capability, records, binders and decks. Read access requires the existing Inventory entitlement, enabled library and account library access. Owner/admin writes also honor an explicit read-only flag. Existing server session checks apply to every route.

The native Add wizard supports manual entry, barcode lookup, Yu-Gi-Oh card name/passcode/set-code search, selection of an exact printing/artwork, physical-copy fields, existing binder/deck assignment, item photos and review before save. Barcode recognition runs on the phone. Existing server metadata providers are reused: generic UPC/ISBN lookup and configured UPCMDB for physical media. Individual cards use the existing YGOPRODeck search and printing mapper, not an assumed pack barcode. Card-photo recognition reuses the existing Tesseract/catalog recognition pipeline. Provider keys and configuration remain on the server. Live lookup, OCR, artwork/provider reachability and real camera scans remain unverified.

Native API additions:

- `POST /api/inventory/native/lookup`: barcode plus selected category; lookup does not create an item.
- `GET /api/inventory/native/cards`: name, setCode and/or cardId passcode; returns candidate printings.
- `POST /api/inventory/native/recognize`: one bounded JPEG/PNG imageData value passed to the existing recognition service; users must choose a match.
- `POST /api/inventory/native/items`: validated item draft plus stable UUID requestId; invokes the same intake completion/record adapter as the web wizard with Inventory as its only destination.
- `GET /api/inventory/native/requests/:requestId`: account-scoped save status; recovers an already-written record after an interrupted reply.
- `POST /api/inventory/native/requests/:requestId/resolve`: explicit confirmed review of an unconfirmed save. Active saves cannot be cleared. The original request stays recorded and is never replayed; a found record is returned instead of starting another save.
- `PATCH /api/inventory/native/items/:recordId` and its `/printings/:printingId` child: reuse existing item/printing update handlers and preserve unrelated fields.
- `GET /api/inventory/native/items/:recordId/photos/:index`: authenticated, bounded image response. Inventory list/status responses contain photo URLs and metadata, not embedded full-size photo bytes.

New generic Inventory fields persist quantity, condition, location, brand/model/serial number, purchase price/date and warranty date alongside existing metadata. Card summary edits remain separate from editing one physical printing. Canonical card edits now persist to both the shared index and canonical printing metadata; canonical reads retain intake photos, metadata and recovery identities rather than discarding them.

## Interrupted saves

Only the UUID is remembered in account/server-scoped device preferences. Draft/photos are not copied to those preferences. The server reserves a request before intake runs. Its small per-request file stores a payload hash, state and record ID in `data/mobile-inventory-requests`; it does not duplicate the full photo/metadata payload. Filename keys are hashes of account plus UUID. Corrupt/linked journal storage fails closed; do not delete journals to retry uncertain saves. Inspect/repair storage offline if needed, and check Inventory before making another physical-copy entry.

Successful intake without a confirmed Inventory record remains uncertain. A timeout never automatically resubmits a write. Reopening the wizard checks the pending save first. After explicitly checking Inventory, the user may resolve an unconfirmed save; this does not delete an item or the request history.

## Validation

`npm run test` includes 16 new fixture/API tests through `test:inventory-native`, plus the existing public and audiobook suites. Focused tests cover shared fields, exact printing identities, permissions, image bounds, concurrent/repeated saves, interrupted responses, adapter failures, explicit recovery, provider adapter boundaries, real record/PATCH handlers, canonical reads, corruption and linked storage. All test records and images are synthetic; provider calls are mocked. `npm run lint:inventory-native`, syntax checks and the production build are also required. Existing large web chunk warnings remain.

Native bridge/source checks and additional executable Swift model tests are included in v3.9. **Swift tests, Xcode compilation, camera/runtime checks and iPhone/iPad validation remain Pending Manual Device Testing on this Windows host.** Run `bash scripts/validate-ios.sh` on the Mac before installing.

## Delivery and verification

Review/publish this server branch separately, wait for the existing Docker image workflow, and update the server container only when authorized. The phone ZIP cannot update the running server. Existing account/billing/auth contracts are unchanged. The server package version remains the existing public release version; the new native endpoint and reviewed commit identify this support update.

On the device: open More → Inventory; verify every category, search, artwork, locations/warranties and existing binder/deck contents. Use + to create a disposable approved test item and Yu-Gi-Oh printing; verify web/mobile agreement, photo roles, card variant/edition/language/quantity/location, edits and cancellation. Test camera permission grant/deny, unsupported camera, repeated recognition, dismissal/background/rotation, and manual barcode fallback. Disconnect during save and confirm status recovery without duplicate quantity. Verify read-only/denied accounts and disabled Inventory access.

Reopen the actual 15-part City of Bones book after the server update and verify Listen, chapter order/advance and optional Read Along. Its generated-fixture regressions pass; actual production playback has not been tested. The blank EPUB report remains a separate open issue. Home cleanup, AI expansion and plugin/Worlds work are outside this pass. Binder/deck browsing and assignment are supported; advanced binder layout/deck editing, price-refresh management and dedicated electronics valuation flows remain in the web app.

Camera implementation reference: [Apple — Scanning data with the camera](https://developer.apple.com/documentation/visionkit/scanning-data-with-the-camera).
