# Account-linked server activation (test release)

This release connects an existing local Homestead owner to a verified website
customer account. Free continues to work without a website account. Local users,
owner passwords, media files and library settings remain on the local server.
Stripe stays in test mode. Live purchasing is a separate release decision.

## Linking and recovery

1. On the local server, open **My Account → Website account**, enter the local
   owner password and choose **Link account**.
2. Sign in to the website's **My servers** page. Enter the ten-minute code, compare
   the complete server fingerprint, then approve the server.
3. Return to the local server, check the approved email address and confirm the
   account using the local owner password. The current plan applies immediately.

The installation generates an Ed25519 identity only when the owner starts
linking. Machine requests use signed, timestamped, single-use proofs rather than
browser cookies. Customer approval requires a verified customer session, CSRF
protection and the previewed fingerprint. A server already linked to another
account must be unlinked before ownership can change.

Activations are signed, bound to the installation and last at most 24 hours,
including lifetime purchases. The server refreshes on startup and every 15
minutes; **Refresh activation** checks immediately. A temporary outage preserves
the last valid activation until its actual expiry. An explicit remote revocation
removes the local binding on the next successful check. After expiry or revocation,
the server falls back to its local plan without deleting media. Existing valid
manually configured licenses remain supported independently.

Back up the local data directory's `server-account/identity.json` and
`server-account/account.json` together. Treat them as private credentials. A
damaged or incomplete saved identity blocks linking writes and leaves Free
available; restore the original backup rather than generating a replacement key.
Do not clone this identity to a second installation. Exclusive identity creation
uses filesystem hard links; keep this directory on storage that supports them.

## Signing and readiness

Keep the customer service's existing Ed25519 signing key. The configured
`HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY` takes precedence over
`HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY_FILE`, whose default is
`/app/data/customer-license-key.pem`. Do not rotate or regenerate the key as part
of deployment. Back it up with the existing private mail key and database.

For a genuinely new deployment with no configured key, the private deployment
CLI supports `node scripts/customer-admin.cjs init-signing-key`. It refuses to
replace a key file or an environment-configured key and never prints the key.
Do not run this initialization on the existing staging deployment.

Run `node scripts/customer-admin.cjs readiness` inside the configured customer
container. It performs read-only database and configuration checks, validates the
six current recurring sandbox prices, and reports safe booleans and plan IDs.
It does not migrate, seed, publish prices, send mail or print credentials.
Optional unpublished lifetime offerings do not block the recurring catalog.
Readiness is configuration validation, not proof of email delivery or payment
fulfillment. Checkout is unavailable when its activation signer or webhook secret
is missing; existing customers can still manage billing.

## Reviewed rollout and rollback

This change must be reviewed and released through GitHub/GHCR before the normal
Unraid update. Do not deploy an unreviewed working tree.

- Back up the existing customer database and private application volume. Preserve
  all current accounts, signing/mail keys and Stripe test configuration.
- Migration `003-server-linking.sql` only adds linking, pairing and nonce tables.
  Existing migrations and historical catalog rows are unchanged. Application
  startup applies pending migrations transactionally using the existing runner.
- The Compose change supplies the key-file path in the existing application
  volume. Do not recreate volumes, change the `homestead-accounts-public` network,
  modify database credentials or broaden the exact trusted-proxy allowlist.
- Keep public HTTPS and all customer authentication and CSRF checks enabled.
  Cloudflare Access must permit machine access to `/api/customer/linking/*` for
  activation to work outside a browser; these endpoints retain signature, expiry,
  replay and rate-limit checks. Review this narrow ingress policy separately.
  Browser customer routes keep their session requirements. Preserve the existing
  Stripe webhook exception and signature verification.
- After the reviewed update, run readiness, verify public HTTPS, then test an
  existing customer login, email delivery, a signed sandbox checkout/webhook,
  activation, refresh, cancellation and unlink. Do not create a duplicate account
  when the tester already has one.
- A rollback can restore the previous image while retaining migration 003 and its
  data. Do not drop tables, remove volumes or restore an old database over newer
  customer records as a routine application rollback. Local Free remains usable;
  linked activation requires a version that supports this protocol.

The public site's placeholder signup/sign-in links, hosted email-delivery proof,
and end-to-end Stripe fulfillment are subsequent hosted checks, not claims made
by this implementation's tests.

## Verification

`npm run test:customer` covers the customer session/billing/catalog suites, narrow
proxy trust, signed pairing, concurrent account claims, replay, revocation,
installation binding, license expiry, corruption handling and read-only readiness.
CI runs these against PostgreSQL 17; local runs use isolated PGlite databases when
no dedicated test database is configured. Also run `npm test` and `npm run build`.

For browser acceptance only, `node scripts/serve-activation-fixture.cjs` starts two
loopback services with a temporary database, fictional credentials and synthetic
entitlements. It never calls real Stripe or sends email. Use the printed URLs,
perform the complete link/approve/confirm/refresh/unlink flow, then stop the helper
to clean up its temporary database. Never use this helper as a deployment entrypoint.
