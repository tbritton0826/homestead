# TCG intake price and save recovery — October 18, 2026

This is a server/web repair after the v3.12 server update. It does not include the planned mobile poster-grid redesign or require a new iOS build.

## Report and changes

- Single-card printing queues previously opened the generic Confirm item form, which displayed separate legacy price fields rather than the queued values being submitted. Review now displays the actual queued printings, estimates, quantities, costs, locations and photo counts. Back/edit/review uses the same queue.
- Save and scan next still saves directly. It returns to the scanner only after confirmation; failed entries remain in the queue with the actual failure reason. Partial single-mode saves remove confirmed entries so retry saves only the remainder. An immediate save lock prevents overlapping click submissions.
- HTTP LAN pages cannot use `crypto.randomUUID` in common browsers. The old fallback produced a date/random string rejected by the UUID-only batch endpoint. The fallback now uses `crypto.getRandomValues` to construct a valid version-4 UUID, retaining stable retry identities.
- Manual estimates carry explicit provenance and override values through queue editing, repeated catalog selection, request validation, canonical/share files, reopening and later provider refresh. Explicit zero remains a manual estimate; clearing the field means unavailable. Reselecting the same printing preserves quantity, purchase price and location too.
- Catalog availability remains separate from manually entered values. No unrelated printing or general card estimate is silently substituted for an unavailable exact quote.

## Reported quote

A read-only public YGOPRODeck request on October 18 returned MP23-EN162 / Prismatic Secret Rare for Blazing Cartesia, the Virtuous with `set_price: "0"`. General card prices were present, including `tcgplayer_price: "0.26"`, but do not establish this printing's value. The UI now explains the missing exact quote and permits a manual estimate. The other two reported cards have not been identified or checked. No production records or valuations were changed by this investigation.

## Verification

- `npm test`: passed; the final focused Inventory/TCG suite has 42 passing checks. Tests execute actual intake handlers and exercise real temporary share writes/cold reads; manual estimates, including zero, survive refresh. Coverage includes exact quote matching, stable LAN save IDs, interrupted saves, partial retries and repeated clicks.
- `npm run test:tcg-browser`: passed in isolated headless Microsoft Edge using the actual React intake component and fixture APIs. Verified manual price/quantity/cost, an HTTP-style missing `randomUUID`, failed Save and scan next followed by retry, and single-mode review → Back → Edit → queue → review → save. No production account, server or Inventory data was used.
- Production web build, Inventory lint, server syntax and diff whitespace checks are checked before delivery. The existing large-bundle warning is unrelated to this repair.

## Deployment and remaining confirmation

Publish this repair branch to the normal server repository and update the Homestead server/container after merge and a successful image build. Refresh the server web page to load its new client assets. Existing mobile v3.13 can use the updated API; no mobile ZIP or server deployment is performed by these local checks. Confirm the user's actual card-add workflow after the deployed update before closing the production report.
