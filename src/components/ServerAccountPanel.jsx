import {useEffect,useState} from 'react';

export default function ServerAccountPanel({onSubscriptionChange}) {
  const [account,setAccount]=useState(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState(false);
  async function api(action,body,signal) {
    const response=await fetch(`/api/server-account${action?`/${action}`:''}`,{method:action?'POST':'GET',cache:'no-store',credentials:'same-origin',signal,
      headers:action?{'Content-Type':'application/json'}:{},body:action?JSON.stringify(body || {}):undefined});
    const result=await response.json();if(!response.ok){const err=new Error(result.message || 'Account linking is unavailable.');err.status=response.status;throw err;}return result;
  }
  useEffect(()=>{const controller=new AbortController();api('',null,controller.signal).then(setAccount).catch(err=>{if(err.name!=='AbortError')setError(err.message);});return()=>controller.abort();},[]);
  async function run(action,body={}) {
    if(busy)return;setBusy(true);setError('');
    try{
      setAccount(await api(action,body));
      if(['confirm','refresh','unlink'].includes(action)){
        const response=await fetch('/api/subscription/status',{cache:'no-store'});
        if(response.ok)onSubscriptionChange?.((await response.json()).subscription);
      }
      if(['confirm','unlink'].includes(action)){setPassword('');setRemoving(false);}
    }
    catch(err){setError(err.message);}finally{setBusy(false);}
  }
  useEffect(()=>{
    if(!account?.pairing || account.pairing.account)return;
    const controller=new AbortController();let active=true;
    const timer=setInterval(()=>api('poll',{},controller.signal).then(value=>{if(active){setAccount(value);setError('');}}).catch(async err=>{
      if(active && err.name!=='AbortError'){
        setError(err.message);
        if(err.status===410)try{const value=await api('',null,controller.signal);if(active)setAccount(value);}catch{/* Preserve the visible error for retry. */}
      }
    }),6000);
    return()=>{active=false;clearInterval(timer);controller.abort();};
  },[account?.pairing?.code,Boolean(account?.pairing?.account)]);
  return <section className="panel server-account-panel"><h3>Website account</h3><p>Link this server to your Homestead website account for plan activation. Free works without linking an account.</p>
    {error && <p role="alert">{error}</p>}
    {account && <>
      <p><strong>{account.linked?account.account?.email:'No website account linked'}</strong> · Test billing</p>
      {account.message && <p role="status">{account.message}</p>}
      {account.linked?<><p>Activated plan: {account.activation}. {account.expiresAt?`Current activation expires ${new Date(account.expiresAt).toLocaleString()}.`:'Waiting for a valid activation.'}</p>
        <p><a href={`${account.origin}/customer/dashboard`} target="_blank" rel="noopener noreferrer">Manage account and billing ↗</a></p>
        <div className="settings-row-actions"><button type="button" disabled={busy} onClick={()=>run('refresh')}>Refresh activation</button><button type="button" disabled={busy} onClick={()=>setRemoving(!removing)}>{removing?'Cancel':'Unlink account'}</button></div>
      </>:account.pairing?<><p>Open <a href={`${account.origin}/customer/servers`} target="_blank" rel="noopener noreferrer">My servers on the website ↗</a> and enter <strong className="server-link-code">{account.pairing.code}</strong>.</p><p>Code expires {new Date(account.pairing.expiresAt).toLocaleTimeString()}.</p>
        <p>Server fingerprint <code style={{overflowWrap:'anywhere'}}>{account.fingerprint}</code></p>
        {account.pairing.account?<><p>Approved account: <strong>{account.pairing.account.email}</strong>. Confirm only if this is your account.</p><button type="button" disabled={busy || !password} onClick={()=>run('confirm',{customerId:account.pairing.account.id,ownerPassword:password})}>Confirm account and activate</button></>:<p role="status">Waiting for website approval…</p>}
        <button type="button" disabled={busy} onClick={()=>run('unlink',{ownerPassword:password})}>Cancel linking</button>
      </>:<><p><a href={`${account.origin}/customer/register`} target="_blank" rel="noopener noreferrer">Create a website account ↗</a></p><button type="button" disabled={busy || !password} onClick={()=>run('start',{ownerPassword:password})}>Link account</button></>}
      {(!account.linked || removing) && <label className="settings-field"><span>Local server owner password</span><input type="password" autoComplete="current-password" maxLength={256} value={password} onChange={event=>setPassword(event.target.value)}/></label>}
      {removing && <><p>Unlinking returns this server to its local Free plan. Your files stay on disk.</p><button type="button" disabled={busy || !password} onClick={()=>run('unlink',{ownerPassword:password})}>Confirm unlink</button></>}
    </>}
  </section>;
}
