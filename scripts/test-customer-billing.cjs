const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
const Stripe=require('stripe');
const {testPool}=require('./customer-test-support.cjs');
const {mountCustomer,customerOnlyGate}=require('../src/server/customer/index.cjs');
const {migrate,createPool}=require('../src/server/customer/database.cjs');
const {publishPlan}=require('../src/server/customer/catalog.cjs');
const {configuration,hashPassword,verifyPassword}=require('../src/server/customer/security.cjs');
const {createStripeProvider}=require('../src/server/customer/providers/stripe.cjs');
const {verifyLicenseToken}=require('../src/server/subscription-entitlements.cjs');
const {createMailTransport}=require('../src/server/customer/mail.cjs');

test('database TLS cannot be overridden by URL options and idle errors have a handler',async()=> {
  const env={HOMESTEAD_CUSTOMER_DATABASE_URL:'postgresql://fixture:fixture@db.example.test/customer_fixture',HOMESTEAD_CUSTOMER_DB_TLS:'true'};
  assert.throws(()=>createPool({...env,HOMESTEAD_CUSTOMER_DATABASE_URL:env.HOMESTEAD_CUSTOMER_DATABASE_URL+'?sslmode=no-verify'}));
  const pool=createPool(env);assert.equal(pool.options.ssl.rejectUnauthorized,true);assert.equal(pool.listenerCount('error'),1);await pool.end();
});

test('production SMTP requires verified TLS and prevents secret-bearing debug logs',()=> {
  const transport=createMailTransport({NODE_ENV:'production',HOMESTEAD_CUSTOMER_SMTP_URL:'smtp://fixture-user:fixture-password@mail.example.test:587?ignoreTLS=true&tls.rejectUnauthorized=false&debug=true'});
  assert.equal(transport.options.requireTLS,true);assert.equal(transport.options.ignoreTLS,false);
  assert.equal(transport.options.tls.rejectUnauthorized,true);assert.equal(transport.options.debug,false);
  assert.equal(transport.options.socketTimeout,20000);transport.close();
});

test('customer prices display Stripe charge units correctly',async()=> {
  const {money}=await import('../src/customer/money.js');
  assert.equal(money(1234,'usd','en-US'),'$12.34');
  assert.equal(money(1234,'jpy','en-US'),'¥1,234');
  assert.equal(money(500,'isk','en-US'),'ISK 5');
});

test('commercial customer foundation and billing lifecycle',async t=> {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'homestead-customer-test-'));
  let pool=await testPool(path.join(directory,'postgres'));
  const app=express();app.set('trust proxy','loopback');
  app.use(customerOnlyGate);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
  const env={NODE_ENV:'test',HOMESTEAD_CUSTOMER_ENABLED:'true',HOMESTEAD_CUSTOMER_ORIGIN:origin,
    HOMESTEAD_CUSTOMER_MAIL_KEY:'a'.repeat(64),HOMESTEAD_PAYMENT_MODE:'test',STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:'whsec_fixture_only',
    HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'})};
  const mail=[],prices=new Map(),sessions=new Map(),subscriptions=new Map(),invoices=new Map(),charges=new Map(),checkoutKeys=new Map();let sequence=0,checkoutCreates=0,failResolve=false,loseCheckoutResponse=false;
  const fixtureSdk={webhooks:Stripe.webhooks,
    prices:{retrieve:async id=>prices.get(id)},customers:{create:async()=>({id:`cus_fixture_${++sequence}`,livemode:false})},
    subscriptions:{retrieve:async id=>{if(failResolve)throw new Error('fixture outage');return structuredClone(subscriptions.get(id));},list:async({customer})=>({data:[...subscriptions.values()].filter(sub=>sub.customer===customer),has_more:false})},
    checkout:{sessions:{create:async(input,options)=>{if(checkoutKeys.has(options.idempotencyKey))return checkoutKeys.get(options.idempotencyKey);checkoutCreates++;const id=`cs_test_fixture_${++sequence}`;const session={id,livemode:false,url:`https://checkout.stripe.com/c/pay/${id}`,status:'open',payment_status:'unpaid',customer:input.customer,client_reference_id:input.client_reference_id,subscription:null};sessions.set(id,session);checkoutKeys.set(options.idempotencyKey,session);if(loseCheckoutResponse){loseCheckoutResponse=false;throw new Error('fixture lost provider response');}return session;},retrieve:async id=>sessions.get(id)}},
    billingPortal:{sessions:{create:async input=>{assert.ok(input.customer.startsWith('cus_fixture_'));return {url:'https://billing.stripe.com/p/session/test_fixture'};}}},
    invoices:{retrieve:async id=>structuredClone(invoices.get(id))},
    invoicePayments:{list:async input=>({has_more:false,data: input.invoice ? [{invoice:input.invoice,payment:{type:'payment_intent',payment_intent:`pi_${input.invoice}`}}] : [...invoices.values()].filter(invoice=>`pi_${invoice.id}`===input.payment.payment_intent).map(invoice=>({invoice:invoice.id}))})},
    paymentIntents:{retrieve:async id=>({livemode:false,latest_charge:`ch_${id.slice(3)}`})},charges:{retrieve:async id=>charges.get(id)},
  };
  const provider=createStripeProvider(env,fixtureSdk);
  let service=mountCustomer({app,express,env,pool,provider,sendMail:async message=>mail.push(message),background:false});await service.ready;
  async function request(endpoint,body,jar={},extra={}) {
    const response=await fetch(`${origin}/api/customer${endpoint}`,{method:extra.method || (body?'POST':'GET'),headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':jar.csrf || '',Cookie:jar.cookie || '',...extra.headers},body:body?JSON.stringify(body):undefined});
    for(const value of response.headers.getSetCookie()) {
      const pair=value.split(';')[0];jar.pairs ||= {};const [key]=pair.split('=');jar.pairs[key]=pair.slice(key.length+1);jar.cookie=Object.entries(jar.pairs).map(([name,token])=>`${name}=${token}`).join('; ');
    }
    const data=await response.json();if(data.csrfToken)jar.csrf=data.csrfToken;return {status:response.status,data};
  }
  async function anonymous(){const jar={};assert.equal((await request('/session',null,jar)).status,200);return jar;}
  const linkToken=purpose=>new URL(mail.findLast(message=>message.subject.includes(purpose==='verify'?'Verify':'Reset')).text.match(/https?:\/\/\S+/)[0]).hash.slice(7);
  async function webhook(type,object,eventId=`evt_fixture_${++sequence}`,headerOverride) {
    const payload=JSON.stringify({id:eventId,type,livemode:false,data:{object}});
    const signature=headerOverride || Stripe.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});
    const response=await fetch(`${origin}/api/customer/webhooks/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body:payload});return {status:response.status,data:await response.json(),id:eventId};
  }
  function paidInvoice(id,sub,price='price_family_fixture',amount=1000) {
    const value={id,livemode:false,customer:sub.customer,parent:{subscription_details:{subscription:sub.id}},status:'paid',amount_paid:amount,amount_due:amount,currency:'usd',hosted_invoice_url:'https://invoice.stripe.com/i/test_fixture',status_transitions:{paid_at:Math.floor(Date.now()/1000)},lines:{data:[{pricing:{price_details:{price}}}]}};
    invoices.set(id,value);charges.set(`ch_${id}`,{id:`ch_${id}`,livemode:false,customer:sub.customer,amount_refunded:0,payment_intent:`pi_${id}`});return value;
  }
  async function plan(tier,amount) {
    const priceId=`price_${tier}_fixture`;prices.set(priceId,{livemode:false,active:true,unit_amount:amount,currency:'usd',recurring:{interval:'month',interval_count:1}});
    await publishPlan(pool,{id:`${tier}-month-v1`,tier,version:1,name:`${tier} fixture`,amount,currency:'usd',interval:'month',priceId},provider);
  }
  let a,b,customerA,customerB,session,sub;
  try {
    await t.test('dedicated customer host hides local owner and private media endpoints',async()=> {
      for(const route of ['/api/accounts','/api/setup','/api/platform','/media/private.mp4','/customerish']) {
        assert.equal((await fetch(origin+route)).status,404);
      }
      const root=await fetch(origin,{redirect:'manual'});assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/customer/pricing');
      assert.equal((await request('/health')).status,200);
    });
    await t.test('configuration refuses live keys, live mode, and insecure production origins',()=> {
      assert.throws(()=>createStripeProvider({...env,STRIPE_SECRET_KEY:'sk_live_fixture'}));
      assert.throws(()=>createStripeProvider({...env,HOMESTEAD_PAYMENT_MODE:'live'}));
      assert.throws(()=>configuration({...env,NODE_ENV:'production'}));
      assert.throws(()=>configuration({...env,HOMESTEAD_CUSTOMER_ORIGIN:'http://10.0.0.224:7312'}));
    });
    await t.test('migrations are repeatable and reject changed applied checksums',async()=> {
      await migrate(pool);assert.equal((await pool.query('SELECT * FROM customer_schema_migrations')).rows.length,1);
      const checksum=(await pool.query('SELECT checksum FROM customer_schema_migrations')).rows[0].checksum;
      await pool.query("UPDATE customer_schema_migrations SET checksum='changed'");await assert.rejects(migrate(pool));
      await pool.query('UPDATE customer_schema_migrations SET checksum=$1',[checksum]);
    });
    await t.test('catalog has draft tiers without invented paid prices',async()=> {
      await assert.rejects(publishPlan(pool,{id:'family-year-v1',tier:'family',version:1,name:'invalid fixture',amount:1000,currency:'usd',interval:'none',priceId:'price_family_fixture'},provider));
      const result=await request('/plans');assert.equal(result.data.plans.length,7);
      assert.ok(result.data.plans.every(plan=>plan.draft && !plan.active));assert.ok(result.data.plans.filter(plan=>plan.tier!=='free').every(plan=>plan.amount===null));
      await plan('family',1000);await plan('plus',2000);
      await assert.rejects(publishPlan(pool,{id:'family-year-v1',tier:'plus',version:1,name:'wrong draft identity',amount:2000,currency:'usd',interval:'month',priceId:'price_plus_fixture'},provider));
      await assert.rejects(publishPlan(pool,{id:'family-month-v1',tier:'family',version:1,name:'changed fixture',amount:1000,currency:'usd',interval:'month',priceId:'price_family_fixture'},provider));
    });
    await t.test('CSRF and origin checks reject forged writes',async()=> {
      a=await anonymous();assert.equal((await request('/register',{email:'bad',password:'fixture-long-password',displayName:'Fixture'},a,{headers:{Origin:'https://evil.invalid'}})).status,403);
      assert.equal((await request('/register',{email:'bad'},a,{headers:{'X-CSRF-Token':''}})).status,403);
      assert.equal((await request('/register',{email:'bad',password:'fixture-long-password',displayName:'Fixture'},a)).status,400);
    });
    await t.test('registration persists a unique normalized identity and encrypted verification mail',async()=> {
      assert.equal((await request('/register',{email:'A@EXAMPLE.TEST',password:'fixture-long-password',displayName:'Fixture A',role:'admin'},a)).status,201);
      customerA=(await pool.query("SELECT * FROM customers WHERE email='a@example.test'")).rows[0];assert.equal(customerA.status,'active');
      const identity=(await pool.query('SELECT * FROM customer_identities WHERE customer_id=$1',[customerA.id])).rows[0];assert.notEqual(identity.password_hash,'fixture-long-password');assert.ok(await verifyPassword('fixture-long-password',identity.password_hash));
      const outbox=(await pool.query('SELECT * FROM customer_mail_outbox')).rows[0];assert.ok(!outbox.payload.includes('a@example.test'));
      assert.equal((await request('/register',{email:'a@example.test',password:'fixture-long-password',displayName:'Duplicate'},a)).status,409);
      await service.mailer.flush();assert.equal(mail.length,1);
    });
    await t.test('login requires credentials; unverified accounts cannot checkout',async()=> {
      assert.equal((await request('/login',{email:'a@example.test',password:'bad-password'},a)).status,401);
      assert.equal((await request('/login',{email:'a@example.test',password:'fixture-long-password'},a)).status,200);
      assert.equal((await request('/checkout',{planId:'family-month-v1',requestId:crypto.randomUUID()},a)).status,403);
    });
    await t.test('verification links are expiring and single-use',async()=> {
      const token=linkToken('verify');assert.equal((await request('/verify',{token},a)).status,200);
      assert.equal((await request('/verify',{token},a)).status,400);await request('/session',null,a);
      assert.equal((await request('/profile',{displayName:'Updated A',preferences:{theme:'dark'},status:'closed',email:'evil@example.test'},a,{method:'PATCH'})).status,200);
      assert.equal((await pool.query('SELECT email,status FROM customers WHERE id=$1',[customerA.id])).rows[0].email,'a@example.test');
    });
    await t.test('checkout uses server-owned customer/price and is idempotent',async()=> {
      const id=crypto.randomUUID();const input={planId:'family-month-v1',requestId:id,price:'price_evil',customerId:'someone-else',amount:1};
      loseCheckoutResponse=true;assert.equal((await request('/checkout',input,a)).status,500);
      const durable=(await pool.query('SELECT * FROM customer_checkouts WHERE id=$1',[id])).rows[0];assert.equal(durable.customer_id,customerA.id);assert.equal(durable.external_session_id,null);
      assert.equal((await request('/checkout',input,a)).status,200);assert.equal((await request('/checkout',input,a)).status,200);assert.equal(checkoutCreates,1);
      session=[...sessions.values()][0];assert.equal(session.client_reference_id,id);
      assert.equal((await request(`/checkout-status?session_id=${session.id}`,null,a)).data.entitlements.active,false,'return-page status never grants access');
      assert.equal((await request('/checkout',{planId:'plus-month-v1',requestId:crypto.randomUUID()},a)).status,409);
      const concurrent=await Promise.all([request('/checkout',{planId:'family-month-v1',requestId:crypto.randomUUID()},a),request('/checkout',{planId:'family-month-v1',requestId:crypto.randomUUID()},a)]);
      assert.ok(concurrent.every(response=>response.status===200));assert.equal(checkoutCreates,1);
    });
    await t.test('customer ownership protects checkout, subscriptions, history, and portal',async()=> {
      b=await anonymous();await request('/register',{email:'b@example.test',password:'fixture-long-password',displayName:'Fixture B'},b);await service.mailer.flush();
      await request('/verify',{token:linkToken('verify')},b);await request('/login',{email:'b@example.test',password:'fixture-long-password'},b);
      customerB=(await pool.query("SELECT * FROM customers WHERE email='b@example.test'")).rows[0];
      assert.equal((await request(`/checkout-status?session_id=${session.id}`,null,b)).status,404);
      assert.equal((await request('/checkout',{planId:'family-month-v1',requestId:session.client_reference_id},b)).status,409);
      assert.equal((await request('/portal',{customerId:customerA.id},b)).status,404);
      assert.deepEqual((await request('/purchases',null,b)).data.transactions,[]);
    });
    await t.test('invalid signatures and live webhook objects are rejected',async()=> {
      assert.equal((await webhook('invoice.paid',{id:'in_unknown'},undefined,'invalid')).status,400);
      const payload=JSON.stringify({id:'evt_live',type:'invoice.paid',livemode:true,data:{object:{id:'in_live'}}});
      const response=await fetch(`${origin}/api/customer/webhooks/stripe`,{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':Stripe.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET})},body:payload});assert.equal(response.status,400);
    });
    await t.test('verified checkout and paid subscription grant expected entitlements',async()=> {
      const seconds=Math.floor(Date.now()/1000);sub={id:'sub_fixture',livemode:false,customer:session.customer,status:'active',latest_invoice:'in_fixture',items:{data:[{price:{id:'price_family_fixture'},quantity:1,current_period_start:seconds,current_period_end:seconds+2592000}],has_more:false},cancel_at_period_end:false};
      subscriptions.set(sub.id,sub);paidInvoice('in_fixture',sub);Object.assign(session,{status:'complete',payment_status:'paid',subscription:sub.id});
      assert.equal((await webhook('checkout.session.completed',{id:session.id,customer:session.customer})).status,200);
      const access=(await request('/entitlements',null,a)).data;assert.ok(access.active && access.features.includes('recipes'));assert.ok(!access.features.includes('cloud'));
      assert.equal(access.hasActiveSubscription,true);
      assert.equal((await request('/purchases',null,a)).data.transactions.length,1);
      assert.equal((await request('/portal',{},a)).status,200);
      const signed=(await request('/license',{},a)).data.token;assert.equal(verifyLicenseToken(signed,publicKey).tier,'family');
    });
    await t.test('duplicate webhook delivery cannot duplicate transactions or licenses',async()=> {
      const event=await webhook('invoice.paid',{id:'in_fixture',customer:sub.customer});const duplicate=await webhook('invoice.paid',{id:'in_fixture',customer:sub.customer},event.id);
      assert.ok(duplicate.data.duplicate);assert.equal((await pool.query('SELECT * FROM customer_transactions')).rows.length,1);assert.equal((await pool.query('SELECT * FROM customer_licenses')).rows.length,1);
    });
    await t.test('failed processing is durable and retryable',async()=> {
      failResolve=true;const event=await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.equal(event.status,500);
      assert.equal((await pool.query('SELECT status FROM customer_payment_events WHERE external_event_id=$1',[event.id])).rows[0].status,'failed');
      failResolve=false;assert.equal((await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer},event.id)).status,200);
    });
    await t.test('failed renewal revokes paid access; confirmed renewal restores it',async()=> {
      sub.status='past_due';sub.latest_invoice='in_renewal';paidInvoice('in_renewal',sub);Object.assign(invoices.get('in_renewal'),{status:'open',amount_paid:0,status_transitions:{paid_at:null}});
      await webhook('invoice.payment_failed',{id:'in_renewal',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,false);
      sub.status='active';paidInvoice('in_renewal',sub);await webhook('invoice.paid',{id:'in_renewal',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,true);
    });
    await t.test('upgrades/downgrades reconcile current plans without rewriting old history',async()=> {
      sub.items.data[0].price.id='price_plus_fixture';sub.latest_invoice='in_upgrade';paidInvoice('in_upgrade',sub,'price_plus_fixture',2000);
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.ok((await request('/entitlements',null,a)).data.features.includes('cloud'));
      assert.equal((await pool.query("SELECT plan_snapshot FROM customer_transactions WHERE external_payment_id='in_fixture'")).rows[0].plan_snapshot.tier,'family');
      sub.items.data[0].price.id='price_family_fixture';sub.latest_invoice='in_downgrade';paidInvoice('in_downgrade',sub);
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.ok(!(await request('/entitlements',null,a)).data.features.includes('cloud'));
    });
    await t.test('partial refunds are recorded; fully refunded current funding revokes access',async()=> {
      charges.get('ch_in_downgrade').amount_refunded=100;await webhook('charge.refunded',{id:'ch_in_downgrade',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,true);
      charges.get('ch_in_downgrade').amount_refunded=1000;await webhook('charge.refunded',{id:'ch_in_downgrade',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,false);
      assert.equal(Number((await pool.query("SELECT refunded_amount FROM customer_transactions WHERE external_payment_id='in_downgrade'")).rows[0].refunded_amount),1000);
    });
    await t.test('refund of an older period cannot revoke a newly funded period',async()=> {
      sub.latest_invoice='in_current';paidInvoice('in_current',sub);await webhook('invoice.paid',{id:'in_current',customer:sub.customer});
      charges.get('ch_in_fixture').amount_refunded=1000;await webhook('charge.refunded',{id:'ch_in_fixture',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,true);
    });
    await t.test('cancel at period end preserves access; canceled/expired state cannot be undone by old delivery',async()=> {
      sub.cancel_at_period_end=true;await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,true);
      sub.status='canceled';await webhook('customer.subscription.deleted',{id:sub.id,customer:sub.customer});
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer,status:'active'});assert.equal((await request('/entitlements',null,a)).data.active,false);
      sub.status='active';sub.items.data[0].current_period_end=Math.floor(Date.now()/1000)-60;await webhook('invoice.paid',{id:'in_current',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,false);
    });
    await t.test('unmapped provider price never grants access and event can be retried after reconciliation',async()=> {
      sub.items.data[0].price.id='price_unapproved';const event=await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.equal(event.status,500);
      assert.equal((await request('/entitlements',null,a)).data.active,false);sub.items.data[0].price.id='price_family_fixture';await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer},event.id);
    });
    await t.test('password reset revokes sessions and cannot be replayed',async()=> {
      await request('/forgot-password',{email:'b@example.test'},b);await service.mailer.flush();const token=linkToken('reset');
      assert.equal((await request('/reset',{token,password:'new-fixture-password'},b)).status,200);assert.equal((await request('/dashboard',null,b)).status,401);
      await request('/session',null,b);assert.equal((await request('/reset',{token,password:'new-fixture-password'},b)).status,400);
      assert.equal((await request('/login',{email:'b@example.test',password:'fixture-long-password'},b)).status,401);
      assert.equal((await request('/login',{email:'b@example.test',password:'new-fixture-password'},b)).status,200);
      await request('/logout',{},b);assert.equal((await request('/dashboard',null,b)).status,401);
    });
    await t.test('expired tokens and sessions, account suspension, and SQL injection do not bypass authorization',async()=> {
      await request('/session',null,b);
      await request('/forgot-password',{email:'b@example.test'},b);await service.mailer.flush();const token=linkToken('reset');await pool.query("UPDATE customer_tokens SET expires_at=now()-interval '1 second'");
      assert.equal((await request('/reset',{token,password:'new-fixture-password'},b)).status,400);
      await pool.query("UPDATE customers SET status='suspended' WHERE id=$1",[customerA.id]);assert.equal((await request('/dashboard',null,a)).status,401);
      await pool.query("UPDATE customers SET status='active' WHERE id=$1",[customerA.id]);await pool.query("UPDATE customer_sessions SET expires_at=now()-interval '1 second'");assert.equal((await request('/dashboard',null,a)).status,401);
      await request('/session',null,a);
      assert.equal((await request('/login',{email:"' OR 1=1 --@example.test",password:'fixture-long-password'},a)).status,400);
      assert.equal((await request('/login',{email:"x'OR'1'='1@example.test",password:'fixture-long-password'},a)).status,401);
    });
    await t.test('free plan is configurable and grants only its published features',async()=> {
      await publishPlan(pool,{id:'free-none-v1',tier:'free',version:1,name:'Free fixture',amount:0,currency:'usd',interval:'none'},null);
      await request('/session',null,b);await request('/login',{email:'b@example.test',password:'new-fixture-password'},b);
      assert.equal((await request('/select-free',{planId:'free-none-v1'},b)).status,200);assert.deepEqual((await request('/entitlements',null,b)).data.features,['coreMedia']);
    });
    await t.test('rate limiting is persistent across requests',async()=> {
      const jar=await anonymous();let status;for(let index=0;index<31;index++)status=(await request('/register',{email:'invalid'},jar,{headers:{'X-Forwarded-For':'203.0.113.254'}})).status;
      assert.equal(status,429);assert.ok((await pool.query('SELECT * FROM customer_rate_limits')).rows.length>0);
    });
    await t.test('database restart retains customers, history, and migrations',async()=> {
      const count=Number((await pool.query('SELECT count(*) AS count FROM customer_transactions')).rows[0].count);assert.ok(count>=4);
      if(pool.engine==='PGlite') {
        await pool.end();pool=await testPool(path.join(directory,'postgres'));await migrate(pool);
        assert.equal(Number((await pool.query('SELECT count(*) AS count FROM customer_transactions')).rows[0].count),count);
        assert.equal((await pool.query('SELECT email FROM customers WHERE id=$1',[customerB.id])).rows[0].email,'b@example.test');
      } else { const client=await pool.connect();client.release();await migrate(pool);assert.equal(Number((await pool.query('SELECT count(*) AS count FROM customer_transactions')).rows[0].count),count); }
    });
  } finally {await new Promise(resolve=>server.close(resolve));await pool.end();await fs.rm(directory,{recursive:true,force:true});}
});
