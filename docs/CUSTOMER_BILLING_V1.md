# Customer accounts and billing V1

Historical V1 guide. For the approved catalog, lifetime purchases, billing emails
and current deployment instructions, see [Commercial V1.1](CUSTOMER_BILLING_V1_1.md).

This extends the existing React/Vite and Express app. Billing is **test-only** and
disabled by default. No approved prices were found, so all seven existing
Free/Family/Plus/Pro tier/interval entries start as inactive drafts. The local
Homestead accounts, media JSON databases, appearance, playback, and existing
signed-license checks remain separate and retain their behavior.

## Audit and architecture

The base was `main` at `c3b112f`. Local installation identities use the existing
file-backed account service; that is not a public commercial customer store.
Existing feature tiers and Ed25519 license verification are reused. There was no
commercial PostgreSQL schema, payment adapter, approved dollar pricing, outbound
account email service, or hosted billing page. Existing deployment builds the
same Node Docker image; customer deployment is a separate opt-in Compose stack.

Customer pages live at `/customer/*`, with APIs at `/api/customer/*`. The React
entry point loads either the existing app or the customer page chunk, so customer
pages do not eagerly download media, 3D, EPUB, HLS, or calendar modules. Public
customer APIs are mounted before local-installation authentication. They enforce
their own customer sessions, ownership, CSRF, origin, and rate limits. Keeping the
private local-owner fallback off the public customer hostname is essential:
`HOMESTEAD_CUSTOMER_ONLY=true` permits only customer pages/APIs and static assets.
Never expose a private media installation merely to make customer billing public.

### PostgreSQL tables

| Table | Purpose |
| --- | --- |
| customers / customer_identities | Unique normalized email, status, profile, preferences, hashed password or future identity provider |
| customer_sessions / customer_tokens | Hashed session/CSRF tokens; expiring single-use email/reset links |
| customer_rate_limits | Persistent per-IP and per-email request buckets |
| customer_mail_outbox | Encrypted queued verification/reset mail with bounded retry attempts |
| customer_plans / customer_provider_prices | Versioned catalog and provider test Price mappings |
| customer_provider_accounts | Customer-owned provider account associations |
| customer_checkouts | Durable checkout intents, immutable plan snapshots and provider sessions |
| customer_subscriptions | Current reconciled plan, status, trial/period/cancellation timestamps |
| customer_transactions | Invoice/payment history, refund amounts, historical plan snapshots and receipts |
| customer_licenses | Subscription/purchase association, granted features, expiry/revocation |
| customer_payment_events | Unique provider/event pair, attempt count, processing and retry state |

SQL migrations run transactionally in filename order under a PostgreSQL advisory
lock. Applied checksums are verified; never edit an applied migration. Add a new
numbered migration instead. Initialization failures return 503, not an empty
successful catalog. Production uses `pg`; embedded PGlite is only a test fixture.
No card numbers, CVVs, Stripe secret keys, or raw webhook bodies are stored in
customer records. Foreign keys, unique constraints, and customer indexes enforce
associations and bounded queries.

## Configuration

Use an ignored `.env` or Unraid secret configuration. The server does not
automatically read `.env`; Node can load it with `node --env-file=.env server.cjs`.
Compose reads environment interpolation from `.env`. Never put secrets in `VITE_*`
variables, tracked plan files, screenshots, logs, or frontend code.

| Variable | Meaning |
| --- | --- |
| HOMESTEAD_CUSTOMER_ENABLED | `true` to enable customer APIs; default off |
| HOMESTEAD_CUSTOMER_ONLY | `true` for the dedicated public customer container |
| HOMESTEAD_CUSTOMER_DATABASE_URL | Dedicated PostgreSQL URL; URL-encode password characters |
| HOMESTEAD_CUSTOMER_DB_TLS | `true` requires verified database TLS; optional on isolated Docker networking |
| HOMESTEAD_CUSTOMER_ORIGIN | Exact external origin, e.g. `https://accounts.example.com`; no path/query |
| HOMESTEAD_TRUST_PROXY | Exact trusted reverse-proxy IP/CIDR; never broad `true` or an untrusted subnet |
| HOMESTEAD_CUSTOMER_SMTP_URL | SMTP/SMTPS connection URL with credentials |
| HOMESTEAD_CUSTOMER_MAIL_FROM | Verified sender address |
| HOMESTEAD_CUSTOMER_MAIL_KEY | 32 random bytes encoded as 64 hex characters, retained securely with backups |
| HOMESTEAD_PAYMENT_MODE | Only `test` is permitted |
| STRIPE_SECRET_KEY | Only an `sk_test_…` key is accepted |
| STRIPE_WEBHOOK_SECRET | Signing secret for this specific test endpoint |
| HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY | Ed25519 PEM; literal `\n` escapes are supported |
| CUSTOMER_DB_PASSWORD | Separate database password used by Compose |
| CUSTOMER_PORT | Loopback host port for Compose; default 7315 |

Production configuration requires HTTPS and configured email delivery. HTTP is
permitted only for loopback development. Database TLS configuration rejects
overriding SSL query parameters in the connection URL when its TLS flag is enabled.
Production SMTP requires verified TLS and disables message-bearing debug logs.
Sessions last seven days, use random
256-bit tokens stored as hashes, rotate on login, and are revoked by password
reset/logout. Production cookies are Secure, HttpOnly, SameSite=Lax, host-scoped
`__Host-` cookies. Mutating requests require the exact Origin and session-bound
CSRF header. Passwords use asynchronous Node scrypt (N=32768, r=8, p=1); email/reset
links expire after one hour. Tokens travel in URL fragments, are removed from the
page URL on load, and never appear in ordinary GET access logs. Pending mail is
encrypted with AES-256-GCM and cleared after delivery; failed deliveries retry
every five minutes up to eight attempts. Monitor and investigate exhausted mail
jobs; customers can request fresh links. Do not promise exactly-once email delivery
across a process crash; links themselves are single-use.

## Local development and approved test catalog

Use a **dedicated disposable PostgreSQL database**, SMTP test inbox, and Stripe
test account. Install dependencies with `npm ci`, configure the customer env vars,
and migrate with `node --env-file=.env scripts/customer-admin.cjs migrate`.
Build with `npm run build`, then run `node --env-file=.env server.cjs` and open
`/customer/pricing`. The development origin must match the browser's exact origin.
Port is controlled by existing `PORT` (default 7312). Do not run the commercial
development server against existing production media or customer storage.

To publish a plan, supply a **reviewed, untracked JSON file** containing `id`,
`tier`, positive integer `version`, `name`, optional `description`, `amount` in
Stripe charge units, lowercase `currency`, `interval` (`month` or `year`), and
the approved test `priceId`. No dollar example is supplied because Homestead
pricing has not been approved. Free configuration uses amount 0, interval `none`,
and no priceId. Existing draft IDs are `family-month-v1`, `family-year-v1`, etc.

```text
node --env-file=.env scripts/customer-admin.cjs publish-plan /secure/reviewed-plan.json
node --env-file=.env scripts/customer-admin.cjs disable-plan PLAN_ID
node --env-file=.env scripts/customer-admin.cjs status
```

Price amount, currency, recurring interval, interval count, active status and test
mode must match the server catalog. Published plans are immutable: publish a new
version and mapping to change prices. Disable old plans for new checkout without
changing existing subscriptions or transaction snapshots. Do not reuse a Stripe
Price for a different plan. The V1 publishing CLI derives entitlements from the
existing approved tier definitions. One-time product associations are supported
by the schema but one-time checkout is deliberately not implemented in V1.

## Stripe test setup and reconciliation

Create a test Product/Price for each approved paid plan in Stripe. Configure a
test Customer Portal for cancellation and approved upgrade/downgrade Prices only.
Unmapped portal Prices will fail reconciliation and must never be offered. Taxes,
trials, proration, refund policy, and payment grace periods need business approval;
do not turn them on as assumed Homestead policies. V1 grants access only to
provider-confirmed active, paid, unexpired periods; it does not grant trial or
past-due access. Partial refunds retain paid access; fully refunding current
funding revokes it. Refunding an older invoice does not revoke a newer paid period.
These conservative test behaviors require review before live release.

Configure the test webhook URL:
`https://YOUR_CUSTOMER_DOMAIN/api/customer/webhooks/stripe`.
Subscribe to `checkout.session.completed`, `checkout.session.expired`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and
`charge.refunded`. Use the event API version matching the pinned Stripe SDK (23.x);
the adapter uses item-level subscription periods, invoice `parent` association,
and InvoicePayments. Test signature/version behavior with the actual endpoint
before release. Stripe CLI forwarding to loopback can be used for development;
set the CLI's own signing secret, not a different dashboard endpoint secret.

The raw body is verified before JSON parsing or local authentication. Invalid
signatures, live events, and Connect account events are rejected. Events are
deduplicated in PostgreSQL. The customer row is locked before fetching **current**
provider state, so an old event cannot overwrite a newer cancellation or renewal.
Webhook retries preserve failed state and safely retry; duplicates cannot issue a
second transaction or license. Unknown provider customers are ignored. Customers
and checkouts must therefore be created through Homestead, not manually associated
by browser fields. Returning to the success page never activates entitlements.

Checkout first commits its customer mapping and intent, then calls the provider
with a stable idempotency key. Concurrent clicks reuse an open same-plan session;
changing an existing subscription uses the portal. A lost provider response can
be retried using the durable intent. An ambiguous intent older than 23 hours
requires an operator to inspect Stripe's checkout metadata and reconcile its
association before retry; do not blindly delete it and risk duplicate purchases.
Provider outages return retryable 500 errors; event error records contain generic
diagnostics, not credentials or raw payment payloads. Stripe performs webhook
delivery retries; this V1 does not add an independent event scheduler. Monitor
failed/received events, exhausted mail, and 503 health responses.

### Future payment adapters

`providers/stripe.cjs` handles all Stripe SDK shapes. The core billing service
consumes normalized provider state and generic customer/subscription/payment IDs.
An adapter supplies `name`, `verify`, `customerReference`, `validatePrice`,
`createCustomer`, `hasSubscription`, `checkout`, `checkoutStatus`, `portal`, and
`resolve`. Resolve returns optional checkout state, subscription state and invoices
with customer/plan references, paid/refund status and timestamps. Validation and
signature enforcement belong to the adapter; ownership and entitlement writes
remain in the core. Adding PayPal/Square also requires route/config selection and
provider-specific unit normalization; neither checkout is implemented here.

### Installation licensing

Authenticated `/api/customer/entitlements` is the server source of truth for
active plans/features. `/api/customer/license` issues a compatible Ed25519 signed
token for the highest active tier, capped at 24 hours and the paid period expiry.
Existing installs can use the corresponding public key/token through their
existing license configuration. They retain local free-preview behavior; no
commercial account requirement is imposed on existing local library users.
Automatic client refresh, SSO/server discovery, and device licensing are future
work. Previously issued offline tokens can remain valid until expiry following a
refund or revocation; online queries reflect the change immediately.

## Docker / Unraid and HTTPS

`docker-compose.customer.yml` runs a separate PostgreSQL 17 service and the same
Homestead app image in customer-only mode. Named volumes are separate from current
media/appdata volumes. The database has **no published port** and uses an internal
network. The app also has an egress network for Stripe/SMTP, binds its host port to
loopback, waits for database health, and automatically checks migrations. App
health checks use `/api/customer/health` rather than private media APIs.

Create a separate Unraid stack with these reviewed settings; do not repoint the
existing media container or alter its volumes. A reverse proxy on the same host
can forward the public customer hostname to `127.0.0.1:7315`. If the proxy is itself
in Docker, use an explicitly configured shared proxy network and backend service
name; do not expose the database or broadly publish the backend to solve routing.
Set `HOMESTEAD_TRUST_PROXY` to the proxy's exact address/CIDR, and have it overwrite
forwarded headers. TLS terminates there; forward the original Host and
`X-Forwarded-Proto: https`. API origin must equal the external HTTPS hostname.
An internal `10.x` LAN URL is not a public webhook endpoint. Do not cache customer
HTML or APIs. Use stable DNS/TLS and verified SMTP before allowing registration.

For an **approved non-production stack**, the deployment command is
`docker compose -f docker-compose.customer.yml up -d --build`.
This pass did not run that command or deploy any containers. Validate configuration
with `docker compose -f docker-compose.customer.yml config --quiet` after securely
supplying the required environment. Keep normal production image publishing and
live deployment separate from this branch.

### Backups and restore

Schedule encrypted `pg_dump -Fc` backups, including migration, catalog, customer,
billing, token and outbox tables. Use the customer-db container's configured
identity, send the output to a protected host backup path, and check the exit code
and archive with `pg_restore --list`. Do not copy a running PostgreSQL data directory
as a substitute for a consistent dump. Retain mail encryption and license signing
keys separately in a secret backup; an outbox restore without its mail key cannot
deliver pending messages. Never commit dumps to Git.

Restore into a **new empty isolated database/volume** with `pg_restore --exit-on-error`
and the backup archive. Verify schema checksums, row counts and ownership using
the admin CLI before starting the app. Restore the original mail key. Isolate
SMTP while validating a restore to avoid resending verification mail, and isolate
Stripe webhooks while checking historic records. Reconcile billing against Stripe
and rotate/revoke restored sessions/reset tokens if their security is uncertain.
Test restore regularly; record retention and deletion requirements with the
business. Never use `docker compose down -v` against production or existing volumes.

## Validation and release gates

```text
npm run test:customer
npm test
npm run test:full-pass
npm run build
```

Customer tests use an isolated temporary embedded PostgreSQL fixture by default
and real Stripe SDK signature verification with a mock provider API. To exercise
real PostgreSQL locking/constraints, set
`HOMESTEAD_CUSTOMER_TEST_DATABASE_URL` to a dedicated test database; the runner
creates and drops only a randomly named test schema. Never point it at production.
The PR/manual customer workflow provides PostgreSQL 17 and runs these tests.
The embedded runner serializes connections; it cannot prove real database lock
behavior. A real PostgreSQL run and real Stripe test checkout/email round trip
remain mandatory before release. See `CUSTOMER_BILLING_VALIDATION.md` for this
pass's actual results and limitations.

Before accepting live customers:

- Approve prices, plan entitlements, billing/refund/trial/grace/tax policies,
  privacy/terms, support, and retention/account-deletion procedures.
- Supply a public HTTPS domain, narrowly trusted proxy, PostgreSQL secrets,
  SMTP delivery, signing keys, and actual Stripe test account/portal/webhook config.
- Run real PostgreSQL CI, restore rehearsal, SMTP verification/reset delivery,
  complete a Stripe-hosted test purchase and confirm access/renewal/refund/portal.
- Review all dependency advisories; compatible `proxy-addr` and `qs` fixes are
  included here. Other preexisting build/media advisories still require review.
- Review operational alerts, failed events/mail, rate limits, access logs and
  secret rotation. Finish any changes identified by the external test round trip.
- Obtain explicit approval for live billing and deployment. This code rejects live
  keys/mode/events; switching to live requires a reviewed release and migration of
  provider mappings, independent credentials, portal and endpoint configuration,
  additional tests and an explicit approval. Changing an env value alone is blocked.
