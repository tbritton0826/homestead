export function checkoutMessage(result) {
  if(!result) return {title:'Payment confirmation pending',detail:'Refresh to check the provider-confirmed result.'};
  if(result.paymentStatus==='refunded') return {title:'Purchase refunded',detail:'The refunded payment no longer grants access. Other valid licenses remain available.'};
  if(result.paymentStatus==='failed') return {title:'Payment unsuccessful',detail:'No paid access was granted for this payment. Review billing management or return to plans.'};
  if(result.status==='expired' || result.paymentStatus==='cancelled') return {title:'Checkout expired',detail:'Return to plans to start a new checkout.'};
  if(result.confirmed && ['paid','partially_refunded'].includes(result.paymentStatus)) return {title:'Purchase confirmed',detail:result.plan?.productKind==='one_time'?'Your Pro Lifetime license is available in your account.':'The provider confirmed payment and your subscription was reconciled.'};
  return {title:'Payment confirmation pending',detail:'The provider has not yet confirmed usable paid access. Returning to this page does not activate a plan.'};
}
export function annualSavings(plan,plans) {
  const monthly=plans.find(row=>row.tier===plan.tier && row.billingInterval==='month' && row.productKind==='subscription');
  return plan.billingInterval==='year' && monthly?.amount!=null?Math.max(0,monthly.amount*12-plan.amount):0;
}
