# Customer billing V1.1 — test setup and deployment

Commercial V1.1 extends the V1 infrastructure merged at `c7bf743`. It preserves
local Homestead accounts, media features, and the Brevo verification/reset mail
flow. The same opt-in customer-only Docker stack remains independent of personal
media and AI services. All payment processing remains **Stripe test mode only**.
This pass did not push, merge, deploy, change DNS, or touch DDUnraid data.

## Approved catalog and mappings

The database catalog uses version 2 so deployed V1 prices and snapshots are never
rewritten or silently reassigned. Startup inserts missing approved entries only.
Free is immediately available to verified customers; paid entries stay inactive
until the deployment CLI validates actual Stripe test Prices. Dollar values come
from the database, including annual savings; they are not duplicated in React.

Create three recurring test Products (Family, Plus, Pro), each with two Prices,
and one separate one-time test Product (Pro Lifetime — Early Access):

| Catalog ID | Product | USD charge units | Stripe Price type |
| --- | --- | ---: | --- |
| `free-none-v2` | Homestead Free | 0 | No Stripe Product/Price |
| `family-month-v2` | Homestead Family | 499 | Recurring monthly, count 1 |
| `family-year-v2` | Homestead Family | 4999 | Recurring annual, count 1 |
| `plus-month-v2` | Homestead Plus | 999 | Recurring monthly, count 1 |
| `plus-year-v2` | Homestead Plus | 9999 | Recurring annual, count 1 |
| `pro-month-v2` | Homestead Pro | 1799 | Recurring monthly, count 1 |
| `pro-year-v2` | Homestead Pro | 17999 | Recurring annual, count 1 |
| `pro-none-v2` | Homestead Pro Lifetime — Early Access | 24999 | One-time, no recurrence |

Use a protected, ignored `customer-secrets/test-prices.json`, mapping catalog IDs
to **your** actual test Price IDs. The following values are placeholders:

```json
{
  "family-month-v2": "price_YOUR_FAMILY_MONTH",
  "family-year-v2": "price_YOUR_FAMILY_YEAR",
  "plus-month-v2": "price_YOUR_PLUS_MONTH",
  "plus-year-v2": "price_YOUR_PLUS_YEAR",
  "pro-month-v2": "price_YOUR_PRO_MONTH",
  "pro-year-v2": "price_YOUR_PRO_YEAR",
  "pro-none-v2": "price_YOUR_LIFETIME"
}
```

In an approved isolated test checkout/container, with its test credentials:

```text
node --env-file=.env scripts/customer-admin.cjs migrate
node --env-file=.env scripts/customer-admin.cjs configure-prices customer-secrets/test-prices.json
node --env-file=.env scripts/customer-admin.cjs status
```

Mappings are validated for active status, test mode, exact amount/currency and
recurring/one-time type. Configuration is atomic, repeatable, and refuses a changed
existing mapping or reuse of another plan's Price. Partial mapping files are
allowed: omitted paid entries remain unavailable. Never edit an existing Price
mapping or a published price to change an existing customer's bill. Use the
existing reviewed `publish-plan` CLI with a new version, then disable retired
plans for new sales. Existing V1 subscriptions continue on their original Prices.
One-time publishing uses `productKind: "one_time"`, tier `pro`, interval `none`.

The public catalog checks provider Price availability with a coalesced 30-second
cache. Failed validation or provider outages disable its paid actions. Checkout
revalidates the Price before creation, regardless of the cache. Operators should
also `disable-plan PLAN_ID` when withdrawing a product.

## Checkout, events and Customer Portal

Keep `HOMESTEAD_PAYMENT_MODE=test`, an `sk_test_…` secret, and the signing secret for
this exact endpoint. Live keys, live objects, Connect events, and live mode are
rejected. Never place provider credentials in `VITE_*`, Git, screenshots or logs.
Set `HOMESTEAD_CUSTOMER_ORIGIN=https://accounts.gethomesteadapp.com` only once that
approved HTTPS staging origin exists. The website is `https://gethomesteadapp.com`.
An internal LAN URL is not a reachable Stripe webhook endpoint.

Configure the test endpoint `/api/customer/webhooks/stripe` for:

```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
charge.refunded
payment_intent.succeeded
payment_intent.payment_failed
```

Use the API version matching the pinned Stripe 23 SDK, and verify actual fixture
shapes against the endpoint. The adapter uses item-level subscription periods,
invoice parent associations, and InvoicePayments. One-time fulfillment retrieves
current Checkout, line items, PaymentIntent and charge. It checks ownership,
intent metadata, quantity, Price, amount, currency, paid status and refunded amount.
PaymentIntent ID is the durable purchase identity. A charge refund without an
invoice is associated with its original one-time Checkout using the payment intent.

Configure a **test Customer Portal** with invoice history, payment-method update,
subscription cancellation and price-only subscription updates. Add only the six
approved recurring Prices (plus any intentionally retained, published V1 recurring
Prices). Exclude the lifetime Product, quantity changes, promotion codes and
unmapped Prices. Set `STRIPE_PORTAL_CONFIGURATION_ID` to its test configuration ID;
if omitted, the active test default is inspected. The server refuses an inactive,
live or unapproved update configuration before creating a customer-owned session.
Cancellation timing and proration are operator-reviewed Stripe settings; this code
does not create a business policy or automatically configure them.

A success-page redirect never grants access. The page reads the persisted
provider-confirmed outcome and has a refresh control for delayed confirmation.
Unpaid completion remains pending, asynchronous failure remains failed, and refund
state is shown separately. Expired/cancelled checkout has no new grant. Stable
checkout intents survive lost responses; duplicate pending clicks reuse the same
session. An ambiguous intent over 23 hours requires operator reconciliation with
Stripe before retrying. Do not blindly remove it to bypass duplicate protection.

Signed events are durably deduplicated; customer writes are serialized before
reading current provider state. Delayed events cannot resurrect a currently
refunded purchase or expire a separate lifetime license. Failed events remain
retryable by Stripe; there is no independent webhook replay scheduler. Monitor
failed events and resend via the Stripe test dashboard after resolving their cause.

## Entitlements and lifetime licensing

The effective feature list and limits come from one highest valid grant:
Pro Lifetime > Pro subscription > Plus subscription > Family subscription > Free.
Lower grants cannot add features to the effective plan. Subscription and lifetime
licenses have independent associations. Paid activation removes the redundant Free
grant; later free enrollment is rejected while paid access is valid. A customer can
select Free again once paid access has ended. Free enrollment is verified, server
controlled, payment-free and protected by a unique active-grant constraint.

Recurring access requires a confirmed paid period, with no invented trial or
past-due grace. Cancellation keeps confirmed access through its future paid-period
end; expiration, failed current funding and full current-period refunds remove
that grant. Refunding an older invoice does not revoke a newer paid period.
Partial refunds retain access in this **test implementation**. Refund/access,
proration, tax, trial, grace and dispute policies need business approval before
public sale. Dispute-specific automation is not implemented.

The $249.99 lifetime purchase grants the currently defined Pro **software feature
tier**, without recurring charges, an expiration date or a quantity cap. It does
not pay for external AI API usage, independent cloud services or third-party costs.
Long-term terms, availability and future-version policy are explicitly awaiting
approval, rather than assumed. Buying lifetime does **not** automatically cancel a
separate recurring subscription: the dashboard directs customers to Manage billing.
New redundant checkouts are blocked while lifetime is valid.

The existing Ed25519 signing format remains compatible. Recurring/Free issued
tokens keep V1's maximum 24-hour expiry, bounded by their paid period. Lifetime
tokens have a license ID and no expiration, as supported by the existing verifier.
Full refunds revoke the associated database license. A deployment-only operator can
permanently revoke a grant with `customer-admin.cjs revoke-license LICENSE_UUID`;
subsequent provider retries cannot restore that manually revoked grant.

**Offline limitation:** a non-expiring token already installed offline cannot be
remotely recalled. Online entitlements and new issuance reject refunded/revoked
licenses immediately; offline revocation needs a future installer-side online
revocation/refresh design. That limitation and any change to license terms must be
approved before public sale. No new device cap or DRM policy is introduced here.

## Migration and mail

`001-foundation.sql` is byte-for-byte unchanged. New `002-purchase-fulfillment.sql`
adds checkout payment/confirmation associations, transaction checkout/creation
fields, unique purchase fulfillment and active Free indexes, manual revocation,
and unique notification keys on the existing mail outbox. It uses the existing
transactional migration runner, advisory lock and checksum ledger. It deletes no
V1 account, identity, session, mail, subscription, purchase or historic catalog row.
Approved version-2 catalog seeding is additive and repeatable after migration.

Keep the already verified Brevo SMTP URL, TLS configuration, mail encryption key
and sender. Use a Brevo-verified identity such as
`Homestead <accounts@gethomesteadapp.com>`; verify SPF/DKIM/delivery on that domain.
Billing templates cover subscription activation, paid renewal/payment confirmation,
failure, cancellation, refund and lifetime activation. They use the same encrypted
queue/retries. Notification keys follow the payment/subscription business event,
so repeated webhooks with different IDs cannot enqueue duplicate confirmations.
As with V1, an SMTP success immediately followed by a process/database crash can
still duplicate delivery on retry; SMTP provides no exactly-once delivery guarantee.

## Portable DDUnraid / Z97 stack

Keep the existing `docker-compose.customer.yml`, separate app/database volumes,
PostgreSQL 17 and customer-only routing. The database has no published port; its
network is internal. Customer web has outbound networking for Stripe/Brevo and a
loopback-only host binding, default **7315**. Health checks and startup migrations
use only the customer database, never the owner's Homestead instance.

The eventual Z97 Ubuntu 24.04 server (i5-4590, 32GB, mirrored 250GB SSDs) needs Docker
Engine and Compose, a protected checkout/env, persistent volumes, HTTPS ingress,
SMTP and encrypted backups. No personal media database, AI service or other owner
container belongs in that stack. Hardware migration and DNS changes are outside
this pass. Mirrored disks are not a substitute for separate verified backups.

For an explicitly approved staging update, back up first, then validate Compose
with `docker compose -f docker-compose.customer.yml config --quiet` and deploy with
`docker compose -f docker-compose.customer.yml up -d --build`. Do not execute these
against DDUnraid as part of this coding pass. Apply the same project/volume naming
as the existing stack to preserve its records. Migration happens at startup; a
failed checksum/constraint leaves readiness unavailable rather than resetting data.

Cloudflare Tunnel can forward an approved customer hostname to host-loopback
`http://127.0.0.1:7315`. If cloudflared runs in Docker, explicitly connect it and
customer-web to a reviewed shared ingress network and target `customer-web:7312`;
keep PostgreSQL off that network. Preserve Host and overwrite forwarded protocol
with HTTPS; narrowly trust the actual connector/proxy address using
`HOMESTEAD_CUSTOMER_TRUSTED_PROXIES` (exact IPs only; see CUSTOMER_PROXY_TRUST.md).
Do not expose DB ports or
personal media endpoints to solve routing. No public DNS/tunnel changes were made.

For Ubuntu/Unraid Bash, example **backup procedure** after approval:

```bash
umask 077
docker compose -f docker-compose.customer.yml exec -T customer-db \
  pg_dump -U homestead_customer -d homestead_customer -Fc > /protected/backup/customer.dump
# Check exit status, inspect with pg_restore --list, encrypt, and copy off-host.
```

Retain the original mail encryption and Ed25519 signing keys in a separate secret
backup. Restore with `pg_restore --exit-on-error` into a new empty isolated database
and separate volumes, with SMTP/webhooks disabled until checksums, counts and
ownership are verified. Never overwrite the staging/production database to test a
restore and never use `down -v` on retained volumes. See the V1 guide for full account,
secret, proxy and restore controls. Reconcile restored billing with current Stripe
state before exposing it. A rollback to V1 requires restoring its pre-upgrade backup
into isolated volumes: the old UI/service does not support lifetime billing.

## Recommended DDUnraid test acceptance

1. Obtain approval to update **staging**, back it up and rehearse restoration.
2. Run the customer suite against an isolated real PostgreSQL 17 test database via
   `HOMESTEAD_CUSTOMER_TEST_DATABASE_URL` (never staging/production). CI already has
   a PostgreSQL 17 PR/manual workflow; this pass did not push or trigger it.
3. Validate test Products/Prices with the CLI and configure the test portal/webhook.
4. Confirm the existing Brevo registration, verification and reset flows again.
5. Enroll Free twice; complete monthly and annual hosted test purchases; verify
   dashboard, invoice history, signed installation token and one activation email.
6. Exercise paid renewal, failed renewal, recovery, scheduled cancellation/expiration
   and portal upgrades/downgrades without changing historic amounts.
7. Buy lifetime while a subscription exists; verify one grant/email/receipt, no
   expiry, and continued lifetime access after separately cancelling that subscription.
8. Replay duplicate/delayed events, partial/full/older-invoice refunds, pending/failed
   asynchronous payments and denied cross-customer access. Confirm manual revocation
   persists across event replay. Test the offline-license limitation explicitly.
9. Restart containers; verify retained records, health, completed migrations and
   no notification re-enqueue. Inspect generic failed-event/mail diagnostics.

Mandatory before public sale: actual Stripe acceptance, PostgreSQL concurrency and
Docker/restore checks, approved legal/lifetime/refund policies, offline revocation
review, outstanding media dependency security review and explicit live-release
approval. This code continues to reject live billing.

Primary provider references:
[Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[webhook delivery](https://docs.stripe.com/webhooks),
[Customer Portal configuration](https://docs.stripe.com/customer-management/configure-portal),
[Stripe Node SDK](https://github.com/stripe/stripe-node).
