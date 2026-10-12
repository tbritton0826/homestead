const titles={activation:'Subscription activated',renewal:'Payment confirmed',failure:'Payment unsuccessful',cancellation:'Subscription cancellation',refund:'Refund recorded',lifetime:'Pro Lifetime activated'};
function billingMessage({email,kind,plan,amount,currency,periodEnd,origin}) {
  const price=Number.isSafeInteger(amount)?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(amount/100):null;
  const lines=[`Homestead — ${titles[kind]}`,plan.name];
  if(price) lines.push(`${kind==='refund'?'Refund':'Amount'}: ${price}`);
  if(kind==='lifetime') lines.push('Your one-time purchase grants the current Homestead Pro software feature tier. No recurring charge or automatic renewal. External services and usage costs are separate.');
  if(kind==='failure') lines.push('The provider has not confirmed a paid period. Review your payment method in billing management.');
  if(kind==='cancellation') lines.push(periodEnd?`Your confirmed paid access ends ${new Date(periodEnd).toISOString()}.`:'Your subscription has ended.');
  if(kind==='refund') lines.push('A full refund removes access funded by that payment. Separate valid licenses remain available.');
  lines.push(`View your account: ${origin}/customer/dashboard`,'Homestead | gethomesteadapp.com');
  return {to:email,subject:`Homestead — ${titles[kind]}`,text:lines.join('\n\n')};
}
module.exports={billingMessage};
