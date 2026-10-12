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
      if (!price.active || price.unit_amount!==plan.amount || price.currency!==plan.currency || price.recurring?.interval!==plan.billingInterval || price.recurring?.interval_count!==1)
        throw failure(409,'Configured plan does not match the Stripe test Price.');
    },
    async createCustomer(customer) {
      return testOnly(await stripe.customers.create({email:customer.email,name:customer.display_name,metadata:{homesteadCustomerId:customer.id}},{idempotencyKey:`homestead-customer-${customer.id}`})).id;
    },
    async hasSubscription(customerRef) {
      const subscriptions=await stripe.subscriptions.list({customer:customerRef,status:'all',limit:100});
      if (subscriptions.has_more) throw failure(409,'Use billing management for this account.');
      return subscriptions.data.some(sub=>!['canceled','incomplete_expired'].includes(sub.status));
    },
    async checkout({customerRef,priceRef,intentId,origin}) {
      const session=testOnly(await stripe.checkout.sessions.create({mode:'subscription',customer:customerRef,client_reference_id:intentId,
        line_items:[{price:priceRef,quantity:1}],success_url:`${origin}/customer/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:`${origin}/customer/checkout/cancel`,allow_promotion_codes:false,
        metadata:{homesteadCheckoutId:intentId}},{idempotencyKey:`homestead-checkout-${intentId}`}));
      return {id:session.id,url:session.url,status:session.status};
    },
    async checkoutStatus(id) {
      const session=testOnly(await stripe.checkout.sessions.retrieve(id));
      return {id:session.id,customerRef:ref(session.customer),intentId:session.client_reference_id,status:session.status,paymentStatus:session.payment_status,subscriptionRef:ref(session.subscription)};
    },
    async portal(customerRef,origin) {
      return (await stripe.billingPortal.sessions.create({customer:customerRef,return_url:`${origin}/customer/dashboard`})).url;
    },
    customerReference(event) {return ref(event.data.object.customer);},
    async resolve(event) {
      const object=event.data.object;
      let subId,invoiceId,checkout;
      if (event.type.startsWith('customer.subscription.')) subId=object.id;
      else if (event.type.startsWith('invoice.')) invoiceId=object.id;
      else if (event.type.startsWith('checkout.session.')) {
        checkout=await this.checkoutStatus(object.id);subId=checkout.subscriptionRef;
      } else if (event.type==='charge.refunded') {
        const charge=testOnly(await stripe.charges.retrieve(object.id));
        if (!charge.payment_intent) throw new Error('Refund could not be associated with an invoice payment');
        const payments=await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:ref(charge.payment_intent)},limit:100});
        if (payments.has_more || payments.data.length!==1) throw new Error('Refund invoice association is ambiguous');
        invoiceId=ref(payments.data[0].invoice);
      } else return null;
      const invoices=[];
      if (invoiceId) { const value=await invoice(invoiceId,event.type==='invoice.payment_failed');invoices.push(value);subId=value.subscriptionRef; }
      if (!subId) return {checkout,invoices};
      const sub=testOnly(await stripe.subscriptions.retrieve(subId));
      if (sub.items?.has_more || sub.items?.data?.length!==1 || sub.items.data[0].quantity!==1) throw new Error('Only single-plan subscriptions are supported');
      const item=sub.items.data[0];const latestId=ref(sub.latest_invoice);
      let latest=invoices.find(value=>value.id===latestId);
      if (latestId && !latest) {latest=await invoice(latestId);invoices.push(latest);}
      return {checkout,invoices,subscription:{id:sub.id,customerRef:ref(sub.customer),priceRef:ref(item.price),status:sub.status,
        periodStart:date(item.current_period_start),periodEnd:date(item.current_period_end),trialEnd:date(sub.trial_end),
        cancelAtPeriodEnd:sub.cancel_at_period_end,cancelAt:date(sub.cancel_at),canceledAt:date(sub.canceled_at),
        paid: Boolean(latest?.paid && !latest.fullyRefunded) }};
    },
  };
}
module.exports={createStripeProvider};
