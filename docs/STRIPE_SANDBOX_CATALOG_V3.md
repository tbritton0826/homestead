# Sandbox catalog V3

The owner approved these recurring USD prices on October 25, 2026:

| Homestead plan | Monthly | Annual |
|---|---:|---:|
| Family | $4.99 | $49.99 |
| Plus | $11.99 | $109.99 |
| Pro | $19.99 | $189.99 |

The six exact sandbox Price IDs are in `deploy/customer-catalog/stripe-sandbox-v3.json`.
Price IDs are identifiers, not secret API credentials. Secret keys stay in the
dedicated customer service's private deployment environment.

V3 leaves V2 plans, their Price bindings, existing subscriptions, receipts, and
transaction snapshots intact. Free and the lifetime draft are unchanged. The
existing catalog API selects the highest version of each plan and interval, so
these six records become the current recurring offerings after publication.

## Validate, publish, verify

Run inside the dedicated customer application container with the same sandbox's
`STRIPE_SECRET_KEY=sk_test_…`, `HOMESTEAD_PAYMENT_MODE=test`, and its existing private
database connection. Never put the key on a command line or into Git/chat.

```sh
node scripts/publish-stripe-catalog.cjs deploy/customer-catalog/stripe-sandbox-v3.json --check
node scripts/publish-stripe-catalog.cjs deploy/customer-catalog/stripe-sandbox-v3.json --publish
```

The check validates all six Stripe Prices against mode, availability, amount,
currency, and interval, then checks existing database bindings without writing.
Publication commits the complete release in one transaction. Repeating the same
release is safe; changing an existing version or reassigning a Price fails.
Missing credentials, invalid Prices, and binding conflicts do not partially
publish the release.

The publication script intentionally does not run schema migrations, create
Stripe products, perform purchases, change existing subscriptions, configure the
Customer Portal, or enable live billing. Use the existing migration command first
if this is a brand-new customer database.

Verify `/api/customer/plans`: exactly six subscription rows for V3 must report
the amounts above and `active:true`, `draft:false`. Checkout availability also
requires the running customer service to have its sandbox key configured. Update
the sandbox Customer Portal's allowed recurring Prices to this same set before
testing plan changes; unmapped or unapproved Prices remain rejected.

Public HTTPS routing, verification/reset mail delivery, webhook configuration,
and server activation still require the separate hosted-account setup pass.
