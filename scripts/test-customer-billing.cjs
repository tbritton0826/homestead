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
const {publishPlan,configurePrices,APPROVED_PRICES}=require('../src/server/customer/catalog.cjs');
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

test('checkout UI waits for confirmed funding and displays failed/refunded states and annual savings',async()=> {
  const {checkoutMessage,annualSavings}=await import('../src/customer/billing-view.js');
  assert.equal(checkoutMessage({status:'complete',paymentStatus:'pending',confirmed:false}).title,'Payment confirmation pending');
  assert.equal(checkoutMessage({status:'complete',paymentStatus:'paid',confirmed:false}).title,'Payment confirmation pending');
  assert.equal(checkoutMessage({status:'complete',paymentStatus:'paid',confirmed:true}).title,'Purchase confirmed');
  assert.equal(checkoutMessage({paymentStatus:'failed'}).title,'Payment unsuccessful');
  assert.equal(checkoutMessage({paymentStatus:'refunded',confirmed:true}).title,'Purchase refunded');
  assert.equal(checkoutMessage({status:'expired'}).title,'Checkout expired');
  assert.equal(annualSavings({tier:'family',billingInterval:'year',amount:4999},[{tier:'family',billingInterval:'month',productKind:'subscription',amount:499}]),989);
});

test('V1 records and checksums survive the append-only purchase migration',async()=> {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'homestead-customer-migration-'));
  const pool=await testPool(path.join(directory,'postgres'));
  try {
    const sql=await fs.readFile(path.join(__dirname,'../src/server/customer/migrations/001-foundation.sql'),'utf8');
    const checksum=crypto.createHash('sha256').update(sql).digest('hex');
    await pool.query(sql);
    await pool.query('CREATE TABLE customer_schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
    await pool.query('INSERT INTO customer_schema_migrations(name,checksum) VALUES($1,$2)',['001-foundation.sql',checksum]);
    const customer=crypto.randomUUID(),mailId=crypto.randomUUID(),purchase=crypto.randomUUID();
    await pool.query("INSERT INTO customers(id,email,display_name) VALUES($1,'migration@example.test','Historic customer')",[customer]);
    await pool.query("INSERT INTO customer_identities(customer_id,provider,subject,password_hash) VALUES($1,'password','migration@example.test','historic-hash')",[customer]);
    await pool.query("INSERT INTO customer_mail_outbox(id,payload) VALUES($1,'historic-encrypted-mail')",[mailId]);
    await pool.query(`INSERT INTO customer_plans(id,tier,version,name,amount,currency,billing_interval,active,draft,features) VALUES('family-month-v1','family',1,'Historic Family',1000,'usd','month',true,false,'["coreMedia"]')`);
    await pool.query(`INSERT INTO customer_transactions(id,customer_id,plan_id,provider,external_payment_id,amount,currency,status,plan_snapshot) VALUES($1,$2,'family-month-v1','stripe','in_historic',1000,'usd','paid','{"amount":1000,"name":"Historic Family"}')`,[purchase,customer]);
    await migrate(pool);await migrate(pool);
    const {seedDrafts}=require('../src/server/customer/catalog.cjs');await seedDrafts(pool);await seedDrafts(pool);
    assert.equal((await pool.query('SELECT checksum FROM customer_schema_migrations WHERE name=$1',['001-foundation.sql'])).rows[0].checksum,checksum);
    assert.equal((await pool.query('SELECT password_hash FROM customer_identities WHERE customer_id=$1',[customer])).rows[0].password_hash,'historic-hash');
    assert.equal((await pool.query('SELECT payload FROM customer_mail_outbox WHERE id=$1',[mailId])).rows[0].payload,'historic-encrypted-mail');
    assert.equal((await pool.query('SELECT plan_snapshot FROM customer_transactions WHERE id=$1',[purchase])).rows[0].plan_snapshot.amount,1000);
    assert.equal(Number((await pool.query("SELECT amount FROM customer_plans WHERE id='family-month-v1'")).rows[0].amount),1000);
    assert.equal((await pool.query('SELECT * FROM customer_plans')).rows.length,9);
  } finally {await pool.end();await fs.rm(directory,{recursive:true,force:true});}
});

test('commercial deployment isolates PostgreSQL 17, secrets, HTTPS origin and private media',async()=> {
  const compose=await fs.readFile(path.join(__dirname,'../docker-compose.customer.yml'),'utf8');
  assert.match(compose,/postgres:17-bookworm/);assert.match(compose,/HOMESTEAD_CUSTOMER_ONLY: "true"/);
  assert.match(compose,/HOMESTEAD_PAYMENT_MODE: test/);assert.match(compose,/127\.0\.0\.1:/);assert.match(compose,/internal: true/);
  const database=compose.split('  customer-db:')[1].split('  customer-web:')[0];assert.doesNotMatch(database,/ports:/);
  assert.match(compose,/HOMESTEAD_CUSTOMER_ORIGIN.*:\?/);assert.doesNotMatch(compose,/10\.0\.0\.|media-database|homestead-ai/);
  const docker=await fs.readFile(path.join(__dirname,'../Dockerfile'),'utf8');assert.match(docker,/api\/customer\/health/);
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
  const mail=[],prices=new Map(),sessions=new Map(),subscriptions=new Map(),invoices=new Map(),charges=new Map(),paymentIntents=new Map(),checkoutKeys=new Map();let sequence=0,checkoutCreates=0,failResolve=false,loseCheckoutResponse=false;
  const fixtureSdk={webhooks:Stripe.webhooks,
    prices:{retrieve:async id=>prices.get(id)},customers:{create:async()=>({id:`cus_fixture_${++sequence}`,livemode:false})},
    subscriptions:{retrieve:async id=>{if(failResolve)throw new Error('fixture outage');return structuredClone(subscriptions.get(id));},list:async({customer})=>({data:[...subscriptions.values()].filter(sub=>sub.customer===customer),has_more:false})},
    checkout:{sessions:{create:async(input,options)=>{if(checkoutKeys.has(options.idempotencyKey))return checkoutKeys.get(options.idempotencyKey);checkoutCreates++;const id=`cs_test_fixture_${++sequence}`;const session={id,livemode:false,url:`https://checkout.stripe.com/c/pay/${id}`,status:'open',payment_status:'unpaid',customer:input.customer,client_reference_id:input.client_reference_id,subscription:null,mode:input.mode,priceRef:input.line_items[0].price};sessions.set(id,session);checkoutKeys.set(options.idempotencyKey,session);if(loseCheckoutResponse){loseCheckoutResponse=false;throw new Error('fixture lost provider response');}return session;},retrieve:async id=>sessions.get(id),list:async input=>({data:[...sessions.values()].filter(session=>session.payment_intent===input.payment_intent),has_more:false}),listLineItems:async id=>({data:[{price:{id:sessions.get(id).priceRef},quantity:1}],has_more:false})}},
    billingPortal:{configurations:{list:async()=>({has_more:false,data:[{id:'bpc_fixture',livemode:false,active:true,is_default:true,features:{subscription_update:{enabled:true,default_allowed_updates:['price'],products:[{product:'prod_fixture',adjustable_quantity:{enabled:false},prices:[...prices.keys()].filter(id=>id!=='price_wrong' && prices.get(id).recurring)}]}}}]})},sessions:{create:async input=>{assert.ok(input.customer.startsWith('cus_fixture_'));return {url:'https://billing.stripe.com/p/session/test_fixture'};}}},
    invoices:{retrieve:async id=>structuredClone(invoices.get(id))},
    invoicePayments:{list:async input=>({has_more:false,data: input.invoice ? [{invoice:input.invoice,payment:{type:'payment_intent',payment_intent:`pi_${input.invoice}`}}] : [...invoices.values()].filter(invoice=>`pi_${invoice.id}`===input.payment.payment_intent).map(invoice=>({invoice:invoice.id}))})},
    paymentIntents:{retrieve:async id=>paymentIntents.get(id) || ({livemode:false,latest_charge:`ch_${id.slice(3)}`})},charges:{retrieve:async id=>charges.get(id)},
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
  async function flushMail(){for(let i=0;i<20;i++){await service.mailer.flush();if(!(await pool.query("SELECT id FROM customer_mail_outbox WHERE sent_at IS NULL AND next_attempt_at<=now() AND attempts<8")).rows.length)break;}}
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
      await migrate(pool);assert.equal((await pool.query('SELECT * FROM customer_schema_migrations')).rows.length,2);
      const row=(await pool.query('SELECT name,checksum FROM customer_schema_migrations ORDER BY name')).rows[0];
      await pool.query("UPDATE customer_schema_migrations SET checksum='changed' WHERE name=$1",[row.name]);await assert.rejects(migrate(pool));
      await pool.query('UPDATE customer_schema_migrations SET checksum=$1 WHERE name=$2',[row.checksum,row.name]);
    });
    await t.test('approved USD catalog is database-backed and paid checkout awaits validated mappings',async()=> {
      await assert.rejects(publishPlan(pool,{id:'family-year-v1',tier:'family',version:1,name:'invalid fixture',amount:1000,currency:'usd',interval:'none',priceId:'price_family_fixture'},provider));
      const result=await request('/plans');assert.equal(result.data.plans.length,8);
      for(const item of result.data.plans) {assert.equal(item.amount,APPROVED_PRICES[item.tier][item.billingInterval]);assert.equal(item.available,item.tier==='free');}
      const mappings={};for(const item of result.data.plans.filter(p=>p.amount>0)) {const priceId=`price_approved_${item.id}`;prices.set(priceId,{livemode:false,active:true,type:item.productKind==='one_time'?'one_time':'recurring',unit_amount:item.amount,currency:'usd',recurring:item.productKind==='one_time'?null:{interval:item.billingInterval,interval_count:1}});mappings[item.id]=priceId;}
      prices.set('price_wrong',{livemode:false,active:true,type:'recurring',unit_amount:1,currency:'usd',recurring:{interval:'year',interval_count:1}});
      await assert.rejects(configurePrices(pool,{'family-month-v2':mappings['family-month-v2'],'plus-year-v2':'price_wrong'},provider));
      assert.equal((await pool.query("SELECT active FROM customer_plans WHERE id='family-month-v2'")).rows[0].active,false);
      await configurePrices(pool,mappings,provider);await configurePrices(pool,mappings,provider);
      assert.ok((await request('/plans')).data.plans.every(p=>p.available));
      await assert.rejects(configurePrices(pool,{'pro-none-v2':mappings['pro-month-v2']},provider));
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
      await flushMail();assert.equal(mail.length,1);
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
      b=await anonymous();await request('/register',{email:'b@example.test',password:'fixture-long-password',displayName:'Fixture B'},b);await flushMail();
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
    await t.test('portal rejects unapproved prices and quantity changes before creating a session',async()=> {
      const original=fixtureSdk.billingPortal.configurations.list;
      fixtureSdk.billingPortal.configurations.list=async()=>({has_more:false,data:[{id:'bpc_invalid',livemode:false,active:true,is_default:true,features:{subscription_update:{enabled:true,default_allowed_updates:['price'],products:[{prices:['price_unapproved'],adjustable_quantity:{enabled:false}}]}}}]});
      assert.equal((await request('/portal',{},a)).status,409);
      fixtureSdk.billingPortal.configurations.list=async()=>({has_more:false,data:[{id:'bpc_quantity',livemode:false,active:true,is_default:true,features:{subscription_update:{enabled:true,default_allowed_updates:['price','quantity'],products:[{prices:['price_family_fixture'],adjustable_quantity:{enabled:true}}]}}}]});
      assert.equal((await request('/portal',{},a)).status,409);
      fixtureSdk.billingPortal.configurations.list=original;
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
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});
      assert.equal((await pool.query("SELECT status FROM customer_transactions WHERE external_payment_id='in_renewal'")).rows[0].status,'failed','an open invoice still retains its failed attempt');
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
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer,status:'active'});assert.equal((await request('/entitlements',null,a)).data.active,true,'cancellation retains a confirmed future paid period');
      sub.status='active';sub.items.data[0].current_period_end=Math.floor(Date.now()/1000)-60;await webhook('invoice.paid',{id:'in_current',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.active,false);
    });
    await t.test('unmapped provider price never grants access and event can be retried after reconciliation',async()=> {
      sub.items.data[0].price.id='price_unapproved';const event=await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});assert.equal(event.status,500);
      assert.equal((await request('/entitlements',null,a)).data.active,false);sub.items.data[0].price.id='price_family_fixture';await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer},event.id);
    });

    await t.test('Free enrollment is idempotent; approved monthly payment cleanly upgrades it',async()=> {
      assert.equal((await request('/select-free',{planId:'free-none-v2'},b)).status,200);
      assert.equal((await request('/select-free',{planId:'free-none-v2'},b)).status,200);
      assert.equal((await pool.query("SELECT id FROM customer_licenses WHERE customer_id=$1 AND subscription_id IS NULL AND purchase_id IS NULL",[customerB.id])).rows.length,1);
      const response=await request('/checkout',{planId:'family-month-v2',requestId:crypto.randomUUID()},b);assert.equal(response.status,200);
      const checkout=[...sessions.values()].find(s=>s.url===response.data.url);assert.equal(checkout.mode,'subscription');assert.equal(checkout.priceRef,'price_approved_family-month-v2');
      const now=Math.floor(Date.now()/1000);const monthly={id:'sub_approved_month',livemode:false,customer:checkout.customer,status:'active',latest_invoice:'in_approved_month',items:{data:[{price:{id:checkout.priceRef},quantity:1,current_period_start:now,current_period_end:now+2592000}],has_more:false}};
      subscriptions.set(monthly.id,monthly);paidInvoice(monthly.latest_invoice,monthly,checkout.priceRef,499);Object.assign(checkout,{status:'complete',payment_status:'paid',subscription:monthly.id});
      await webhook('checkout.session.completed',{id:checkout.id,customer:checkout.customer});
      assert.equal((await request('/entitlements',null,b)).data.effectiveTier,'family');
      assert.equal((await pool.query("SELECT id FROM customer_licenses WHERE customer_id=$1 AND subscription_id IS NULL AND purchase_id IS NULL",[customerB.id])).rows.length,0);
      assert.equal((await request('/select-free',{planId:'free-none-v2'},b)).status,409);
      monthly.status='canceled';monthly.items.data[0].current_period_end=now-1;await webhook('customer.subscription.deleted',{id:monthly.id,customer:monthly.customer});
    });
    await t.test('annual Checkout uses its annual Price and period, with confirmed return state',async()=> {
      const response=await request('/checkout',{planId:'pro-year-v2',requestId:crypto.randomUUID()},b);assert.equal(response.status,200);
      const checkout=[...sessions.values()].find(s=>s.url===response.data.url);assert.equal(checkout.mode,'subscription');assert.equal(checkout.priceRef,'price_approved_pro-year-v2');
      const now=Math.floor(Date.now()/1000);const annual={id:'sub_annual',livemode:false,customer:checkout.customer,status:'active',latest_invoice:'in_annual',items:{data:[{price:{id:checkout.priceRef},quantity:1,current_period_start:now,current_period_end:now+31536000}],has_more:false}};
      subscriptions.set(annual.id,annual);paidInvoice(annual.latest_invoice,annual,checkout.priceRef,17999);Object.assign(checkout,{status:'complete',payment_status:'paid',subscription:annual.id});
      assert.equal((await request(`/checkout-status?session_id=${checkout.id}`,null,b)).data.confirmed,false);
      assert.equal((await webhook('checkout.session.completed',{id:checkout.id,customer:checkout.customer})).status,200);
      const result=(await request(`/checkout-status?session_id=${checkout.id}`,null,b)).data;assert.equal(result.confirmed,true);assert.equal(result.plan.billingInterval,'year');
      assert.equal((await request('/entitlements',null,b)).data.effectiveTier,'pro');
      annual.status='canceled';annual.items.data[0].current_period_end=now-1;await webhook('customer.subscription.deleted',{id:annual.id,customer:annual.customer});
    });
    let lifetimeCheckout,lifetimeIntent;
    function lifetimePayment(checkout) {
      const id=`pi_${checkout.id}`;const now=Math.floor(Date.now()/1000);
      Object.assign(checkout,{status:'complete',payment_status:'paid',payment_intent:id,amount_total:24999,currency:'usd'});
      const intent={id,livemode:false,customer:checkout.customer,amount:24999,amount_received:24999,currency:'usd',status:'succeeded',latest_charge:`ch_${id}`,metadata:{homesteadCheckoutId:checkout.client_reference_id}};
      paymentIntents.set(id,intent);charges.set(intent.latest_charge,{id:intent.latest_charge,livemode:false,customer:checkout.customer,payment_intent:id,amount:24999,currency:'usd',amount_refunded:0,paid:true,created:now,receipt_url:'https://pay.stripe.com/receipts/test_fixture'});return intent;
    }
    await t.test('lifetime Checkout coexists with a subscription and rejects duplicate pending clicks',async()=> {
      sub.status='active';sub.cancel_at_period_end=false;sub.items.data[0].current_period_end=Math.floor(Date.now()/1000)+2592000;
      await webhook('invoice.paid',{id:'in_current',customer:sub.customer});assert.equal((await request('/entitlements',null,a)).data.effectiveTier,'family');
      const response=await request('/checkout',{planId:'pro-none-v2',requestId:crypto.randomUUID()},a);assert.equal(response.status,200);
      lifetimeCheckout=[...sessions.values()].find(s=>s.url===response.data.url);assert.equal(lifetimeCheckout.mode,'payment');assert.equal(lifetimeCheckout.subscription,null);
      const again=await request('/checkout',{planId:'pro-none-v2',requestId:crypto.randomUUID()},a);assert.equal(again.data.url,response.data.url);
      lifetimeIntent=lifetimePayment(lifetimeCheckout);
      assert.equal((await request(`/checkout-status?session_id=${lifetimeCheckout.id}`,null,a)).data.confirmed,false);
    });
    await t.test('lifetime payment association and amount mismatches never grant access',async()=> {
      lifetimeIntent.metadata.homesteadCheckoutId=crypto.randomUUID();assert.equal((await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:lifetimeCheckout.customer})).status,500);
      lifetimeIntent.metadata.homesteadCheckoutId=lifetimeCheckout.client_reference_id;
      lifetimeCheckout.amount_total=1;assert.equal((await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:lifetimeCheckout.customer})).status,500);lifetimeCheckout.amount_total=24999;
      assert.equal((await request('/entitlements',null,a)).data.hasLifetime,false);
    });
    await t.test('lifetime fulfillment and notification are idempotent across different event IDs',async()=> {
      const event=await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:lifetimeCheckout.customer});assert.equal(event.status,200);
      await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:lifetimeCheckout.customer},event.id);
      await webhook('payment_intent.succeeded',{id:lifetimeIntent.id,customer:lifetimeCheckout.customer});
      const grants=(await pool.query('SELECT * FROM customer_licenses WHERE customer_id=$1 AND purchase_id IS NOT NULL',[customerA.id])).rows;assert.equal(grants.length,1);assert.equal(grants[0].expires_at,null);
      const access=(await request('/entitlements',null,a)).data;assert.equal(access.hasLifetime,true);assert.equal(access.hasActiveSubscription,true);assert.equal(access.effectiveTier,'pro');assert.equal(access.effectiveLicense.purchaseId,grants[0].purchase_id);
      sub.items.data[0].price.id='price_approved_pro-month-v2';sub.latest_invoice='in_pro_coexist';paidInvoice(sub.latest_invoice,sub,sub.items.data[0].price.id,1799);
      await webhook('customer.subscription.updated',{id:sub.id,customer:sub.customer});
      assert.equal((await request('/entitlements',null,a)).data.effectiveLicense.purchaseId,grants[0].purchase_id,'lifetime precedes even a valid Pro subscription');
      const signed=(await request('/license',{},a)).data;assert.equal(signed.expiresAt,null);assert.equal(verifyLicenseToken(signed.token,publicKey,Date.now()+10*365*86400000).tier,'pro');
      assert.equal((await request(`/checkout-status?session_id=${lifetimeCheckout.id}`,null,a)).data.confirmed,true);
      assert.equal((await request('/checkout',{planId:'pro-none-v2',requestId:crypto.randomUUID()},a)).status,409);
      assert.equal((await request(`/checkout-status?session_id=${lifetimeCheckout.id}`,null,b)).status,404);
      assert.equal((await pool.query("SELECT id FROM customer_mail_outbox WHERE notification_key=$1",[`stripe:${lifetimeIntent.id}:lifetime`])).rows.length,1);
    });
    await t.test('subscription expiration cannot revoke lifetime; highest license determines features',async()=> {
      sub.status='canceled';sub.items.data[0].current_period_end=Math.floor(Date.now()/1000)-1;
      await webhook('customer.subscription.deleted',{id:sub.id,customer:sub.customer});await webhook('invoice.paid',{id:'in_current',customer:sub.customer});
      const access=(await request('/entitlements',null,a)).data;assert.equal(access.hasActiveSubscription,false);assert.equal(access.hasLifetime,true);assert.equal(access.effectiveTier,'pro');
      // A lower valid grant cannot add unrelated features to the effective license.
      await pool.query("INSERT INTO customer_licenses(id,customer_id,plan_id,features,status) VALUES($1,$2,'free-none-v2',$3,'active')",[crypto.randomUUID(),customerA.id,JSON.stringify(['coreMedia','unapprovedFixtureFeature'])]);
      assert.equal((await request('/entitlements',null,a)).data.features.includes('unapprovedFixtureFeature'),false);
      await pool.query('DELETE FROM customer_licenses WHERE customer_id=$1 AND purchase_id IS NULL AND subscription_id IS NULL',[customerA.id]);
    });
    await t.test('partial/full lifetime refunds are current-state reconciled and preserve purchase history',async()=> {
      const charge=charges.get(lifetimeIntent.latest_charge);charge.amount_refunded=100;
      assert.equal((await webhook('charge.refunded',{id:charge.id,customer:charge.customer})).status,200);
      assert.equal((await request('/entitlements',null,a)).data.hasLifetime,true);
      charge.amount_refunded=24999;await webhook('charge.refunded',{id:charge.id,customer:charge.customer});
      await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:charge.customer});assert.equal((await request('/entitlements',null,a)).data.hasLifetime,false);
      const history=(await request('/purchases',null,a)).data.transactions.find(p=>p.plan_snapshot.productKind==='one_time');assert.equal(Number(history.amount),24999);assert.equal(Number(history.refunded_amount),24999);assert.equal(history.status,'refunded');assert.equal(history.receipt_url,'https://pay.stripe.com/receipts/test_fixture');
      const state=(await request(`/checkout-status?session_id=${lifetimeCheckout.id}`,null,a)).data;assert.equal(state.paymentStatus,'refunded');
    });
    await t.test('failed delayed payment stays unfulfilled, then activates on confirmed payment',async()=> {
      const response=await request('/checkout',{planId:'pro-none-v2',requestId:crypto.randomUUID()},a);assert.equal(response.status,200);
      const checkout=[...sessions.values()].find(s=>s.url===response.data.url);const intent=lifetimePayment(checkout);
      Object.assign(checkout,{payment_status:'unpaid'});Object.assign(intent,{status:'processing',amount_received:0,latest_charge:null});
      await webhook('checkout.session.completed',{id:checkout.id,customer:checkout.customer});
      assert.equal((await request(`/checkout-status?session_id=${checkout.id}`,null,a)).data.confirmed,false);
      assert.equal((await request('/checkout',{planId:'pro-none-v2',requestId:crypto.randomUUID()},a)).status,409,'completed unpaid Checkout blocks a second payment while confirmation is pending');
      intent.status='requires_payment_method';
      await webhook('checkout.session.async_payment_failed',{id:checkout.id,customer:checkout.customer});
      assert.equal((await request(`/checkout-status?session_id=${checkout.id}`,null,a)).data.paymentStatus,'failed');assert.equal((await request('/entitlements',null,a)).data.active,false);
      lifetimePayment(checkout);await webhook('checkout.session.async_payment_succeeded',{id:checkout.id,customer:checkout.customer});assert.equal((await request('/entitlements',null,a)).data.hasLifetime,true);
      const grant=(await pool.query("SELECT id FROM customer_licenses WHERE customer_id=$1 AND purchase_id IS NOT NULL AND status='active'",[customerA.id])).rows[0];
      await pool.query("UPDATE customer_licenses SET manual_revoked_at=now(),revoked_at=now(),status='revoked' WHERE id=$1",[grant.id]);
      await webhook('checkout.session.completed',{id:checkout.id,customer:checkout.customer});assert.equal((await request('/entitlements',null,a)).data.hasLifetime,false,'manual revocation survives subsequent paid events');
    });
    await t.test('billing mail covers lifecycle and deduplicates independent provider notifications',async()=> {
      await flushMail();
      for(const label of ['Subscription activated','Payment confirmed','Payment unsuccessful','Subscription cancellation','Refund recorded','Pro Lifetime activated']) assert.ok(mail.some(message=>message.subject.includes(label)),label);
      const keys=(await pool.query('SELECT notification_key FROM customer_mail_outbox WHERE notification_key IS NOT NULL')).rows.map(row=>row.notification_key);assert.equal(keys.length,new Set(keys).size);
      assert.ok(mail.filter(message=>message.subject.includes('Pro Lifetime')).every(message=>message.text.includes('gethomesteadapp.com') && message.text.includes('No recurring')));
      const prior=mail.length;await webhook('checkout.session.completed',{id:lifetimeCheckout.id,customer:lifetimeCheckout.customer});await flushMail();assert.equal(mail.length,prior);
    });
    await t.test('password reset revokes sessions and cannot be replayed',async()=> {
      await request('/forgot-password',{email:'b@example.test'},b);await flushMail();const token=linkToken('reset');
      assert.equal((await request('/reset',{token,password:'new-fixture-password'},b)).status,200);assert.equal((await request('/dashboard',null,b)).status,401);
      await request('/session',null,b);assert.equal((await request('/reset',{token,password:'new-fixture-password'},b)).status,400);
      assert.equal((await request('/login',{email:'b@example.test',password:'fixture-long-password'},b)).status,401);
      assert.equal((await request('/login',{email:'b@example.test',password:'new-fixture-password'},b)).status,200);
      await request('/logout',{},b);assert.equal((await request('/dashboard',null,b)).status,401);
    });
    await t.test('expired tokens and sessions, account suspension, and SQL injection do not bypass authorization',async()=> {
      await request('/session',null,b);
      await request('/forgot-password',{email:'b@example.test'},b);await flushMail();const token=linkToken('reset');await pool.query("UPDATE customer_tokens SET expires_at=now()-interval '1 second'");
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
      assert.equal((await request('/select-free',{planId:'free-none-v1'},b)).status,200);assert.deepEqual((await request('/entitlements',null,b)).data.features,['coreMedia','photos','adult']);
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
