const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const express=require('express');
const input=require('../deploy/customer-catalog/stripe-sandbox-v3.json');
const {testPool}=require('./customer-test-support.cjs');
const {migrate}=require('../src/server/customer/database.cjs');
const {seedDrafts}=require('../src/server/customer/catalog.cjs');
const {createStripeProvider}=require('../src/server/customer/providers/stripe.cjs');
const {reviewedPlans,publishCatalogRelease}=require('../src/server/customer/catalog-release.cjs');
const {mountCustomer}=require('../src/server/customer/index.cjs');

test('owner-approved sandbox release has exactly six unique monthly/annual prices in cents',()=>{
  const plans=reviewedPlans(input);
  assert.deepEqual(plans.map(plan=>[plan.id,plan.amount]),[
    ['family-month-v3',499],['family-year-v3',4999],['plus-month-v3',1199],
    ['plus-year-v3',10999],['pro-month-v3',1999],['pro-year-v3',18999]]);
  assert.equal(new Set(plans.map(plan=>plan.priceId)).size,6);
  for(const mutate of [value=>value.mode='live',value=>value.version=2,value=>value.currency='eur',value=>value.plans.pop(),
    value=>value.plans[0].amount=4.99,value=>value.plans[0].amount=0,value=>value.plans[1]=value.plans[0],value=>value.plans[0].priceId='sk_test_not_a_price']){
    const bad=structuredClone(input);mutate(bad);assert.throws(()=>reviewedPlans(bad));
  }
});

test('sandbox release validates, commits atomically, survives retries, and preserves historical catalog',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'homestead-catalog-v3-'));
  const pool=await testPool(path.join(directory,'postgres'));
  const plans=reviewedPlans(input),prices=new Map(plans.map(plan=>[plan.priceId,{id:plan.priceId,livemode:false,active:true,unit_amount:plan.amount,currency:'usd',type:'recurring',recurring:{interval:plan.billingInterval,interval_count:1}}]));
  const provider=createStripeProvider({HOMESTEAD_PAYMENT_MODE:'test',STRIPE_SECRET_KEY:'sk_test_fixture'}, {prices:{retrieve:async id=>structuredClone(prices.get(id))}});
  const count=async()=>Number((await pool.query('SELECT count(*) FROM customer_plans WHERE version=3')).rows[0].count);
  let oldPlans,oldBinding;
  const release=(publish=false,db=pool,document=input)=>publishCatalogRelease({pool:db,provider,input:document,publish});
  try {
    await migrate(pool);await seedDrafts(pool);
    await pool.query("UPDATE customer_plans SET active=true,draft=false WHERE id='family-month-v2'");
    await pool.query("INSERT INTO customer_provider_prices(provider,external_price_id,plan_id,mode) VALUES('stripe','price_historicalFamily','family-month-v2','test')");
    oldPlans=(await pool.query('SELECT * FROM customer_plans WHERE version=2 ORDER BY id')).rows;
    oldBinding=(await pool.query('SELECT * FROM customer_provider_prices ORDER BY external_price_id')).rows;
    await t.test('all six external Price checks run before database publication',async()=>{
      const id=plans[5].priceId,original=prices.get(id);
      for(const change of [{livemode:true},{active:false},{unit_amount:18998},{currency:'eur'},{recurring:{interval:'month',interval_count:1}},{recurring:{interval:'year',interval_count:2}}]){
        prices.set(id,{...original,...change});await assert.rejects(release(true));assert.equal(await count(),0);
      }
      prices.set(id,original);
      const checked=await release();assert.equal(checked.published,false);assert.equal(checked.plans.length,6);assert.equal(await count(),0);
    });
    await t.test('late database failure rolls back every plan and Price binding',async()=>{
      const failPool={connect:async()=>{const db=await pool.connect();return {release:()=>db.release(),query:(sql,values)=>{
        if(sql.includes('INSERT INTO customer_provider_prices') && values[0]===plans[5].priceId)throw new Error('fixture final insert failure');
        return db.query(sql,values);
      }};}};
      await assert.rejects(release(true,failPool),/fixture final insert failure/);assert.equal(await count(),0);
      assert.deepEqual((await pool.query('SELECT * FROM customer_provider_prices ORDER BY external_price_id')).rows,oldBinding);
    });
    await t.test('concurrent/repeated publication produces exactly six published plans',async()=>{
      const results=await Promise.all([release(true),release(true)]);assert.ok(results.every(value=>value.published));
      assert.equal(await count(),6);await release(true);assert.equal(await count(),6);
      assert.deepEqual((await pool.query('SELECT * FROM customer_plans WHERE version=2 ORDER BY id')).rows,oldPlans);
      const actual=(await pool.query('SELECT p.id,p.amount,p.active,p.draft,m.external_price_id FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE p.version=3 ORDER BY p.id')).rows;
      assert.equal(actual.length,6);assert.ok(actual.every(row=>row.active && !row.draft));
      assert.equal(Number(actual.find(row=>row.id==='plus-year-v3').amount),10999);
    });
    await t.test('published amounts and bindings cannot be replaced, including cross-plan Price reuse',async()=>{
      const changed=structuredClone(input);changed.plans[0].amount=599;
      const original=prices.get(changed.plans[0].priceId);prices.set(changed.plans[0].priceId,{...original,unit_amount:599});
      await assert.rejects(release(true,pool,changed),/different plan details/);prices.set(changed.plans[0].priceId,original);
      const remapped=structuredClone(input);remapped.plans[0].priceId='price_replacement';prices.set('price_replacement',{...original,id:'price_replacement'});
      await assert.rejects(release(true,pool,remapped),/different Price/);
      await assert.rejects(release(true,pool,{...input,version:4}),/another plan/);
      assert.equal(await count(),6);
    });
    await t.test('actual customer catalog API selects V3 and exposes the six verified current prices',async()=>{
      const app=express(),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      const origin=`http://127.0.0.1:${server.address().port}`;
      // The service uses the same DB but its test shutdown must not close the shared pool twice.
      const shared={query:pool.query.bind(pool),connect:pool.connect.bind(pool)};
      const service=mountCustomer({app,express,pool:shared,provider,background:false,env:{NODE_ENV:'test',HOMESTEAD_CUSTOMER_ENABLED:'true',HOMESTEAD_CUSTOMER_ORIGIN:origin,HOMESTEAD_CUSTOMER_MAIL_KEY:'a'.repeat(64)}});
      try {
        await service.ready;const response=await fetch(`${origin}/api/customer/plans`);assert.equal(response.status,200);
        const catalog=await response.json();const recurring=catalog.plans.filter(plan=>plan.amount>0 && plan.productKind==='subscription');
        assert.equal(recurring.length,6);assert.ok(recurring.every(plan=>plan.version===3 && plan.available && plan.active && !plan.draft));
        for(const plan of plans)assert.equal(recurring.find(row=>row.id===plan.id).amount,plan.amount);
        assert.equal(catalog.plans.find(plan=>plan.tier==='free').amount,0);
        assert.equal(catalog.plans.find(plan=>plan.productKind==='one_time').amount,24999);
      } finally {await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    });
    await t.test('a later catalog cannot be shadowed by publishing an older release',async()=>{
      await pool.query("INSERT INTO customer_plans(id,tier,version,name,amount,currency,billing_interval,product_kind,active,draft,features) VALUES('family-month-v4','family',4,'Future Family',699,'usd','month','subscription',false,true,'[]')");
      await assert.rejects(release(),/newer catalog/);
      assert.equal((await pool.query("SELECT amount FROM customer_plans WHERE id='family-month-v3'")).rows[0].amount.toString(),'499');
    });
  } finally {await pool.end();await fs.rm(directory,{recursive:true,force:true});}
});
