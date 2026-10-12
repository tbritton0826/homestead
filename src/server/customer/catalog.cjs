const { TIER_DEFINITIONS } = require('../subscription-entitlements.cjs');
const { transaction } = require('./database.cjs');
const { failure } = require('./security.cjs');
function snapshot(plan) {
  return { id: plan.id, tier: plan.tier, version: plan.version, name: plan.name, description:plan.description, amount: plan.amount === null ? null : Number(plan.amount),
    currency: plan.currency, billingInterval: plan.billing_interval, productKind: plan.product_kind, features: plan.features, limits: plan.limits };
}
async function seedDrafts(pool) {
  await transaction(pool, async db => {
    for (const [tier, definition] of Object.entries(TIER_DEFINITIONS)) {
      for (const interval of (tier === 'free' ? ['none'] : ['month', 'year'])) {
        await db.query(`INSERT INTO customer_plans(id,tier,version,name,description,amount,currency,billing_interval,active,draft,features,limits)
          VALUES($1,$2,1,$3,$4,$5,'usd',$6,false,true,$7,$8) ON CONFLICT(id) DO NOTHING`,
        [`${tier}-${interval}-v1`, tier, definition.name, 'Draft — pricing and availability require approval.', tier === 'free' ? 0 : null, interval, JSON.stringify(definition.features), JSON.stringify(definition.limits)]);
      }
    }
  });
}
async function publishPlan(pool, input, provider) {
  const definition = TIER_DEFINITIONS[input.tier];
  if (!definition || !/^[a-z0-9-]{1,80}$/.test(input.id || '') || !Number.isInteger(input.version) || input.version < 1 ||
    !['month','year','none'].includes(input.interval) || !Number.isSafeInteger(input.amount) || input.amount < 0 ||
    !/^[a-z]{3}$/.test(input.currency || '') || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
    throw failure(400, 'Invalid plan configuration.');
  if (input.amount === 0 && input.tier !== 'free') throw failure(400, 'Paid tier requires an approved nonzero price.');
  if (input.amount > 0 && input.interval === 'none') throw failure(400, 'Paid subscriptions require a monthly or annual interval.');
  if (input.tier === 'free' && (input.amount !== 0 || input.interval !== 'none')) throw failure(400, 'Free plan must have no billing interval.');
  if (input.amount > 0) {
    if (!provider || !input.priceId) throw failure(400, 'Stripe test Price mapping required.');
    await provider.validatePrice({ ...input, billingInterval: input.interval });
  }
  return transaction(pool, async db => {
    const existing = (await db.query('SELECT * FROM customer_plans WHERE id=$1 FOR UPDATE', [input.id])).rows[0];
    if (existing && !existing.draft) throw failure(409, 'Published plans are immutable. Publish a new version.');
    if (existing && (existing.tier !== input.tier || existing.version !== input.version || existing.billing_interval !== input.interval))
      throw failure(409, 'Plan identity does not match the existing draft.');
    await db.query(`INSERT INTO customer_plans(id,tier,version,name,description,amount,currency,billing_interval,active,draft,features,limits)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,false,$9,$10) ON CONFLICT(id) DO UPDATE SET
      name=EXCLUDED.name, description=EXCLUDED.description, amount=EXCLUDED.amount,currency=EXCLUDED.currency,active=true,draft=false
      WHERE customer_plans.draft AND customer_plans.tier=EXCLUDED.tier AND customer_plans.version=EXCLUDED.version AND customer_plans.billing_interval=EXCLUDED.billing_interval`,
    [input.id, input.tier, input.version, input.name.trim(), String(input.description || '').slice(0,1000), input.amount, input.currency, input.interval, JSON.stringify(definition.features), JSON.stringify(definition.limits)]);
    if (input.priceId) await db.query(`INSERT INTO customer_provider_prices(provider,external_price_id,plan_id,mode) VALUES('stripe',$1,$2,'test')`, [input.priceId,input.id]);
  });
}
module.exports = { seedDrafts, publishPlan, snapshot };
