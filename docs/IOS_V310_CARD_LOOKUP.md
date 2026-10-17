# Companion v3.10 — Yu-Gi-Oh lookup and card camera

Branch: `codex/public-v3-10-card-recognition`, based on the v3.9 Inventory commit `85e2a66`. This is a focused follow-up; it does not merge, deploy, change customer authentication/billing, or write production Inventory records.

## Confirmed cause and fix

YGOPRODeck removed `tcgplayer_data` from API v7. Homestead sent it for both name/passcode queries and full-catalog refreshes. A read-only live diagnostic confirmed the old request returns HTTP 400 (unrecognized parameter), and the supported request succeeds. Both requests now omit that option. Full-catalog downloads retain the existing 24-hour local cache.

A printed set code works by itself and takes priority over a stale/misspelled card name on both the web intake route and the native gateway. Passcode searches remain supported, including narrowing to a selected set. A code or numeric passcode typed in the name field is also recognized. Whitespace, case and pasted Unicode dashes are normalized. A provider no-match response becomes an empty candidate list; actual provider failures remain errors.

The corrected production lookup function was exercised against the public catalog with `CORI-EN029` and a lowercase name. It returned card `7894706`, The Chaotic Phantasmal Sacred Beasts, with Secret Rare, Starlight Rare and Ultra Rare printings. This verifies public lookup, not an import into the user's Inventory. The user still selects the physical printing and explicitly saves.

## Native camera

The trading-card wizard hides ordinary barcode lookup. Scan card with camera captures the card face through the system photo camera, then sends a bounded prepared JPEG to the existing authenticated `/api/inventory/native/recognize` OCR/catalog service. Choose a card photo uses that same path. Camera access is requested explicitly; denied/unavailable devices retain photo/manual alternatives. Cancel/background/dismissal releases the camera delegate and repeated callbacks are suppressed. Recognition does not save a card automatically.

The server already contains `recognizeYugiohCard`, image preparation, Tesseract OCR and catalog matching; the Docker image installs Tesseract. This pass connects native camera capture to that existing capability rather than adding a second recognition backend. This is text/OCR-assisted card identification, not artwork-only visual similarity matching. Glare, card framing and OCR quality still need device testing.

## Validation and delivery

- Full `npm run test`, 20 Inventory regressions, focused Inventory lint, server syntax and production build passed. Existing large web bundle warnings remain.
- The Inventory tests now exercise the actual provider-query functions with mocked public responses, supported full-catalog URL/cache behavior, code-only and stale-title matching, and explicit-save duplicate prevention through the native API.
- Native source/bridge checks: 51 passed; one Swift parser check skipped because Swift is unavailable on Windows. Eight executable Swift Inventory model tests are included; they have not run here.
- **Pending Manual Device Testing:** Swift model tests, Xcode compilation, camera grant/deny/cancel/background, card framing, real OCR/candidate review, and an approved actual item save verified in web/mobile. No live production media or Inventory data was modified during validation.

The complete `Homestead-iOS-companion-v3.10.zip` contains the iOS project and one server patch, `server-v3.10-after-v3.9.patch`. The patch requires the v3.9 Inventory server support (`85e2a66` or the equivalent merged PR). Check it on a development checkout before applying; reconcile newer changes rather than force-resetting them. Installing the phone project alone cannot repair the running server's provider requests. Run `bash scripts/validate-ios.sh` on the Mac before installing build 3.10 (11).

References: [YGOPRODeck API guide](https://ygoprodeck.com/api-guide/), [Apple UIImagePickerController](https://developer.apple.com/documentation/uikit/uiimagepickercontroller).
