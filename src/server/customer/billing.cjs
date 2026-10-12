const crypto=require('node:crypto');
const {transaction}=require('./database.cjs');
const {failure,text}=require('./security.cjs');
const {snapshot}=require('./catalog.cjs');
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

function createBilling({pool,provider,config,auth}) {
  async function entitlements(customerId) {
    const rows=(await pool.query(`SELECT l.*,p.tier,p.name,p.limits FROM customer_licenses l JOIN customers c ON c.id=l.customer_id JOIN customer_plans p ON p.id=l.plan_id
      WHERE l.customer_id=$1 AND c.status='active' AND l.status='active' AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now())`,[customerId])).rows;
    return {active:rows.length>0,hasActiveSubscription:rows.some(row=>Boolean(row.subscription_id)),features:[...new Set(rows.flatMap(row=>row.features))],licenses:rows.map(row=>({id:row.id,subscriptionId:row.subscription_id,productId:row.product_id,tier:row.tier,plan:row.name,expiresAt:row.expires_at,limits:row.limits}))};
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
          await db.query('UPDATE customer_checkouts SET status=$1 WHERE id=$2',[check.status==='complete'?'complete':check.status==='expired'?'expired':'pending',intent.id]);
        }
        const sub=state?.subscription;
        let subscription;
        if (sub) {
          if (sub.customerRef!==customerRef) throw new Error('Subscription association mismatch');
          const plan=(await db.query('SELECT p.* FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE m.provider=$1 AND m.external_price_id=$2 AND m.mode=\'test\' AND p.draft=false',[name,sub.priceRef])).rows[0];
          if (!plan) throw new Error('Subscription Price is not an approved configured plan');
          const prior=(await db.query('SELECT customer_id FROM customer_subscriptions WHERE provider=$1 AND external_subscription_id=$2',[name,sub.id])).rows[0];
          if (prior && prior.customer_id!==binding.customer_id) throw new Error('Subscription ownership mismatch');
          subscription=(await db.query(`INSERT INTO customer_subscriptions(id,customer_id,plan_id,provider,external_subscription_id,status,period_start,period_end,trial_end,cancel_at_period_end,cancel_at,canceled_at,plan_snapshot)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,external_subscription_id) DO UPDATE SET
            plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,trial_end=EXCLUDED.trial_end,
            cancel_at_period_end=EXCLUDED.cancel_at_period_end,cancel_at=EXCLUDED.cancel_at,canceled_at=EXCLUDED.canceled_at,plan_snapshot=EXCLUDED.plan_snapshot,updated_at=now() RETURNING *`,
          [crypto.randomUUID(),binding.customer_id,plan.id,name,sub.id,sub.status,sub.periodStart,sub.periodEnd,sub.trialEnd,Boolean(sub.cancelAtPeriodEnd),sub.cancelAt,sub.canceledAt,JSON.stringify(snapshot(plan))])).rows[0];
          // No grace/trial policy is invented: grant only currently active, provider-confirmed paid periods.
          const active=sub.status==='active' && sub.paid && sub.periodEnd && new Date(sub.periodEnd)>new Date();
          await db.query(`INSERT INTO customer_licenses(id,customer_id,plan_id,subscription_id,features,expires_at,status,revoked_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(subscription_id) DO UPDATE SET
            plan_id=EXCLUDED.plan_id,features=EXCLUDED.features,expires_at=EXCLUDED.expires_at,status=EXCLUDED.status,revoked_at=EXCLUDED.revoked_at`,
          [crypto.randomUUID(),binding.customer_id,plan.id,subscription.id,JSON.stringify(plan.features),sub.periodEnd,active?'active':'revoked',active?null:new Date()]);
        }
        for (const payment of state?.invoices || []) {
          if (payment.customerRef!==customerRef) throw new Error('Payment ownership mismatch');
          const priorPayment=(await db.query('SELECT customer_id FROM customer_transactions WHERE provider=$1 AND external_payment_id=$2',[name,payment.id])).rows[0];
          if (priorPayment && priorPayment.customer_id!==binding.customer_id) throw new Error('Existing payment ownership mismatch');
          const plan=(await db.query('SELECT p.* FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE m.provider=$1 AND m.external_price_id=$2',[name,payment.priceRef || sub?.priceRef || ''])).rows[0];
          if (!plan) throw new Error('Invoice plan mapping is unavailable');
          await db.query(`INSERT INTO customer_transactions(id,customer_id,subscription_id,plan_id,provider,external_payment_id,amount,currency,status,refunded_amount,paid_at,receipt_url,plan_snapshot)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(provider,external_payment_id) DO UPDATE SET
            amount=EXCLUDED.amount,status=EXCLUDED.status,refunded_amount=EXCLUDED.refunded_amount,paid_at=EXCLUDED.paid_at,receipt_url=EXCLUDED.receipt_url,updated_at=now()`,
          [crypto.randomUUID(),binding.customer_id,subscription?.id || null,plan.id,name,payment.id,payment.amount,payment.currency,payment.status,payment.refunded,payment.paidAt,payment.receiptUrl,JSON.stringify(snapshot(plan))]);
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
      const plans=(await pool.query('SELECT * FROM customer_plans ORDER BY tier,billing_interval,version DESC')).rows;
      res.json({mode:'test',billingAvailable:Boolean(provider),plans:plans.map(plan=>({...snapshot(plan),active:plan.active,draft:plan.draft}))});
    });
    router.get('/entitlements',async(req,res)=>res.json(await entitlements(auth.requireCustomer(req).id)));
    router.get('/dashboard',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const subscriptions=(await pool.query('SELECT id,status,period_start,period_end,trial_end,cancel_at_period_end,cancel_at,canceled_at,plan_snapshot FROM customer_subscriptions WHERE customer_id=$1 ORDER BY updated_at DESC',[customer.id])).rows;
      res.json({subscriptions,entitlements:await entitlements(customer.id)});
    });
    router.get('/purchases',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const offset=Math.max(0,Math.min(100000,Number(req.query.offset)||0));
      const rows=(await pool.query('SELECT id,amount,currency,status,refunded_amount,paid_at,receipt_url,plan_snapshot FROM customer_transactions WHERE customer_id=$1 ORDER BY updated_at DESC LIMIT 50 OFFSET $2',[customer.id,Math.trunc(offset)])).rows;
      res.json({transactions:rows,nextOffset:rows.length===50?offset+50:null});
    });
    router.post('/select-free',async(req,res)=> {
      const customer=auth.requireVerified(req);
      await transaction(pool,async db=> {
        await db.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE',[customer.id]);
        const plan=(await db.query("SELECT * FROM customer_plans WHERE id=$1 AND active=true AND draft=false AND amount=0 AND tier='free'",[req.body.planId])).rows[0];
        if (!plan) throw failure(400,'Configured free plan not found.');
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
        const old=(await db.query('SELECT * FROM customer_checkouts WHERE id=$1',[req.body.requestId])).rows[0];
        if (old && (old.customer_id!==customer.id || old.plan_id!==req.body.planId)) throw failure(409,'Checkout request conflicts with an existing request.');
        if (old?.external_session_id) {
          const check=await provider.checkoutStatus(old.external_session_id);
          if (check.status!=='open') throw failure(409,'Checkout is no longer open. Refresh your dashboard.');
          return old.id;
        }
        const plan=(await db.query("SELECT p.*,m.external_price_id FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE p.id=$1 AND p.active=true AND p.draft=false AND p.amount>0 AND p.product_kind='subscription' AND m.provider=$2 AND m.mode='test'",[req.body.planId,provider.name])).rows[0];
        if (!plan) throw failure(400,'Configured test subscription plan not found.');
        await provider.validatePrice({...snapshot(plan),priceId:plan.external_price_id});
        let binding=(await db.query('SELECT * FROM customer_provider_accounts WHERE customer_id=$1 AND provider=$2',[customer.id,provider.name])).rows[0];
        if (!binding) {
          const external=await provider.createCustomer(customer);
          binding=(await db.query('INSERT INTO customer_provider_accounts(customer_id,provider,external_customer_id) VALUES($1,$2,$3) RETURNING *',[customer.id,provider.name,external])).rows[0];
        }
        // Reuse an open checkout instead of issuing concurrent subscriptions.
        const pending=(await db.query("SELECT * FROM customer_checkouts WHERE customer_id=$1 AND provider=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1",[customer.id,provider.name])).rows[0];
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
        if (await provider.hasSubscription(binding.external_customer_id)) throw failure(409,'Use Manage billing to change your existing subscription.');
        const plan=(await db.query("SELECT p.*,m.external_price_id FROM customer_plans p JOIN customer_provider_prices m ON m.plan_id=p.id WHERE p.id=$1 AND p.active=true AND p.draft=false AND m.provider=$2 AND m.mode='test'",[intent.plan_id,provider.name])).rows[0];
        if (!plan) throw failure(409,'This plan is no longer available for checkout.');
        await provider.validatePrice({...snapshot(plan),priceId:plan.external_price_id});
        const session=await provider.checkout({customerRef:binding.external_customer_id,priceRef:plan.external_price_id,intentId,origin:config.origin});
        await db.query('UPDATE customer_checkouts SET external_session_id=$1,checkout_url=$2 WHERE id=$3',[session.id,session.url,intentId]);
        return {url:session.url};
      });res.json(result);
    });
    router.get('/checkout-status',async(req,res)=> {
      const customer=auth.requireCustomer(req);
      const id=text(req.query.session_id,1,200,'checkout session');
      const row=(await pool.query('SELECT status FROM customer_checkouts WHERE customer_id=$1 AND external_session_id=$2',[customer.id,id])).rows[0];
      if (!row) throw failure(404,'Checkout not found.');
      res.json({status:row.status,entitlements:await entitlements(customer.id)});
    });
    router.post('/portal',async(req,res)=> {
      const customer=auth.requireVerified(req);
      if (!provider) throw failure(503,'Billing is not configured.');
      const binding=(await pool.query('SELECT * FROM customer_provider_accounts WHERE customer_id=$1 AND provider=$2',[customer.id,provider.name])).rows[0];
      if (!binding) throw failure(404,'No billing account exists yet.');
      res.json({url:await provider.portal(binding.external_customer_id,config.origin)});
    });
  }
  return {register,processEvent,entitlements};
}
module.exports={createBilling};
