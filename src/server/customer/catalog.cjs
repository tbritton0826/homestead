const { TIER_DEFINITIONS } = require('../subscription-entitlements.cjs');
const { transaction } = require('./database.cjs');
const { failure } = require('./security.cjs');
// Approved USD charge units. Environment-specific Stripe IDs never belong here.
const APPROVED_PRICES = Object.freeze({free:{none:0},family:{month:499,year:4999},plus:{month:999,year:9999},pro:{month:1799,year:17999,none:24999}});
function snapshot(plan) {
  return {id:plan.id,tier:plan.tier,version:plan.version,name:plan.name,description:plan.description,amount:plan.amount===null?null:Number(plan.amount),
    currency:plan.currency,billingInterval:plan.billing_interval,productKind:plan.product_kind,features:plan.features,limits:plan.limits};
}
async function seedDrafts(pool) {
  await transaction(pool,async db=> {
    for (const [tier,intervals] of Object.entries(APPROVED_PRICES)) for(const [interval,amount] of Object.entries(intervals)) {
      const definition=TIER_DEFINITIONS[tier],lifetime=tier==='pro' && interval==='none',free=tier==='free';
      await db.query(`INSERT INTO customer_plans(id,tier,version,name,description,amount,currency,billing_interval,product_kind,active,draft,features,limits)
        VALUES($1,$2,2,$3,$4,$5,'usd',$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
      [`${tier}-${interval}-v2`,tier,lifetime?'Homestead Pro Lifetime — Early Access':definition.name,
        lifetime?'One-time access to the current Pro software feature tier. External services and usage costs are separate. Long-term terms and future-version policy require approval before public sale.':free?'Core Homestead media, with no payment required.':'Homestead software features; external services and usage costs are separate.',
        amount,interval,lifetime?'one_time':'subscription',free,!free,JSON.stringify(definition.features),JSON.stringify(definition.limits)]);
    }
  });
}
async function publishPlan(pool,input,provider) {
  const definition=TIER_DEFINITIONS[input.tier];
  const productKind=input.productKind || 'subscription';
  if (!definition || !/^[a-z0-9-]{1,80}$/.test(input.id || '') || !Number.isInteger(input.version) || input.version<1 ||
    !['month','year','none'].includes(input.interval) || !Number.isSafeInteger(input.amount) || input.amount<0 ||
    !['subscription','one_time'].includes(productKind) || !/^[a-z]{3}$/.test(input.currency || '') || typeof input.name!=='string' || !input.name.trim() || input.name.length>100)
    throw failure(400,'Invalid plan configuration.');
  if (input.tier==='free' && (input.amount!==0 || input.interval!=='none' || productKind!=='subscription')) throw failure(400,'Free plan must have no billing interval.');
  if (input.tier!=='free' && input.amount===0) throw failure(400,'Paid tier requires an approved nonzero price.');
  if (input.amount>0 && (productKind==='one_time' ? input.tier!=='pro' || input.interval!=='none' : input.interval==='none')) throw failure(400,'Invalid product billing interval.');
  if (input.amount>0) {
    if (!provider || !input.priceId) throw failure(400,'Stripe test Price mapping required.');
    await provider.validatePrice({...input,productKind,billingInterval:input.interval});
  }
  return transaction(pool,async db=> {
    const existing=(await db.query('SELECT * FROM customer_plans WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
    if (existing && !existing.draft) throw failure(409,'Published plans are immutable. Publish a new version.');
    if (existing && (existing.tier!==input.tier || existing.version!==input.version || existing.billing_interval!==input.interval || existing.product_kind!==productKind)) throw failure(409,'Plan identity does not match the existing draft.');
    if (existing?.version===2 && (Number(existing.amount)!==input.amount || existing.currency!==input.currency)) throw failure(409,'Use the approved catalog price. Publish a reviewed new version for price changes.');
    await db.query(`INSERT INTO customer_plans(id,tier,version,name,description,amount,currency,billing_interval,product_kind,active,draft,features,limits)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,false,$10,$11) ON CONFLICT(id) DO UPDATE SET
      name=EXCLUDED.name,description=EXCLUDED.description,amount=EXCLUDED.amount,currency=EXCLUDED.currency,active=true,draft=false WHERE customer_plans.draft`,
    [input.id,input.tier,input.version,input.name.trim(),String(input.description || existing?.description || '').slice(0,1000),input.amount,input.currency,input.interval,productKind,JSON.stringify(definition.features),JSON.stringify(definition.limits)]);
    if(input.priceId) await db.query(`INSERT INTO customer_provider_prices(provider,external_price_id,plan_id,mode) VALUES('stripe',$1,$2,'test')`,[input.priceId,input.id]);
  });
}
async function configurePrices(pool,mappings,provider) {
  if(!provider || !mappings || Array.isArray(mappings) || typeof mappings!=='object' || !Object.keys(mappings).length) throw failure(400,'Test Price mappings are required.');
  const plans=(await pool.query('SELECT * FROM customer_plans WHERE version=2 AND amount>0')).rows;
  for(const [id,priceId] of Object.entries(mappings)) {
    const plan=plans.find(row=>row.id===id);
    if(!plan || typeof priceId!=='string' || !priceId.startsWith('price_')) throw failure(400,'Unknown catalog plan or invalid Price ID.');
    await provider.validatePrice({...snapshot(plan),priceId});
  }
  await transaction(pool,async db=> {
    for(const [id,priceId] of Object.entries(mappings)) {
      const old=(await db.query("SELECT external_price_id FROM customer_provider_prices WHERE provider=$1 AND plan_id=$2 AND mode='test'",[provider.name,id])).rows[0];
      if(old && old.external_price_id!==priceId) throw failure(409,'Published Price mappings are immutable. Create a new plan version.');
      await db.query("INSERT INTO customer_provider_prices(provider,external_price_id,plan_id,mode) VALUES($1,$2,$3,'test') ON CONFLICT DO NOTHING",[provider.name,priceId,id]);
      const mapping=(await db.query('SELECT plan_id FROM customer_provider_prices WHERE provider=$1 AND external_price_id=$2',[provider.name,priceId])).rows[0];
      if(mapping?.plan_id!==id) throw failure(409,'Price already belongs to another plan.');
      await db.query('UPDATE customer_plans SET active=true,draft=false WHERE id=$1',[id]);
    }
  });
}
module.exports={APPROVED_PRICES,seedDrafts,publishPlan,configurePrices,snapshot};
