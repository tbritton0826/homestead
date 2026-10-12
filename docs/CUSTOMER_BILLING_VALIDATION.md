# Commercial V1.1 validation — 2026-10-12

Branch: `codex/customer-billing-v1-1`, isolated checkout from merged main `c7bf743`.
The user reports successful V1 PostgreSQL/account/Brevo testing on DDUnraid.
This pass used no staging/production database, real SMTP or Stripe credentials.
No push, merge, deployment or DNS change was performed.

## V1.1 changes and results

- Approved USD catalog with Free enrollment, six recurring Prices and the 24999
  one-time Pro Lifetime offering. Versioned plans preserve V1 history; paid sales
  remain disabled until environment-specific test mappings are validated.
- Current-state lifetime Checkout/PaymentIntent/charge reconciliation, owned
  receipts/purchases, unique fulfillment, refunds and durable manual revocation.
- Single effective license precedence, separate lifetime/subscription grants,
  paid-period cancellation and backward-compatible Ed25519 lifetime tokens.
- Encrypted billing notifications with durable business-event deduplication,
  validated test portal configuration and provider Price availability checks.
- Pricing intervals/savings/current tier, lifetime dashboard status and explicit
  confirmed/pending/failed/refunded checkout states.
- Append-only migration `002-purchase-fulfillment.sql`; 001 remains unchanged.
  Tests migrate a populated V1 schema and preserve identity, mail, purchase
  snapshot, original price and checksum, including repeated migration/seeding.

| Check | Result |
| --- | --- |
| `npm run test:customer` | 42 passed, 0 failed |
| `npm test` | Passed |
| `npm run test:full-pass` | Passed |
| `npm run test:docker-release` | Static release checks passed |
| `npm run build` | Passed; existing large media chunk warnings remain |
| Desktop 1440×900 | Four tiers, annual prices/savings and lifetime offering checked |
| Mobile 390×844 / 320×740 | Fixture login, lifetime/effective dashboard, history, annual toggle and already-owned buttons checked; no page horizontal overflow |
| Browser console | No errors/warnings captured |

The customer suite uses PGlite, a disposable PostgreSQL-compatible fixture, and
actual Stripe SDK signature validation with mocked remote API responses. It
covers approved monthly/annual purchases, Free upgrades, lifetime/subscription
coexistence and precedence, repeated/lost-response checkout, delayed payments,
partial/full/older-period refunds, ownership, historic amounts, retry and mail
idempotency. Browser QA used a disposable loopback fixture with synthetic customer
and lifetime records; it did not execute real Checkout or send mail.
Ignored screenshot artifacts are under `work/customer-qa/`.

Customer JavaScript: 15.33 kB (4.92 kB gzip); customer CSS: 2.67 kB (0.98 kB gzip).
Shared entry remains 192.50 kB (60.92 kB gzip). Main media App stays separately
loaded at 1557.56 kB; model, EPUB, HLS and calendar features remain separate chunks.

Compatible lockfile patches remove seven advisories: audit reduced from 10 to 3
(2 high, 1 moderate). Remaining production issues: `@xmldom/xmldom`, `epubjs`,
`sharp`; npm's fixes require breaking media upgrades. Customer dependencies have
no reported advisories. No forced upgrade was performed.

## V1.1 acceptance still required

No standalone PostgreSQL/Docker executables were available, and no actual Stripe
account mappings or test credentials were supplied. Real PostgreSQL 17 locking,
Docker build/Compose/container restart and volume restoration, hosted Stripe test
payments/webhook delivery/portal operations, and actual billing SMTP delivery
remain external acceptance checks. The existing PostgreSQL 17 CI workflow was not
triggered because this branch was not pushed. Mocked tests do not establish those
results. Static Docker checks are not a Docker image execution.

Lifetime tokens do not expire. The existing offline installer cannot recall an
already-issued token after refund/revocation. Database access and new issuance
reflect revocation immediately; installer-side online revocation design/approval
is a public-sale blocker. Long-term lifetime terms/future-version policy and
refund/tax/proration/grace/dispute policies require approval. No quantity cap,
expiry, live-mode switch or automatic cancellation of a separate subscription
was added. Failed-event recovery relies on Stripe retry/operator resend; mail can
still duplicate across an SMTP-success/process-crash boundary.

See [V1.1 setup, Products/Prices and DDUnraid acceptance](CUSTOMER_BILLING_V1_1.md).

---

# Customer billing V1 validation â€” 2026-10-11

Implementation is isolated on `codex/customer-billing-v1`, based on `main` at
`c3b112f`. No main merge, push, public deployment, production-volume modification,
or live payment was performed. The existing `FOLLOW_UPS.md` in the primary
checkout was retained.

## Implemented

- Migration-managed PostgreSQL customer, identity, session, catalog, checkout,
  subscription, transaction, license, payment-event and encrypted mail-outbox tables.
- Registration, verified email, login/logout, reset, profile, secure cookies,
  CSRF/origin/rate limits, account status and customer ownership enforcement.
- Draft catalog derived from existing tiers without approved dollar prices;
  immutable published versions and test Price mappings via a deployment-only CLI.
- Stripe test adapter, durable/idempotent checkout, signed raw webhooks, current
  state reconciliation, renewals, failure, cancellation, refunds and billing portal.
- Backend entitlements and compatible bounded-life Ed25519 installation licenses.
- Lazy customer routes for plans, registration, login, verification/recovery,
  dashboard, purchase history and checkout results.
- Isolated opt-in Docker/PostgreSQL stack, customer-only routing, secret exclusion,
  PostgreSQL PR test workflow, setup/backup/restore/live-transition documentation.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run test:customer` | 29 passed, 0 failed |
| `npm test` | Passed, including appearance, responsiveness, startup, media polish and public QA |
| `npm run test:full-pass` | Passed, including local account playback, library/search, recipes, plugins and existing licenses |
| `npm run test:docker-release` | Existing Docker/Community Apps static release checks passed |
| `npm run build` | Passed; existing large media chunks still produce size warnings |
| Customer server modules / diff whitespace checks | Passed |
| Browser desktop 1440Ã—900 | Registration, verification, login and draft monthly/annual plans checked |
| Browser mobile 390Ã—844 and 320Ã—740 | Dashboard/profile save, plan intervals, draft checkout disabled, history and logout checked; no page horizontal overflow |

Customer lifecycle coverage includes duplicate identities, mail encryption,
single-use/expired reset and verification tokens, forged CSRF/Origin, inactive
accounts, expired sessions, SQL injection strings, owner-scoped billing access,
provider signature/live-mode rejection, confirmed payment, paid/failing renewals,
out-of-order cancellation, plan changes without rewriting historical snapshots,
partial/full/older-period refunds, duplicate events, retry after provider outage,
unmapped prices, free configuration, persistence and encrypted SMTP/DB TLS options.
Lost checkout responses and concurrent clicks are tested against provider
idempotency behavior. Signed tokens are verified with the existing local verifier.

The first full-pass run encountered a checkout line-ending issue in a historical
source-extraction test. The check passed on unchanged main. Working-copy text was
normalized for the test run and original byte layouts restored where tracked
files used CRLF. No unrelated source changes are included.

Browser testing used a loopback-only disposable database and captured mail;
no real email or payment was sent. Screenshots are local ignored QA artifacts
under `work/customer-qa/`, not bundled customer data. API fixtures use hypothetical
prices solely for assertions, never as the seeded public catalog.

## Bundle result

The built customer entry loads approximately 192.50 kB shared runtime
(60.92 kB gzip), 12.50 kB customer JavaScript (4.05 kB gzip), and 2.54 kB customer
CSS (0.94 kB gzip), plus 0.40 kB base CSS. Existing App JavaScript remains a
separate 1,557.56 kB chunk (373.41 kB gzip); existing media CSS is 762.55 kB.
Calendar, model, EPUB/scanner and HLS chunks remain feature-loaded. No dependency
secrets or server payment SDKs are included in the browser customer chunk.

## Dependency review

Added pinned `pg`, `stripe`, `nodemailer`, and dev-only PGlite. Updated only the
compatible Express transitive `proxy-addr` and `qs` patches; the critical proxy
advisory is removed. Final audit reports 10 total advisories (7 high, 3 moderate),
including four production advisories: `sharp`, `@xmldom/xmldom`, `epubjs`, and
`fflate`. These are preexisting media dependencies. Fixing all would include
unrelated/breaking media changes; they remain an explicit public-release gate.
The newly added customer dependencies were not listed in the audit findings.

## External validation still required

- No Docker engine or standalone PostgreSQL was available in this checkout.
  Local tests used PGlite; they do not prove PostgreSQL advisory/row-lock behavior
  across real concurrent connections. The added PostgreSQL 17 CI job has not been
  run remotely because this branch has not been pushed. Docker image build,
  Compose validation, container restart and volume restore rehearsal remain pending.
- No actual Stripe test credentials, public domain, approved test Price IDs,
  portal configuration, SMTP delivery or production signing keys were supplied.
  A real hosted test checkout, webhook delivery, email/reset round trip and actual
  portal upgrade/downgrade remain pending. Tests mock API responses and use the
  actual SDK for signature verification; they do not replace provider acceptance.
- Prices, legal terms/privacy/retention, taxes, proration, trials, payment grace and
  refund/access policies need approval. V1's conservative test entitlements are
  documented in the implementation guide and must be reviewed before live release.
- Future payment adapters, one-time checkout and automatic installation-license
  refresh remain extension points, not shipped features. Offline license tokens
  can remain valid until their 24-hour/paid-period cap after a revocation.
- Live keys, live events and live payment mode are explicitly blocked. Live
  billing/deployment needs a separate reviewed release and explicit approval.

Setup and operational instructions:
[Customer billing V1](CUSTOMER_BILLING_V1.md).

Provider documentation used during implementation:
[Stripe webhooks](https://docs.stripe.com/webhooks),
[subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks),
[invoice objects](https://docs.stripe.com/api/invoices/object),
[currency units](https://docs.stripe.com/currencies),
[PostgreSQL transactions in node-postgres](https://node-postgres.com/features/transactions),
[Nodemailer SMTP options](https://nodemailer.com/smtp).
