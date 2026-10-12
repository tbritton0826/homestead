const crypto=require('node:crypto');
const {transaction}=require('./database.cjs');
const {failure,text}=require('./security.cjs');
const {snapshot}=require('./catalog.cjs');
const {billingMessage}=require('./billing-mail.cjs');
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

function createBilling({pool,provider,config,auth,mailer}) {
  const priceAvailability=new Map();
  async function available(plan) {
    if(!plan.active || plan.draft) return false;
    if(Number(plan.amount)===0) return true;
    if(!provider || !plan.external_price_id) return false;
    const key=`${plan.id}:${plan.external_price_id}`;
    let cached=priceAvailability.get(key);
    if(!cached || cached.until<Date.now()) {
      cached={until:Date.now()+30000,value:provider.validatePrice({...snapshot(plan),priceId:plan.external_price_id}).then(()=>true,()=>false)};
      priceAvailability.set(key,cached);
    }
    return cached.value;
  }
  async function entitlements(customerId,db=pool) {
    const rows=(await db.query(`SELECT l.*,p.tier,p.name,p.limits,p.product_kind FROM customer_licenses l JOIN customers c ON c.id=l.customer_id JOIN customer_plans p ON p.id=l.plan_id
      WHERE l.customer_id=$1 AND c.status='active' AND l.status='active' AND l.revoked_at IS NULL AND l.manual_revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now())`,[customerId])).rows;
    const priority=row=>row.purchase_id && row.product_kind==='one_time' && row.tier==='pro'?4:['free','family','plus','pro'].indexOf(row.tier);
    rows.sort((a,b)=>priority(b)-priority(a) || new Date(b.activated_at)-new Date(a.activated_at) || a.id.localeCompare(b.id));
    const licenses=rows.map(row=>({id:row.id,subscriptionId:row.subscription_id,purchaseId:row.purchase_id,productId:row.product_id,productKind:row.product_kind,tier:row.tier,plan:row.name,expiresAt:row.expires_at,limits:row.limits}));
    return {active:rows.length>0,hasActiveSubscription:rows.some(row=>Boolean(row.subscription_id)),hasLifetime:rows.some(row=>row.purchase_id && row.product_kind==='one_time'),effectiveLicense:licenses[0] || null,effectiveTier:rows[0]?.tier || null,features:rows[0]?.features || [],limits:rows[0]?.limits || {},licenses};
  }
  async function notify(db,customerId,kind,key,plan,payment={},periodEnd=null) {
    if(!mailer) return;
    const customer=(await db.query("SELECT email FROM customers WHERE id=$1 AND status='active'",[customerId])).rows[0];
    if(customer) await mailer.enqueue(db,billingMessage({email:customer.email,kind,plan,amount:kind==='refund'?payment.refunded:payment.amount,currency:payment.currency || plan.currency,periodEnd,origin:config.origin}),`${provider.name}:${key}:${kind}`);
  }
  async function processEvent(event) {
    const name=provider.name;
    await pool.query(`INSERT INTO customer_payment_events(provider,external_event_id,event_type,status) VALUES($1,$2,$3,'received') ON CONFLICT DO NOTHING`,[name,event.id,event.type]);
    try {
      return await transaction(pool,async db=> {
        const stored=(await db.query('SELECT * FROM customer_payment_events WHERE provider=$1 AND external_event_id=$2 FOR UPDATE',[name,event.id])).rows[0];
        if (['processed','ignored'].includes(stored.status)) return {duplicate:true};
        const customerRef=provider.customerReference(event);
        const binding=(await db.query('SELECT * FROM customer_provider_accounts WHERE provider=$1 AND external_customer_id=$2',[name,customerRef || ''])).rows[0];
        if (!binding) {
          await db.query("UPDATE customer_payment_events SET status='ignored',processed_at=now(),attempts=attempts+1 WHERE provider=$1 AND external_event_id=$2",[name,event.id]);
          return {ignored:true};
        }
        // Serialize all updates for this customer before fetching current provider state.
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[binding.customer_id]);
        const state=await provider.resolve(event);
        if (state?.checkout) {
          const check=state.checkout;
          const intent=(await db.query('SELECT * FROM customer_checkouts WHERE external_session_id=$1 AND customer_id=$2',[check.id,binding.customer_id])).rows[0];
          if (!intent || check.intentId!==intent.id || check.customerRef!==customerRef) throw new Error('Checkout association mismatch');
          const paymentStatus=check.status==='expired'?'cancelled':'pending';
          await db.query('UPDATE customer_checkouts SET status=$1,payment_status=CASE WHEN confirmed_at IS NULL THEN $2 ELSE payment_status END,external_subscription_id=$3 WHERE id=$4',[check.status==='complete'?'complete':check.status==='expired'?'expired':'pending',paymentStatus,check.subscriptionRef || null,intent.id]);
        }
        const sub=state?.subscription;
        let subscription;
        if (sub) {
          if (sub.customerRef!==customerRef) throw new Error('Subscription association mismatch');
          const plan=(await db.query('SELECT p.* FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE m.provider=$1 AND m.external_price_id=$2 AND m.mode=\'test\' AND p.draft=false',[name,sub.priceRef])).rows[0];
          if (!plan || plan.product_kind!=='subscription' || Number(plan.amount)<=0) throw new Error('Subscription Price is not an approved configured plan');
          const prior=(await db.query('SELECT customer_id FROM customer_subscriptions WHERE provider=$1 AND external_subscription_id=$2',[name,sub.id])).rows[0];
          if (prior && prior.customer_id!==binding.customer_id) throw new Error('Subscription ownership mismatch');
          subscription=(await db.query(`INSERT INTO customer_subscriptions(id,customer_id,plan_id,provider,external_subscription_id,status,period_start,period_end,trial_end,cancel_at_period_end,cancel_at,canceled_at,plan_snapshot)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,external_subscription_id) DO UPDATE SET
            plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,trial_end=EXCLUDED.trial_end,
            cancel_at_period_end=EXCLUDED.cancel_at_period_end,cancel_at=EXCLUDED.cancel_at,canceled_at=EXCLUDED.canceled_at,plan_snapshot=EXCLUDED.plan_snapshot,updated_at=now() RETURNING *`,
          [crypto.randomUUID(),binding.customer_id,plan.id,name,sub.id,sub.status,sub.periodStart,sub.periodEnd,sub.trialEnd,Boolean(sub.cancelAtPeriodEnd),sub.cancelAt,sub.canceledAt,JSON.stringify(snapshot(plan))])).rows[0];
          // No grace/trial policy is invented: grant only currently active, provider-confirmed paid periods.
          const priorLicense=(await db.query('SELECT manual_revoked_at FROM customer_licenses WHERE subscription_id=$1',[subscription.id])).rows[0];
          const active=!priorLicense?.manual_revoked_at && ['active','canceled'].includes(sub.status) && sub.paid && sub.periodEnd && new Date(sub.periodEnd)>new Date();
          await db.query(`INSERT INTO customer_licenses(id,customer_id,plan_id,subscription_id,features,expires_at,status,revoked_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(subscription_id) DO UPDATE SET
            plan_id=EXCLUDED.plan_id,features=EXCLUDED.features,expires_at=EXCLUDED.expires_at,status=EXCLUDED.status,revoked_at=EXCLUDED.revoked_at
            WHERE customer_licenses.manual_revoked_at IS NULL`,
          [crypto.randomUUID(),binding.customer_id,plan.id,subscription.id,JSON.stringify(plan.features),sub.periodEnd,active?'active':'revoked',active?null:new Date()]);
          if(active) await db.query('DELETE FROM customer_licenses WHERE customer_id=$1 AND subscription_id IS NULL AND purchase_id IS NULL',[binding.customer_id]);
          await db.query("UPDATE customer_checkouts SET payment_status=$1,confirmed_at=CASE WHEN $2 THEN COALESCE(confirmed_at,now()) ELSE confirmed_at END WHERE customer_id=$3 AND external_subscription_id=$4 AND (confirmed_at IS NULL OR $2)",[active?'paid':sub.status==='past_due'?'failed':'pending',Boolean(active),binding.customer_id,sub.id]);
          if(sub.cancelAtPeriodEnd || sub.status==='canceled') await notify(db,binding.customer_id,'cancellation',`${sub.id}:${sub.cancelAt?new Date(sub.cancelAt).toISOString():sub.periodEnd?new Date(sub.periodEnd).toISOString():'ended'}`,snapshot(plan),{},active?sub.periodEnd:null);
        }
        for (const payment of state?.invoices || []) {
          if (payment.customerRef!==customerRef) throw new Error('Payment ownership mismatch');
          const priorPayment=(await db.query('SELECT * FROM customer_transactions WHERE provider=$1 AND external_payment_id=$2',[name,payment.id])).rows[0];
          if (priorPayment && priorPayment.customer_id!==binding.customer_id) throw new Error('Existing payment ownership mismatch');
          const plan=(await db.query('SELECT p.* FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE m.provider=$1 AND m.external_price_id=$2',[name,payment.priceRef || sub?.priceRef || ''])).rows[0];
          if (!plan) throw new Error('Invoice plan mapping is unavailable');
          await db.query(`INSERT INTO customer_transactions(id,customer_id,subscription_id,plan_id,provider,external_payment_id,amount,currency,status,refunded_amount,paid_at,receipt_url,plan_snapshot)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,external_payment_id) DO UPDATE SET
            amount=CASE WHEN customer_transactions.paid_at IS NULL THEN EXCLUDED.amount ELSE customer_transactions.amount END,
            status=CASE WHEN customer_transactions.status='failed' AND EXCLUDED.status='open' THEN 'failed' ELSE EXCLUDED.status END,
            refunded_amount=EXCLUDED.refunded_amount,paid_at=COALESCE(customer_transactions.paid_at,EXCLUDED.paid_at),receipt_url=EXCLUDED.receipt_url,updated_at=now()`,
          [crypto.randomUUID(),binding.customer_id,subscription?.id || null,plan.id,name,payment.id,payment.amount,payment.currency,payment.status,payment.refunded,payment.paidAt,payment.receiptUrl,JSON.stringify(snapshot(plan))]);
          const historicalPlan=priorPayment?.plan_snapshot || snapshot(plan);
          if(payment.paid && !payment.fullyRefunded && !['paid','partially_refunded','refunded'].includes(priorPayment?.status)) {
            const other=(await db.query("SELECT id FROM customer_transactions WHERE customer_id=$1 AND subscription_id=$2 AND external_payment_id<>$3 AND paid_at IS NOT NULL LIMIT 1",[binding.customer_id,subscription?.id || null,payment.id])).rows.length;
            await notify(db,binding.customer_id,other?'renewal':'activation',payment.id,historicalPlan,payment);
          }
          if(payment.status==='failed') await notify(db,binding.customer_id,'failure',payment.id,historicalPlan,payment);
          if(payment.refunded>Number(priorPayment?.refunded_amount || 0)) await notify(db,binding.customer_id,'refund',`${payment.id}:${payment.refunded}`,historicalPlan,payment);
        }
        for(const payment of state?.purchases || []) {
          if(payment.customerRef!==customerRef || !Number.isSafeInteger(payment.amount) || payment.amount<=0 || payment.refunded<0 || payment.refunded>payment.amount) throw new Error('Purchase payment mismatch');
          const intent=(await db.query('SELECT * FROM customer_checkouts WHERE external_session_id=$1 AND customer_id=$2',[payment.checkoutRef,binding.customer_id])).rows[0];
          const plan=(await db.query("SELECT p.* FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE m.provider=$1 AND m.external_price_id=$2 AND m.mode='test' AND p.draft=false",[name,payment.priceRef])).rows[0];
          if(!intent || !plan || plan.product_kind!=='one_time' || plan.tier!=='pro' || intent.plan_id!==plan.id || payment.amount!==Number(intent.plan_snapshot.amount) || payment.currency!==intent.plan_snapshot.currency) throw new Error('Purchase catalog mismatch');
          const prior=(await db.query('SELECT * FROM customer_transactions WHERE provider=$1 AND external_payment_id=$2',[name,payment.id])).rows[0];
          if(prior && (prior.customer_id!==binding.customer_id || prior.checkout_id!==intent.id)) throw new Error('Purchase ownership mismatch');
          await db.query('UPDATE customer_checkouts SET external_payment_id=$1,payment_status=$2,confirmed_at=CASE WHEN $3 THEN COALESCE(confirmed_at,now()) ELSE confirmed_at END WHERE id=$4',[payment.id,payment.status,payment.paid,intent.id]);
          const purchase=(await db.query(`INSERT INTO customer_transactions(id,customer_id,plan_id,provider,external_payment_id,amount,currency,status,refunded_amount,paid_at,receipt_url,plan_snapshot,checkout_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,external_payment_id) DO UPDATE SET
            status=EXCLUDED.status,refunded_amount=EXCLUDED.refunded_amount,paid_at=COALESCE(customer_transactions.paid_at,EXCLUDED.paid_at),receipt_url=EXCLUDED.receipt_url,updated_at=now() RETURNING *`,
          [crypto.randomUUID(),binding.customer_id,plan.id,name,payment.id,payment.amount,payment.currency,payment.status,payment.refunded,payment.paidAt,payment.receiptUrl,JSON.stringify(intent.plan_snapshot),intent.id])).rows[0];
          const priorLicense=(await db.query('SELECT manual_revoked_at FROM customer_licenses WHERE purchase_id=$1',[purchase.id])).rows[0];
          const active=payment.paid && !payment.fullyRefunded && !priorLicense?.manual_revoked_at;
          if(payment.paid) await db.query(`INSERT INTO customer_licenses(id,customer_id,plan_id,purchase_id,features,status,revoked_at)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(purchase_id) DO UPDATE SET status=EXCLUDED.status,revoked_at=EXCLUDED.revoked_at
            WHERE customer_licenses.manual_revoked_at IS NULL`,[crypto.randomUUID(),binding.customer_id,plan.id,purchase.id,JSON.stringify(intent.plan_snapshot.features),active?'active':'revoked',active?null:new Date()]);
          if(active) {
            await db.query('DELETE FROM customer_licenses WHERE customer_id=$1 AND subscription_id IS NULL AND purchase_id IS NULL',[binding.customer_id]);
            await notify(db,binding.customer_id,'lifetime',payment.id,intent.plan_snapshot,payment);
          }
          if(payment.status==='failed') await notify(db,binding.customer_id,'failure',payment.id,intent.plan_snapshot,payment);
          if(payment.refunded>Number(prior?.refunded_amount || 0)) await notify(db,binding.customer_id,'refund',`${payment.id}:${payment.refunded}`,intent.plan_snapshot,payment);
        }
        await db.query("UPDATE customer_payment_events SET status=$3,attempts=attempts+1,last_error=NULL,processed_at=now() WHERE provider=$1 AND external_event_id=$2",[name,event.id,state?'processed':'ignored']);
        return {ok:true};
      });
    } catch (error) {
      await pool.query("UPDATE customer_payment_events SET status='failed',attempts=attempts+1,last_error='Provider reconciliation failed' WHERE provider=$1 AND external_event_id=$2 AND status NOT IN ('processed','ignored')",[name,event.id]);
      throw error;
    }
  }
  function register(router) {
    router.get('/plans',async(req,res)=> {
      const plans=(await pool.query(`SELECT DISTINCT ON (p.tier,p.billing_interval,p.product_kind) p.*,m.external_price_id FROM customer_plans p
        LEFT JOIN customer_provider_prices m ON m.plan_id=p.id AND m.provider='stripe' AND m.mode='test'
        ORDER BY p.tier,p.billing_interval,p.product_kind,p.version DESC`)).rows;
      const catalog=await Promise.all(plans.map(async plan=>({...snapshot(plan),active:plan.active,draft:plan.draft,available:await available(plan)})));
      res.json({mode:'test',billingAvailable:Boolean(provider),plans:catalog});
    });
    router.get('/entitlements',async(req,res)=>res.json(await entitlements(auth.requireCustomer(req).id)));
    router.get('/dashboard',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const subscriptions=(await pool.query('SELECT id,status,period_start,period_end,trial_end,cancel_at_period_end,cancel_at,canceled_at,plan_snapshot FROM customer_subscriptions WHERE customer_id=$1 ORDER BY updated_at DESC',[customer.id])).rows;
      const lifetimes=(await pool.query(`SELECT l.id,l.status,l.activated_at,l.revoked_at,l.manual_revoked_at,p.name FROM customer_licenses l JOIN customer_plans p ON p.id=l.plan_id
        WHERE l.customer_id=$1 AND l.purchase_id IS NOT NULL AND p.product_kind='one_time' ORDER BY l.activated_at DESC`,[customer.id])).rows;
      const billingAccount=(await pool.query('SELECT 1 FROM customer_provider_accounts WHERE customer_id=$1',[customer.id])).rows.length>0;
      res.json({subscriptions,lifetimes,billingAccount,entitlements:await entitlements(customer.id)});
    });
    router.get('/purchases',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
      const rows=(await pool.query('SELECT id,amount,currency,status,refunded_amount,paid_at,created_at,receipt_url,plan_snapshot FROM customer_transactions WHERE customer_id=$1 ORDER BY COALESCE(paid_at,created_at) DESC,id DESC LIMIT 50 OFFSET $2',[customer.id,Math.trunc(offset)])).rows;
      res.json({transactions:rows,nextOffset:rows.length===50?offset+50:null});
    });
    router.post('/select-free',async(req,res)=> {
      const customer=auth.requireVerified(req);
      await transaction(pool,async db=> {
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[customer.id]);
        const plan=(await db.query("SELECT * FROM customer_plans WHERE id=$1 AND active=true AND draft=false AND amount=0 AND tier='free'",[req.body.planId])).rows[0];
        if (!plan) throw failure(400,'Configured free plan not found.');
        const access=await entitlements(customer.id,db);
        if(access.effectiveTier && access.effectiveTier!=='free') throw failure(409,'Your paid plan already includes Free features. Manage recurring billing to change plans.');
        await db.query('DELETE FROM customer_licenses WHERE customer_id=$1 AND subscription_id IS NULL AND purchase_id IS NULL',[customer.id]);
        await db.query("INSERT INTO customer_licenses(id,customer_id,plan_id,features,status) VALUES($1,$2,$3,$4,'active')",[crypto.randomUUID(),customer.id,plan.id,JSON.stringify(plan.features)]);
      });res.json({ok:true});
    });
    router.post('/checkout',async(req,res)=> {
      const customer=auth.requireVerified(req);
      if (!provider) throw failure(503,'Stripe test checkout is not configured.');
      if (!uuid(req.body.requestId)) throw failure(400,'A new UUID requestId is required.');
      // Commit the customer mapping and intent before asking the provider to create
      // a session. A lost response or failed second commit remains safely retryable.
      const intentId=await transaction(pool,async db=> {
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[customer.id]);
        const access=await entitlements(customer.id,db);
        if(access.hasLifetime) throw failure(409,'You already own Pro Lifetime. Manage any separate subscription through billing management.');
        const old=(await db.query('SELECT * FROM customer_checkouts WHERE id=$1',[req.body.requestId])).rows[0];
        if (old && (old.customer_id!==customer.id || old.plan_id!==req.body.planId)) throw failure(409,'Checkout request conflicts with an existing request.');
        if (old?.external_session_id) {
          const check=await provider.checkoutStatus(old.external_session_id);
          if (check.status!=='open') throw failure(409,'Checkout is no longer open. Refresh your dashboard.');
          return old.id;
        }
        const plan=(await db.query("SELECT p.*,m.external_price_id FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE p.id=$1 AND p.active=true AND p.draft=false AND p.amount>0 AND m.provider=$2 AND m.mode='test'",[req.body.planId,provider.name])).rows[0];
        if (!plan) throw failure(400,'Configured test plan not found.');
        await provider.validatePrice({...snapshot(plan),priceId:plan.external_price_id});
        let binding=(await db.query('SELECT * FROM customer_provider_accounts WHERE customer_id=$1 AND provider=$2',[customer.id,provider.name])).rows[0];
        if (!binding) {
          const external=await provider.createCustomer(customer);
          binding=(await db.query('INSERT INTO customer_provider_accounts(customer_id,provider,external_customer_id) VALUES($1,$2,$3) RETURNING *',[customer.id,provider.name,external])).rows[0];
        }
        // Reuse an open checkout instead of issuing concurrent subscriptions.
        const pending=(await db.query("SELECT c.* FROM customer_checkouts c JOIN customer_plans p ON p.id=c.plan_id WHERE c.customer_id=$1 AND c.provider=$2 AND (c.status='pending' OR (c.status='complete' AND c.payment_status='pending')) AND p.product_kind=$3 ORDER BY c.created_at DESC LIMIT 1",[customer.id,provider.name,plan.product_kind])).rows[0];
        if (pending?.external_session_id) {
          const check=await provider.checkoutStatus(pending.external_session_id);
          if (check.status==='open') {
            if (pending.plan_id!==plan.id) throw failure(409,'Finish or let the existing checkout expire before choosing another plan.');
            return pending.id;
          }
          if (check.status==='complete') throw failure(409,'Your payment confirmation is pending. Refresh the dashboard.');
          await db.query("UPDATE customer_checkouts SET status='expired' WHERE id=$1",[pending.id]);
        }
        if (pending && !pending.external_session_id) {
          if (pending.plan_id!==plan.id) throw failure(409,'Retry the pending plan before choosing another plan.');
          return pending.id;
        }
        if (!old) await db.query('INSERT INTO customer_checkouts(id,customer_id,plan_id,provider,plan_snapshot) VALUES($1,$2,$3,$4,$5)',[req.body.requestId,customer.id,plan.id,provider.name,JSON.stringify(snapshot(plan))]);
        return req.body.requestId;
      });
      const result=await transaction(pool,async db=> {
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[customer.id]);
        const intent=(await db.query('SELECT * FROM customer_checkouts WHERE id=$1 AND customer_id=$2 FOR UPDATE',[intentId,customer.id])).rows[0];
        if (intent.external_session_id) {
          const check=await provider.checkoutStatus(intent.external_session_id);
          if (check.status!=='open') throw failure(409,'Checkout is no longer open. Refresh your dashboard.');
          return {url:intent.checkout_url};
        }
        // Stripe retains idempotency keys for at least 24 hours. Never recreate an
        // ambiguous old intent once that guarantee can have expired.
        if (Date.now()-new Date(intent.created_at).getTime()>23*3600000) throw failure(409,'This checkout needs billing support reconciliation before retrying.');
        const binding=(await db.query('SELECT * FROM customer_provider_accounts WHERE customer_id=$1 AND provider=$2',[customer.id,provider.name])).rows[0];
        const plan=(await db.query("SELECT p.*,m.external_price_id FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE p.id=$1 AND p.active=true AND p.draft=false AND m.provider=$2 AND m.mode='test'",[intent.plan_id,provider.name])).rows[0];
        if (!plan) throw failure(409,'This plan is no longer available for checkout.');
        if(plan.product_kind==='subscription' && await provider.hasSubscription(binding.external_customer_id)) throw failure(409,'Use Manage billing to change your existing subscription.');
        if((await entitlements(customer.id,db)).hasLifetime) throw failure(409,'You already own Pro Lifetime.');
        await provider.validatePrice({...snapshot(plan),priceId:plan.external_price_id});
        const session=await provider.checkout({customerRef:binding.external_customer_id,priceRef:plan.external_price_id,intentId,origin:config.origin,productKind:plan.product_kind});
        await db.query('UPDATE customer_checkouts SET external_session_id=$1,checkout_url=$2 WHERE id=$3',[session.id,session.url,intentId]);
        return {url:session.url};
      });res.json(result);
    });
    router.get('/checkout-status',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const id=text(req.query.session_id,1,200,'checkout session');
      const row=(await pool.query('SELECT status,payment_status,confirmed_at,plan_snapshot FROM customer_checkouts WHERE customer_id=$1 AND external_session_id=$2',[customer.id,id])).rows[0];
      if (!row) throw failure(404,'Checkout not found.');
      res.json({status:row.status,paymentStatus:row.payment_status,confirmed:Boolean(row.confirmed_at),plan:row.plan_snapshot,entitlements:await entitlements(customer.id)});
    });
    router.post('/portal',async(req,res)=> {
      const customer=auth.requireVerified(req);
      if (!provider) throw failure(503,'Billing is not configured.');
      const binding=(await pool.query('SELECT * FROM customer_provider_accounts WHERE customer_id=$1 AND provider=$2',[customer.id,provider.name])).rows[0];
      if (!binding) throw failure(404,'No billing account exists yet.');
      const prices=(await pool.query("SELECT m.external_price_id FROM customer_provider_prices m JOIN customer_plans p ON p.id=m.plan_id WHERE m.provider=$1 AND m.mode='test' AND p.draft=false AND p.active=true AND p.product_kind='subscription' AND p.amount>0",[provider.name])).rows.map(row=>row.external_price_id);
      res.json({url:await provider.portal(binding.external_customer_id,config.origin,prices)});
    });
  }
  return {register,processEvent,entitlements};
}
module.exports={createBilling};
