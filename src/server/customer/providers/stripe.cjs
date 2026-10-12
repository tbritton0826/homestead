const { failure } = require('../security.cjs');
const ref = object => typeof object === 'string' ? object : object?.id;
const date = value => value ? new Date(value * 1000) : null;
const subscriptionRef = invoice => ref(invoice?.parent?.subscription_details?.subscription);
function testOnly(object) {
  if (!object || object.livemode !== false) throw failure(400,'Only Stripe test-mode objects are accepted.');
  return object;
}
function createStripeProvider(env, injected) {
  if (env.HOMESTEAD_PAYMENT_MODE && env.HOMESTEAD_PAYMENT_MODE !== 'test') throw new Error('Live billing is disabled in this release');
  if (!/^sk_test_/.test(env.STRIPE_SECRET_KEY || '')) throw new Error('A Stripe test secret key is required');
  const stripe = injected || new (require('stripe'))(env.STRIPE_SECRET_KEY,{ maxNetworkRetries:2,timeout:15000 });
  async function purchase(session,failed=false) {
    if(session.mode!=='payment') throw new Error('One-time Checkout mode mismatch');
    const lines=await stripe.checkout.sessions.listLineItems(session.id,{limit:2});
    if(lines.has_more || lines.data.length!==1 || lines.data[0].quantity!==1) throw new Error('Only single-product purchases are supported');
    if(!session.payment_intent) return null;
    const intent=testOnly(await stripe.paymentIntents.retrieve(ref(session.payment_intent)));
    if(ref(intent.customer)!==ref(session.customer) || intent.metadata?.homesteadCheckoutId!==session.client_reference_id || intent.amount!==session.amount_total || intent.currency!==session.currency) throw new Error('Purchase payment association mismatch');
    const charge=intent.latest_charge?testOnly(await stripe.charges.retrieve(ref(intent.latest_charge))):null;
    if(charge && (ref(charge.customer)!==ref(session.customer) || ref(charge.payment_intent)!==intent.id || charge.amount!==intent.amount || charge.currency!==intent.currency)) throw new Error('Purchase charge association mismatch');
    const paid=session.status==='complete' && session.payment_status==='paid' && intent.status==='succeeded' && intent.amount_received===intent.amount && charge?.paid===true;
    const refunded=Number(charge?.amount_refunded || 0);
    return {id:intent.id,checkoutRef:session.id,customerRef:ref(session.customer),priceRef:ref(lines.data[0].price),amount:intent.amount,currency:intent.currency,
      paid,refunded,fullyRefunded:refunded>0 && refunded>=intent.amount,paidAt:paid?date(charge.created):null,receiptUrl:charge?.receipt_url || null,
      status:paid?(refunded>=intent.amount?'refunded':refunded>0?'partially_refunded':'paid'):intent.status==='canceled' || (failed && intent.status==='requires_payment_method')?'failed':'pending'};
  }
  async function invoice(id, failed = false) {
    const value = testOnly(await stripe.invoices.retrieve(id));
    let refunded=0;
    const payments=await stripe.invoicePayments.list({invoice:id,limit:100});
    if (payments.has_more) throw new Error('Invoice payment pagination requires reconciliation');
    for (const entry of payments.data) {
      let charge=ref(entry.payment?.charge);
      if (!charge && entry.payment?.payment_intent) {
        const intent=testOnly(await stripe.paymentIntents.retrieve(ref(entry.payment.payment_intent)));
        charge=ref(intent.latest_charge);
      }
      if (charge) refunded+=Number(testOnly(await stripe.charges.retrieve(charge)).amount_refunded || 0);
    }
    return { id:value.id,customerRef:ref(value.customer),subscriptionRef:subscriptionRef(value),amount:Number(value.amount_paid || value.amount_due || 0),
      currency:value.currency,status:value.status==='paid'?(refunded>=value.amount_paid && refunded>0?'refunded':refunded>0?'partially_refunded':'paid'):failed?'failed':value.status,
      refunded,paidAt:date(value.status_transitions?.paid_at),receiptUrl:value.hosted_invoice_url,
      priceRef:ref(value.lines?.data?.find(line=>line.pricing?.price_details?.price)?.pricing.price_details.price),
      paid:value.status==='paid',fullyRefunded:refunded>0 && refunded>=value.amount_paid };
  }
  return {
    name:'stripe',
    verify(bytes,signature) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw failure(503,'Stripe webhook signing is not configured.');
      let event; try { event=stripe.webhooks.constructEvent(bytes,signature,env.STRIPE_WEBHOOK_SECRET); }
      catch { throw failure(400,'Invalid webhook signature.'); }
      if (event.livemode!==false || event.account) throw failure(400,'Only direct-account test events are accepted.');
      return event;
    },
    async validatePrice(plan) {
      const price=testOnly(await stripe.prices.retrieve(plan.priceId));
      const intervalValid=plan.productKind==='one_time'?price.type==='one_time' && !price.recurring:price.recurring?.interval===plan.billingInterval && price.recurring?.interval_count===1;
      if (!price.active || price.unit_amount!==plan.amount || price.currency!==plan.currency || !intervalValid)
        throw failure(409,'Configured plan does not match the Stripe test Price.');
    },
    async createCustomer(customer) {
      return testOnly(await stripe.customers.create({email:customer.email,name:customer.display_name,metadata:{homesteadCustomerId:customer.id}},{idempotencyKey:`homestead-customer-${customer.id}`})).id;
    },
    async hasSubscription(customerRef) {
      const subscriptions=await stripe.subscriptions.list({customer:customerRef,status:'all',limit:100});
      if (subscriptions.has_more) throw failure(409,'Use billing management for this account.');
      return subscriptions.data.some(sub=>!['canceled','incomplete_expired'].includes(testOnly(sub).status));
    },
    async checkout({customerRef,priceRef,intentId,origin,productKind}) {
      const session=testOnly(await stripe.checkout.sessions.create({mode:productKind==='one_time'?'payment':'subscription',customer:customerRef,client_reference_id:intentId,
        line_items:[{price:priceRef,quantity:1}],success_url:`${origin}/customer/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:`${origin}/customer/checkout/cancel`,allow_promotion_codes:false,
        metadata:{homesteadCheckoutId:intentId},...(productKind==='one_time'?{payment_intent_data:{metadata:{homesteadCheckoutId:intentId}}}:{})},{idempotencyKey:`homestead-checkout-${intentId}`}));
      return {id:session.id,url:session.url,status:session.status};
    },
    async checkoutStatus(id) {
      const session=testOnly(await stripe.checkout.sessions.retrieve(id));
      return {id:session.id,customerRef:ref(session.customer),intentId:session.client_reference_id,status:session.status,paymentStatus:session.payment_status,subscriptionRef:ref(session.subscription),mode:session.mode};
    },
    async portal(customerRef,origin,approvedPrices) {
      let configuration;
      if(env.STRIPE_PORTAL_CONFIGURATION_ID) configuration=testOnly(await stripe.billingPortal.configurations.retrieve(env.STRIPE_PORTAL_CONFIGURATION_ID));
      else {
        const configurations=await stripe.billingPortal.configurations.list({active:true,limit:100});
        if(configurations.has_more) throw failure(409,'Configure a specific test billing portal.');
        configuration=testOnly(configurations.data.find(item=>item.is_default));
      }
      if(!configuration.active) throw failure(409,'Test billing portal is inactive.');
      const update=configuration.features?.subscription_update;
      if(update?.enabled && (!update.products?.length || update.default_allowed_updates?.some(value=>value!=='price') || update.products.some(product=>product.adjustable_quantity?.enabled || !product.prices?.length || product.prices.some(price=>!approvedPrices.includes(price)))))
        throw failure(409,'Billing portal offers an unapproved plan or quantity change. Contact billing support.');
      return (await stripe.billingPortal.sessions.create({customer:customerRef,return_url:`${origin}/customer/dashboard`,configuration:configuration.id})).url;
    },
    customerReference(event) {return ref(event.data.object.customer);},
    async resolve(event) {
      const object=event.data.object;
      let subId,invoiceId,checkout,session;
      if (event.type.startsWith('customer.subscription.')) subId=object.id;
      else if (event.type.startsWith('invoice.')) invoiceId=object.id;
      else if (event.type.startsWith('checkout.session.')) {
        session=testOnly(await stripe.checkout.sessions.retrieve(object.id));checkout=await this.checkoutStatus(object.id);subId=checkout.subscriptionRef;
      } else if (event.type==='charge.refunded') {
        const charge=testOnly(await stripe.charges.retrieve(object.id));
        if (!charge.payment_intent) throw new Error('Refund could not be associated with an invoice payment');
        const payments=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:ref(charge.payment_intent)},limit:100});
        if (payments.has_more || payments.data.length>1) throw new Error('Refund invoice association is ambiguous');
        if(payments.data.length) invoiceId=ref(payments.data[0].invoice);
        else {
          const sessions=await stripe.checkout.sessions.list({payment_intent:ref(charge.payment_intent),limit:2});
          if(sessions.has_more || sessions.data.length!==1) throw new Error('Refund Checkout association is ambiguous');
          session=testOnly(await stripe.checkout.sessions.retrieve(sessions.data[0].id));checkout=await this.checkoutStatus(session.id);
        }
      } else if(event.type==='payment_intent.payment_failed' || event.type==='payment_intent.succeeded') {
        const sessions=await stripe.checkout.sessions.list({payment_intent:object.id,limit:2});
        if(sessions.has_more || sessions.data.length>1) throw new Error('Payment Checkout association is ambiguous');
        // Invoice payments are reconciled by invoice/subscription events instead.
        if(!sessions.data.length || sessions.data[0].mode!=='payment') return null;
        session=testOnly(await stripe.checkout.sessions.retrieve(sessions.data[0].id));checkout=await this.checkoutStatus(session.id);
      } else return null;
      if(session?.mode==='payment') return {checkout,purchases:[await purchase(session,event.type.endsWith('payment_failed'))].filter(Boolean)};
      const invoices=[];
      if (invoiceId) { const value=await invoice(invoiceId,event.type==='invoice.payment_failed');invoices.push(value);subId=value.subscriptionRef; }
      if (!subId) return {checkout,invoices};
      const sub=testOnly(await stripe.subscriptions.retrieve(subId));
      if (sub.items?.has_more || sub.items?.data?.length!==1 || sub.items.data[0].quantity!==1) throw new Error('Only single-plan subscriptions are supported');
      const item=sub.items.data[0];const latestId=ref(sub.latest_invoice);
      let latest=invoices.find(value=>value.id===latestId);
      if (latestId && !latest) {latest=await invoice(latestId);invoices.push(latest);}
      if(latest && (latest.customerRef!==ref(sub.customer) || latest.subscriptionRef!==sub.id)) throw new Error('Subscription funding association mismatch');
      return {checkout,invoices,subscription:{id:sub.id,customerRef:ref(sub.customer),priceRef:ref(item.price),status:sub.status,
        periodStart:date(item.current_period_start),periodEnd:date(item.current_period_end),trialEnd:date(sub.trial_end),
        cancelAtPeriodEnd:sub.cancel_at_period_end,cancelAt:date(sub.cancel_at),canceledAt:date(sub.canceled_at),
        paid: Boolean(latest?.paid && !latest.fullyRefunded) }};
    },
  };
}
module.exports={createStripeProvider};
