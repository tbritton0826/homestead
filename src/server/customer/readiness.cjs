const { configuration } = require('./security.cjs');
const { licenseSigningKey } = require('./license-signing.cjs');
const { snapshot } = require('./catalog.cjs');
const { createStripeProvider } = require('./providers/stripe.cjs');
const { configureProxyTrust } = require('./proxy-trust.cjs');
const reviewed = require('../../../deploy/customer-catalog/stripe-sandbox-v3.json');

// Read-only deployment diagnostics. Never migrates, seeds, rotates keys or prints
// credentials. Optional one-time offerings do not block the recurring release.
async function customerReadiness({ pool, env = process.env, provider }) {
  const checks = {
    database: false, linkingMigration: false, httpsOrigin: false,
    customerOnly: env.HOMESTEAD_CUSTOMER_ONLY === 'true',
    testMode: env.HOMESTEAD_PAYMENT_MODE === 'test', trustedProxy: false,
    smtpConfigured: Boolean(/^smtps?:\/\//i.test(env.HOMESTEAD_CUSTOMER_SMTP_URL || '') && env.HOMESTEAD_CUSTOMER_MAIL_FROM),
    mailEncryptionKey: /^[a-f0-9]{64}$/i.test(env.HOMESTEAD_CUSTOMER_MAIL_KEY || ''),
    signingReady: false, stripeTestKey: Boolean(env.STRIPE_SECRET_KEY?.startsWith('sk_test_')),
    stripeWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET), approvedPriceMappings: false,
  };
  try { checks.httpsOrigin = configuration(env).secure; } catch { /* incomplete configuration */ }
  try {
    const app = require('express')(); configureProxyTrust(app, env);
    checks.trustedProxy = Boolean(env.HOMESTEAD_CUSTOMER_TRUSTED_PROXIES && app.get('trust proxy') !== false);
  } catch { /* invalid allowlist */ }
  try { licenseSigningKey(env); checks.signingReady = true; } catch { /* retain existing key */ }
  if (!provider && checks.stripeTestKey) try { provider = createStripeProvider(env); } catch { /* test-only provider */ }
  let plans = [];
  try {
    const migrations = await pool.query('SELECT name FROM customer_schema_migrations');
    checks.database = true;
    checks.linkingMigration = migrations.rows.some(row => row.name === '003-server-linking.sql');
    const selected = (await pool.query(`SELECT DISTINCT ON (p.tier,p.billing_interval,p.product_kind) p.*,m.external_price_id FROM customer_plans p
      LEFT JOIN customer_provider_prices m ON m.plan_id=p.id AND m.provider='stripe' AND m.mode='test'
      ORDER BY p.tier,p.billing_interval,p.product_kind,p.version DESC`)).rows
      .filter(row => row.product_kind === 'subscription' && row.tier !== 'free');
    plans = await Promise.all(reviewed.plans.map(async wanted => {
      const row = selected.find(plan => plan.tier === wanted.tier && plan.billing_interval === wanted.interval);
      let valid = Boolean(row && row.version >= reviewed.version && row.active && !row.draft
        && Number(row.amount) === wanted.amount && row.currency === 'usd' && row.external_price_id && provider);
      if (valid) try { await provider.validatePrice({ ...snapshot(row), priceId: row.external_price_id }); } catch { valid = false; }
      return { tier: wanted.tier, interval: wanted.interval, id: row?.id || null, ready: valid };
    }));
    checks.approvedPriceMappings = selected.length === reviewed.plans.length && plans.every(plan => plan.ready);
  } catch { checks.database = false; }
  return { ready: Object.values(checks).every(Boolean), checks, plans,
    note: 'Configuration and test Price checks only. Verify public HTTPS, email delivery, signed Stripe events and server activation in the hosted test flow.' };
}
module.exports = { customerReadiness };
