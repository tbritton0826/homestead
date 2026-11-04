import {useEffect,useState} from 'react';

export default function CustomerServers({api,customer}) {
  const [servers,setServers]=useState([]),[code,setCode]=useState(''),[preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[removing,setRemoving]=useState('');
  const load=async signal=>setServers((await api('/servers',null,'GET',signal)).servers);
  useEffect(()=>{
    if(!customer.emailVerified)return;
    const controller=new AbortController();load(controller.signal).catch(err=>{if(err.name!=='AbortError')setError(err.message);});
    return ()=>controller.abort();
  },[customer.id,customer.emailVerified]);
  async function run(work) {
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await work();}catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <><h1>My servers</h1><p>Link a server you own to activate your account’s plan. Local users and media stay on that server.</p>
    {error && <p role="alert" className="customer-alert">{error}</p>}{message && <p role="status" className="customer-message">{message}</p>}
    {!customer.emailVerified?<section className="customer-card"><p>Verify your email before linking a server.</p><a href="/customer/dashboard">Email verification</a></section>:<>
      <section className="customer-card"><h2>Link a server</h2><p>In your Homestead server, open My Account → Website account and choose Link account. Enter its ten-minute code below.</p>
        <form onSubmit={event=>{event.preventDefault();run(async()=>setPreview(await api('/server-link/preview',{code})));}}>
          <label>Linking code<input required value={code} maxLength={14} placeholder="AB12-CD34-EF56" autoComplete="off" spellCheck={false} onChange={event=>{setCode(event.target.value);setPreview(null);}}/></label>
          <button disabled={busy || !code.trim()}>Review server</button>
        </form>
        {preview && <div><h3>{preview.name}</h3><p>Server fingerprint <code>{preview.fingerprint}</code></p><p>Confirm that this fingerprint matches the one on your server. You are linking to <strong>{customer.email}</strong>.</p>
          <button className="customer-primary" disabled={busy} onClick={()=>run(async()=>{const result=await api('/server-link/approve',{code,fingerprint:preview.fingerprint});setMessage(result.message);setPreview(null);setCode('');})}>Approve this server</button>
        </div>}
      </section>
      <div className="customer-server-list">{servers.length?servers.map(server=><section className="customer-card" key={server.id}><h2>{server.name}</h2><p>{server.revokedAt?'Unlinked':'Linked'} · {server.lastSeenAt?`Last checked ${new Date(server.lastSeenAt).toLocaleString()}`:'Awaiting activation'}</p><p>Fingerprint <code>{server.fingerprint}</code></p>
        {!server.revokedAt && (removing===server.id?<div><p>Unlink this server? Its paid access will end when it next checks in, or within 24 hours while offline. Local media will stay on the server.</p><button disabled={busy} onClick={()=>run(async()=>{const result=await api(`/servers/${server.id}`,{},'DELETE');setMessage(result.message);setRemoving('');await load();})}>Confirm unlink</button> <button disabled={busy} onClick={()=>setRemoving('')}>Cancel</button></div>:<button disabled={busy} onClick={()=>setRemoving(server.id)}>Unlink server</button>)}
      </section>):<section className="customer-card"><p>No servers linked yet. Start on your Homestead server, then enter its code above.</p></section>}</div>
      <button disabled={busy} onClick={()=>run(()=>load())}>Refresh servers</button>
    </>}
  </>;
}
