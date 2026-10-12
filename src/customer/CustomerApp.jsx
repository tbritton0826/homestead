import { useEffect, useState } from 'react';
import './CustomerApp.css';
import { money } from './money.js';
import { annualSavings,checkoutMessage } from './billing-view.js';
const featureLabels={coreMedia:'Core media',multiUser:'Multiple users',librarySharing:'Library sharing',photos:'Photos',familyLibrary:'Family library',households:'Households',familyProfiles:'Family profiles',familyTree:'Family tree',calendar:'Calendar',recipes:'Recipes',pets:'Pets',inventory:'Inventory',cloud:'Cloud',appearance:'Appearance settings',liveTV:'Live TV',adult:'Adult library',ai:'AI',externalIntegrations:'External integrations',automation:'Automation',plugins:'Plugins'};

export default function CustomerApp() {
  const path=window.location.pathname.replace(/\/$/,'');
  const [customer,setCustomer]=useState(null),[csrf,setCsrf]=useState(''),[plans,setPlans]=useState([]),[billing,setBilling]=useState(false);
  const [dashboard,setDashboard]=useState(null),[purchases,setPurchases]=useState([]),[nextOffset,setNextOffset]=useState(null),[result,setResult]=useState(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [token]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [license,setLicense]=useState('');
  const [interval,setInterval]=useState('month');
  async function api(endpoint,body,method=body?'POST':'GET',signal) {
    const response=await fetch(`/api/customer${endpoint}`,{method,credentials:'same-origin',signal,
      headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined});
    const data=await response.json();if(!response.ok)throw new Error(data.message || 'Request failed.');return data;
  }
  async function refresh(signal) {
    const session=await api('/session',null,'GET',signal);setCustomer(session.customer);setCsrf(session.csrfToken);
    const catalog=await api('/plans',null,'GET',signal);setPlans(catalog.plans);setBilling(catalog.billingAvailable);
    if(session.customer) {
      const [detail,history]=await Promise.all([api('/dashboard',null,'GET',signal),api('/purchases',null,'GET',signal)]);
      setDashboard(detail);setPurchases(history.transactions);setNextOffset(history.nextOffset);
      const sessionId=new URLSearchParams(window.location.search).get('session_id');
      if(path==='/customer/checkout/success' && sessionId) setResult(await api(`/checkout-status?session_id=${encodeURIComponent(sessionId)}`,null,'GET',signal));
    }
  }
  useEffect(()=> {
    document.title='Homestead — Customer accounts';
    if(window.location.hash)window.history.replaceState(null,'',window.location.pathname+window.location.search);
    const controller=new AbortController();
    refresh(controller.signal).catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[]);
  async function action(work) {
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await work();}catch(err){setError(err.message);}finally{setBusy(false);}
  }
  function redirect(url) {
    const destination=new URL(url);
    if(destination.protocol!=='https:' || !['checkout.stripe.com','billing.stripe.com'].includes(destination.hostname))throw new Error('Unexpected billing destination.');
    window.location.assign(destination.href);
  }
  function submitAuth(event,endpoint) {
    event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
    action(async()=> {
      const data=await api(endpoint,{...values,token});
      if(endpoint==='/login')window.location.assign('/customer/dashboard');
      else setMessage(data.message);
    });
  }
  const authPage=['login','register','forgot-password','verify','reset'].find(name=>path===`/customer/${name}`);
  const needsAccount=['/customer/dashboard','/customer/purchases','/customer/checkout/success'].includes(path);
  const features=dashboard?.entitlements?.features || [];
  const access=dashboard?.entitlements;
  const hasRecurring=dashboard?.subscriptions?.some(sub=>!['canceled','incomplete_expired'].includes(sub.status));
  const checkoutState=checkoutMessage(result);
  function planCard(plan) {
    const lifetime=plan.productKind==='one_time';
    const current=access?.licenses?.some(item=>item.plan===plan.name && item.productKind===plan.productKind);
    const savings=annualSavings(plan,plans);
    const owned=access?.hasLifetime || (plan.tier==='free' && access?.active);
    return <section className={`customer-card${lifetime?' customer-lifetime':''}`} key={plan.id}>
      <h2>{plan.name}</h2><p>{lifetime?'One-time purchase · no renewal':plan.billingInterval==='year'?'Billed annually':plan.billingInterval==='month'?'Billed monthly':'No payment required'}</p>
      <strong className="customer-price">{plan.amount===null?'Price unavailable':money(plan.amount,plan.currency)}{plan.billingInterval==='year'?' / year':plan.billingInterval==='month'?' / month':''}</strong>
      {savings>0 && <p className="customer-savings">Save {money(savings,plan.currency)} per year compared with monthly billing.</p>}
      {current && <p className="customer-current" role="status">{lifetime?'Lifetime owned':'Current tier'}</p>}
      <p>{plan.description}</p><ul>{plan.features.map(feature=><li key={feature}>{featureLabels[feature] || feature}</li>)}</ul>
      {!plan.available && plan.amount>0 && <p>Test checkout unavailable until its Stripe Price is configured and validated.</p>}
      {!customer?<a href="/customer/register">Create an account</a>:!customer.emailVerified?<a href="/customer/dashboard">Verify email to select a plan</a>:<button className="customer-primary" disabled={busy || !plan.available || owned || (!lifetime && plan.amount>0 && hasRecurring)} onClick={()=>action(async()=> {
        if(plan.amount===0){await api('/select-free',{planId:plan.id});await refresh();setMessage('Free plan selected.');}
        else redirect((await api('/checkout',{planId:plan.id,requestId:crypto.randomUUID()})).url);
      })}>{access?.hasLifetime?'Pro Lifetime owned':plan.tier==='free' && access?.active?'Included in your plan':!lifetime && hasRecurring?'Use Manage billing':plan.amount===0?'Select Free':'Continue to test checkout'}</button>}
      {!lifetime && hasRecurring && plan.amount>0 && <p><a href="/customer/dashboard">Manage your subscription</a></p>}
    </section>;
  }
  return <div className="customer-page">
    <header className="customer-header"><a href="/" className="customer-brand">Homestead</a><span className="customer-test-badge">Test billing</span>
      <nav aria-label="Customer navigation"><a href="/customer/pricing">Plans</a><a href="/customer/dashboard">My account</a><a href="/customer/purchases">Purchase history</a>
        {customer?<button disabled={busy} onClick={()=>action(async()=>{await api('/logout',{});window.location.assign('/customer/login');})}>Sign out</button>:<a href="/customer/login">Sign in</a>}</nav>
    </header>
    <main className="customer-main">
      {error && <p className="customer-alert" role="alert">{error}</p>}{message && <p className="customer-message" role="status">{message}</p>}
      {loading?<p role="status">Loading your customer account…</p>:<>
        {authPage && <section className="customer-card customer-auth"><h1>{{login:'Sign in',register:'Create your customer account','forgot-password':'Recover your account',verify:'Verify your email',reset:'Choose a new password'}[authPage]}</h1>
          <form onSubmit={event=>submitAuth(event,`/${authPage}`)}>
            {authPage==='register' && <label>Display name<input required name="displayName" maxLength={100} autoComplete="name" /></label>}
            {['register','login','forgot-password'].includes(authPage) && <label>Email<input required name="email" type="email" maxLength={254} autoComplete="email" /></label>}
            {['register','login','reset'].includes(authPage) && <label>Password<input required name="password" type="password" minLength={authPage==='login'?1:12} maxLength={256} autoComplete={authPage==='login'?'current-password':'new-password'} /></label>}
            {['verify','reset'].includes(authPage) && !token?<p role="alert">Open the link from your email. If it expired, request a new one.</p>:<button className="customer-primary" disabled={busy || !csrf}>{busy?'Working…':{login:'Sign in',register:'Register','forgot-password':'Send reset email',verify:'Verify email',reset:'Save password'}[authPage]}</button>}
          </form><div className="customer-links"><a href="/customer/login">Sign in</a><a href="/customer/register">Create account</a><a href="/customer/forgot-password">Forgot password</a></div>
        </section>}
        {needsAccount && !customer && <section className="customer-card"><h1>Sign in to continue</h1><p>Your customer account is separate from accounts on a private Homestead server.</p><a href="/customer/login">Sign in</a></section>}
        {(path==='/customer' || path==='/customer/pricing') && <><h1>Homestead plans</h1><p>Approved prices in USD. Checkout is test mode only.</p>
          {access?.active && <p>Current effective plan: {access.effectiveLicense.plan}</p>}
          <div className="customer-interval" role="group" aria-label="Billing interval">{['month','year'].map(value=><button key={value} aria-pressed={interval===value} onClick={()=>setInterval(value)}>{value==='month'?'Monthly':'Annual'}</button>)}</div>
          <div className="customer-plan-grid">{plans.filter(plan=>plan.productKind==='subscription' && (plan.billingInterval==='none' || plan.billingInterval===interval)).sort((a,b)=>['free','family','plus','pro'].indexOf(a.tier)-['free','family','plus','pro'].indexOf(b.tier)).map(planCard)}</div>
          <h2>Early Access lifetime offering</h2>{plans.filter(plan=>plan.productKind==='one_time').map(planCard)}
        </>}
        {path==='/customer/dashboard' && customer && <><h1>My account</h1><div className="customer-dashboard-grid">
          <section className="customer-card"><h2>Profile</h2><p>{customer.email} · {customer.emailVerified?'Verified':'Verification required'}</p>
            {!customer.emailVerified && <button disabled={busy} onClick={()=>action(async()=>setMessage((await api('/verification',{})).message))}>Resend verification email</button>}
            <form onSubmit={event=>{event.preventDefault();const displayName=new FormData(event.currentTarget).get('displayName');action(async()=>{const data=await api('/profile',{displayName,preferences:customer.preferences},'PATCH');setCustomer(data.customer);setMessage('Profile saved.');});}}>
              <label>Display name<input name="displayName" required maxLength={100} defaultValue={customer.displayName}/></label><button disabled={busy}>Save profile</button>
            </form>
          </section>
          <section className="customer-card"><h2>Subscriptions</h2>{dashboard?.subscriptions?.length?dashboard.subscriptions.map(sub=><div key={sub.id}><h3>{sub.plan_snapshot.name} · {sub.status}</h3><p>{sub.plan_snapshot.billingInterval==='year'?'Annual':'Monthly'} · {money(sub.plan_snapshot.amount,sub.plan_snapshot.currency)}</p><p>{sub.cancel_at_period_end || sub.status==='canceled'?'Paid period ends':'Current period ends'} {sub.period_end?new Date(sub.period_end).toLocaleDateString():'Pending'}</p></div>):<p>No subscription yet.</p>}
            <button disabled={busy || !billing || !customer.emailVerified || !dashboard?.billingAccount} onClick={()=>action(async()=>redirect((await api('/portal',{})).url))}>Manage billing / change plan</button><p>Upgrades, downgrades, and cancellation use the configured test billing portal. A lifetime purchase does not automatically cancel a separate subscription.</p>
          </section>
          <section className="customer-card"><h2>Effective access</h2><p>{access?.effectiveLicense?.plan || 'No active plan'}</p>
            {dashboard?.lifetimes?.map(item=><p key={item.id}>{item.name}: {item.manual_revoked_at?'revoked':item.status}{item.status==='active' && !item.manual_revoked_at?' · no expiration or automatic renewal':''}</p>)}
            {features.length?<ul>{features.map(feature=><li key={feature}>{featureLabels[feature] || feature}</li>)}</ul>:<p>No active entitlements. Select a configured plan after verifying your email.</p>}
            <button disabled={busy || !features.length || !customer.emailVerified} onClick={()=>action(async()=>setLicense((await api('/license',{})).token))}>Get installation license</button>
            {license && <label>License token<textarea readOnly value={license} aria-label="Installation license token"/></label>}
          </section>
        </div></>}
        {path==='/customer/purchases' && customer && <><h1>Purchase history</h1><section className="customer-card">{purchases.length?<div className="customer-table-wrap"><table><thead><tr><th>Plan</th><th>Status</th><th>Amount</th><th>Date</th><th>Receipt</th></tr></thead><tbody>{purchases.map(purchase=><tr key={purchase.id}><td>{purchase.plan_snapshot.name}</td><td>{purchase.status}{Number(purchase.refunded_amount)>0 && ` (${money(purchase.refunded_amount,purchase.currency)} refunded)`}</td><td>{money(purchase.amount,purchase.currency)}</td><td>{purchase.paid_at || purchase.created_at?new Date(purchase.paid_at || purchase.created_at).toLocaleDateString():'Pending'}</td><td>{purchase.receipt_url?.startsWith('https://') && <a href={purchase.receipt_url} target="_blank" rel="noopener noreferrer">Receipt / invoice</a>}</td></tr>)}</tbody></table></div>:<p>No purchases yet.</p>}
          {nextOffset!==null && <button disabled={busy} onClick={()=>action(async()=>{const history=await api(`/purchases?offset=${nextOffset}`);setPurchases(old=>[...old,...history.transactions]);setNextOffset(history.nextOffset);})}>Show more purchases</button>}
        </section></>}
        {path==='/customer/checkout/success' && customer && <section className="customer-card"><h1>{checkoutState.title}</h1><p role="status">{checkoutState.detail}</p><button disabled={busy} onClick={()=>action(()=>refresh())}>Refresh payment status</button><p><a href="/customer/dashboard">View my subscription and entitlements</a></p><p><a href="/customer/pricing">Return to plans</a></p></section>}
        {path==='/customer/checkout/cancel' && <section className="customer-card"><h1>Checkout cancelled</h1><p>No access was granted by this page. Any confirmed payment remains visible in your account.</p><a href="/customer/pricing">Return to plans</a></section>}
        {!authPage && !needsAccount && !['/customer','/customer/pricing','/customer/checkout/cancel'].includes(path) && <section className="customer-card"><h1>Page not found</h1><a href="/customer/dashboard">Go to my account</a></section>}
      </>}
    </main>
  </div>;
}
