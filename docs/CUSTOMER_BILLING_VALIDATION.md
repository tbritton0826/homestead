# Customer billing V1 validation — 2026-10-11

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
| Browser desktop 1440×900 | Registration, verification, login and draft monthly/annual plans checked |
| Browser mobile 390×844 and 320×740 | Dashboard/profile save, plan intervals, draft checkout disabled, history and logout checked; no page horizontal overflow |

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
