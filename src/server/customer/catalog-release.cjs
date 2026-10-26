const {isDeepStrictEqual}=require('node:util');
const {TIER_DEFINITIONS}=require('../subscription-entitlements.cjs');
const {transaction}=require('./database.cjs');
const {failure}=require('./security.cjs');

function reviewedPlans(input) {
  if(!input || input.mode!=='test' || input.currency!=='usd' || !Number.isSafeInteger(input.version) || input.version<3 || input.version>10000 || !Array.isArray(input.plans) || input.plans.length!==6)
    throw failure(400,'Supply six reviewed USD sandbox plans with a new catalog version (3 or later).');
  const combinations=new Set(),priceIds=new Set();
  return input.plans.map(value=>{
    const definition=TIER_DEFINITIONS[value?.tier];
    if(!['family','plus','pro'].includes(value?.tier) || !['month','year'].includes(value?.interval)
      || !Number.isSafeInteger(value.amount) || value.amount<=0 || value.amount>100000000
      || typeof value.priceId!=='string' || !/^price_[A-Za-z0-9]{1,100}$/.test(value.priceId)) throw failure(400,'Invalid sandbox plan or Price ID.');
    const combination=`${value.tier}-${value.interval}`;
    if(combinations.has(combination) || priceIds.has(value.priceId))throw failure(400,'Each plan interval and Stripe Price must appear exactly once.');
    combinations.add(combination);priceIds.add(value.priceId);
    return {id:`${combination}-v${input.version}`,tier:value.tier,version:input.version,name:definition.name,
      description:'Homestead software features; external services and usage costs are separate.',
      amount:value.amount,currency:input.currency,billingInterval:value.interval,productKind:'subscription',
      priceId:value.priceId,features:definition.features,limits:definition.limits};
  });
}

async function inspectRelease(db,plans) {
  for(const plan of plans) {
    const existing=(await db.query('SELECT * FROM customer_plans WHERE id=$1 FOR UPDATE',[plan.id])).rows[0];
    if(existing && (existing.tier!==plan.tier || existing.version!==plan.version || existing.name!==plan.name
      || Number(existing.amount)!==plan.amount || existing.currency!==plan.currency || existing.billing_interval!==plan.billingInterval
      || existing.product_kind!==plan.productKind || !isDeepStrictEqual(existing.features,plan.features) || !isDeepStrictEqual(existing.limits,plan.limits)))
      throw failure(409,'This catalog version already has different plan details. Use a new reviewed version.');
    const newer=(await db.query('SELECT id FROM customer_plans WHERE tier=$1 AND billing_interval=$2 AND product_kind=$3 AND version>$4 LIMIT 1',[plan.tier,plan.billingInterval,plan.productKind,plan.version])).rows[0];
    if(newer)throw failure(409,'A newer catalog version already exists. Review the current catalog before publishing.');
    const byPlan=(await db.query("SELECT external_price_id FROM customer_provider_prices WHERE provider='stripe' AND plan_id=$1 AND mode='test'",[plan.id])).rows;
    if(byPlan.some(row=>row.external_price_id!==plan.priceId))throw failure(409,'This plan already maps to a different Price. Published mappings cannot be replaced.');
    const byPrice=(await db.query("SELECT plan_id,mode FROM customer_provider_prices WHERE provider='stripe' AND external_price_id=$1",[plan.priceId])).rows[0];
    if(byPrice && (byPrice.plan_id!==plan.id || byPrice.mode!=='test'))throw failure(409,'This Price already belongs to another plan. Existing bindings were preserved.');
  }
}

async function publishCatalogRelease({pool,provider,input,publish=false}) {
  const plans=reviewedPlans(input);
  if(provider?.name!=='stripe')throw failure(503,'A Stripe sandbox provider is required.');
  // Validate every external Price before any database write. The adapter refuses live objects,
  // different amounts/currencies, inactive Prices, and incorrect recurring intervals.
  for(const plan of plans)await provider.validatePrice(plan);
  return transaction(pool,async db=>{
    // Serialize competing publication/migration jobs. Unique constraints independently protect bindings.
    await db.query('SELECT pg_advisory_xact_lock(73126401)');
    await inspectRelease(db,plans);
    if(publish)for(const plan of plans) {
      await db.query(`INSERT INTO customer_plans(id,tier,version,name,description,amount,currency,billing_interval,product_kind,active,draft,features,limits)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,$10,$11) ON CONFLICT(id) DO UPDATE SET active=true,draft=false`,
        [plan.id,plan.tier,plan.version,plan.name,plan.description,plan.amount,plan.currency,plan.billingInterval,plan.productKind,JSON.stringify(plan.features),JSON.stringify(plan.limits)]);
      await db.query(`INSERT INTO customer_provider_prices(provider,external_price_id,plan_id,mode) VALUES('stripe',$1,$2,'test') ON CONFLICT DO NOTHING`,[plan.priceId,plan.id]);
      const actual=(await db.query("SELECT plan_id,mode FROM customer_provider_prices WHERE provider='stripe' AND external_price_id=$1",[plan.priceId])).rows[0];
      if(actual?.plan_id!==plan.id || actual.mode!=='test')throw failure(409,'Price binding changed during publication. The release was rolled back.');
    }
    if(publish)await inspectRelease(db,plans);
    return {mode:'test',version:input.version,published:publish,plans:plans.map(plan=>({id:plan.id,tier:plan.tier,amount:plan.amount,currency:plan.currency,interval:plan.billingInterval,priceId:plan.priceId}))};
  });
}
module.exports={reviewedPlans,publishCatalogRelease};
