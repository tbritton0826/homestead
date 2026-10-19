# Yu-Gi-Oh card detail HTTP crash repair

Opening a saved card mounts physical-copy move rows after the authenticated Inventory capability request succeeds. Each row previously called crypto.randomUUID unconditionally during its initial render. That browser method is unavailable on ordinary HTTP LAN origins, causing a render error and the page-level load-failure fallback.

Move rows now retain a UUID per mounted row while using cryptographic getRandomValues with UUID v4 version/variant bits when randomUUID is unavailable. Opening details performs no move/write. The request identity remains stable through a failed move and retry. HTTPS keeps the existing randomUUID path.

Verification: the isolated actual React TcgHoldingMoves component reproduced the original TypeError with randomUUID disabled. After the repair it opens, does not mutate on mount, and retries an interrupted move with the same valid UUID. The existing intake manual-price, queue/review and interrupted-save fixture checks still pass. Production web build and Inventory regression/lint checks are recorded with the delivery.

This is a server/web update after v3.14 / PR #14. Update/rebuild the server and reload the browser after merging. No iOS rebuild or replacement mobile ZIP is needed. No production card/share data was changed during testing. The compact pricing-settings card/overlay request remains backlog only.
