const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {signRequest, publicIdentity} = require('./server-link-proof.cjs');
const {verifyLicenseToken} = require('./subscription-entitlements.cjs');

function accountOrigin(env) {
  const url = new URL(env.HOMESTEAD_ACCOUNTS_ORIGIN || 'https://accounts.gethomesteadapp.com');
  const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))) throw new Error('Accounts service requires an HTTPS origin.');
  return url.origin;
}
function createLinkedAccount({directory, env=process.env, fetchImpl=fetch, now=()=>Date.now(), background=true}) {
  const origin=accountOrigin(env), identityPath=path.join(directory,'identity.json'), statePath=path.join(directory,'account.json');
  let storageError='';
  const damaged=()=>{storageError='Saved account identity could not be read. Free remains available. Restore its backup before linking.';};
  function read(file) {
    try {
      const value=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid account storage.');
      return value;
    }catch(error){if(error.code==='ENOENT')return null;damaged();return null;}
  }
  function writable() {if(storageError)throw new Error(storageError);}
  function checkedIdentity(value) {
    if(typeof value.installationId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.installationId))throw new Error('Invalid installation identity.');
    const key=publicIdentity(value.publicKey);
    const privateKey=crypto.createPrivateKey(value.privateKey);
    if(privateKey.asymmetricKeyType!=='ed25519' || crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'})!==key.publicKey)throw new Error('Saved server identity does not match its key.');
    return {...value,fingerprint:key.fingerprint};
  }
  function write(file,value,exclusive=false) {
    writable();
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const temporary=`${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let failure;
    try {
      fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});
      // Linking a complete temporary file creates an identity atomically without
      // replacing a key created by another process using the same data directory.
      if(exclusive)fs.linkSync(temporary,file);else fs.renameSync(temporary,file);
      fs.chmodSync(file,0o600);
    }
    catch(error){failure=error;}
    try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')failure ||= error;}
    if(failure)throw failure;
  }
  let identity=read(identityPath), state=read(statePath) || {}, tail=Promise.resolve(), timer, cachedLease;
  try {
    if(identity)checkedIdentity(identity);
    if((state.server || state.pending) && !identity)throw new Error('Missing saved installation identity.');
    if(state.server && (!state.account?.id || typeof state.token!=='string' || typeof state.publicKey!=='string'))throw new Error('Incomplete saved account.');
    if(state.pending && (typeof state.pending.id!=='string' || typeof state.pending.deviceSecret!=='string' || typeof state.pending.code!=='string' || !Number.isFinite(Date.parse(state.pending.expiresAt))))throw new Error('Incomplete saved pairing.');
  }catch{damaged();}
  let lastError=storageError;
  // Generate only on an owner's first pairing request, including on the customer-only host.
  function ownIdentity() {
    writable();
    if(!identity) {
      const keys=crypto.generateKeyPairSync('ed25519');
      const candidate={installationId:crypto.randomUUID(),privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:keys.publicKey.export({type:'spki',format:'pem'})};
      try {write(identityPath,candidate,true);identity=candidate;}
      catch(error){if(error.code!=='EEXIST')throw error;identity=read(identityPath);writable();}
    }
    return checkedIdentity(identity);
  }
  function save(next) {write(statePath,next);state=next;}
  function serial(work) {const result=tail.then(()=>{writable();return work();});tail=result.catch(()=>{});return result;}
  async function request(action,data) {
    const response=await fetchImpl(`${origin}/api/customer/linking/${action}`,{method:data?'POST':'GET',
      headers:{Accept:'application/json',...(data?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(12000),
      body:data?JSON.stringify(signRequest(ownIdentity(),action,data,now())):undefined});
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Accounts service is unavailable. Retry shortly.');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new Error('Invalid accounts response.');chunks.push(Buffer.from(value));}}
    finally {await reader.cancel();}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!response.ok){const error=new Error(value.message || 'Accounts request failed.');error.status=response.status;throw error;}
    return value;
  }
  function checkedGrant(value, publicKey, expectedCustomer) {
    const key=ownIdentity();
    const payload=verifyLicenseToken(value.token,publicKey,now());
    if (!payload || payload.audience!=='homestead-linked-server' || payload.mode!=='test'
      || payload.installationId!==key.installationId || payload.fingerprint!==key.fingerprint
      || payload.serverId!==value.server?.id || payload.customerId!==expectedCustomer
      || value.account?.id!==expectedCustomer || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt*1000>now()+86400000+5000) throw new Error('Server activation could not be verified.');
    return payload;
  }
  function license() {
    if (storageError || !state.server || !state.token || !identity || state.origin!==origin) return null;
    try {
      if (cachedLease?.token!==state.token || cachedLease?.publicKey!==state.publicKey) cachedLease={...checkedGrant(state,state.publicKey,state.account.id),token:state.token,publicKey:state.publicKey};
      if(cachedLease.expiresAt*1000<=now() || cachedLease.notBefore*1000>now())return null;
      return {token:state.token,publicKey:state.publicKey};
    }catch{return null;}
  }
  function status() {
    const payload=license()?verifyLicenseToken(state.token,state.publicKey,now()):null;
    return {linked:Boolean(state.server),origin,account:state.account || null,server:state.server || null,
      fingerprint:identity && !storageError?publicIdentity(identity.publicKey).fingerprint:null,
      pairing:state.pending && new Date(state.pending.expiresAt).getTime()>now()?{code:state.pending.code,expiresAt:state.pending.expiresAt,account:state.pending.account || null}:null,
      lastCheckedAt:state.lastCheckedAt || null,expiresAt:payload?new Date(payload.expiresAt*1000).toISOString():null,
      activation:payload?payload.tier: 'free',message:lastError,mode:'test'};
  }
  const begin=name=>serial(async()=>{
    if (state.server) throw new Error('Unlink this server before starting a new account link.');
    const metadata=await request('metadata');const key=publicIdentity(metadata.publicKey).publicKey;
    if (metadata.mode!=='test' || (env.HOMESTEAD_LICENSE_PUBLIC_KEY && publicIdentity(env.HOMESTEAD_LICENSE_PUBLIC_KEY).publicKey!==key)) throw new Error('Accounts signing identity does not match this installation.');
    const pending=await request('start',{name,publicKey:ownIdentity().publicKey});
    if (typeof pending.deviceSecret!=='string' || typeof pending.code!=='string' || !Number.isFinite(Date.parse(pending.expiresAt))) throw new Error('Invalid linking response.');
    save({origin,publicKey:key,pending});lastError='';return status();
  });
  const poll=()=>serial(async()=>{
    if (!state.pending || state.origin!==origin) throw new Error('Start a new account link.');
    if (state.pending.lastPollAt && now()-state.pending.lastPollAt<5000) return status();
    const pending=state.pending;
    try {const result=await request('poll',{id:pending.id,deviceSecret:pending.deviceSecret});save({...state,pending:{...pending,lastPollAt:now(),account:result.account || null}});}
    catch(error){if(error.status===410)save({...state,pending:null});throw error;}
    return status();
  });
  const confirm=customerId=>serial(async()=>{
    const pending=state.pending;
    if (!pending?.account || pending.account.id!==customerId) throw new Error('Check the approved account before confirming.');
    const result=await request('complete',{id:pending.id,deviceSecret:pending.deviceSecret,customerId});
    checkedGrant(result,state.publicKey,customerId);
    save({origin,publicKey:state.publicKey,account:result.account,server:result.server,token:result.token,lastCheckedAt:new Date(now()).toISOString()});lastError='';return status();
  });
  const refresh=()=>serial(async()=>{
    if (!state.server) return status();
    try {
      if (state.origin!==origin) throw new Error('Accounts service address changed. Unlink and link again.');
      const result=await request('refresh',{serverId:state.server.id});
      checkedGrant(result,state.publicKey,state.account.id);
      save({...state,account:result.account,server:result.server,token:result.token,lastCheckedAt:new Date(now()).toISOString()});lastError='';
    } catch(error) {
      if (error.status===403) {save({origin});lastError='This account link was removed. Free remains available; link again to restore paid access.';}
      else lastError='Cannot reach the accounts service. Your last valid activation remains available until it expires. Retry shortly.';
    }
    return status();
  });
  const unlink=()=>serial(async()=>{
    // Require a confirmed remote revocation before discarding the local identity/binding.
    if (state.server) await request('unlink',{serverId:state.server.id});
    save({origin});lastError='';return status();
  });
  if (background && env.HOMESTEAD_CUSTOMER_ONLY!=='true') {
    timer=setInterval(()=>{refresh().catch(()=>{});},900000);timer.unref();
    if(state.server)queueMicrotask(()=>refresh().catch(()=>{}));
  }
  return {origin,status,license,begin,poll,confirm,refresh,unlink,close:()=>clearInterval(timer)};
}

function registerLinkedAccount({app,express,service,access,serverName}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();},access.requireOwner);
  router.use((req,res,next)=>{
    if(req.method==='GET')return next();
    const expected=`${req.protocol}://${req.get('host')}`;
    if(req.get('Origin')!==expected || !req.is('application/json'))return res.status(403).json({message:'Use the server’s own account page to make this change.'});
    if(Buffer.byteLength(JSON.stringify(req.body || {}))>2048)return res.status(413).json({message:'This account request is too large.'});
    next();
  });
  router.use(express.json({limit:'2kb'}));
  const authAttempts=new Map();
  function confirmOwner(req,res,next) {
    const key=req.ip, bucket=Math.floor(Date.now()/600000);
    const attempt=authAttempts.get(key);
    const count=attempt?.bucket===bucket?attempt.count+1:1;
    if(authAttempts.size>1000)authAttempts.clear();
    authAttempts.set(key,{bucket,count});
    if(count>10)return res.status(429).json({message:'Too many owner confirmations. Retry in ten minutes.'});
    if(!access.verifyOwnerPassword(req))return res.status(403).json({message:'Enter your local server owner password to confirm this change.'});
    next();
  }
  router.get('/',(req,res)=>res.json(service.status()));
  router.post('/start',confirmOwner,async(req,res)=>{const value=await service.begin(String(serverName() || 'Homestead').slice(0,100));access.recordAudit('account-link.started',req);res.json(value);});
  router.post('/poll',async(req,res)=>res.json(await service.poll()));
  router.post('/confirm',confirmOwner,async(req,res)=>{const value=await service.confirm(req.body.customerId);access.recordAudit('account-link.confirmed',req);res.json(value);});
  router.post('/refresh',async(req,res)=>res.json(await service.refresh()));
  router.post('/unlink',confirmOwner,async(req,res)=>{const value=await service.unlink();access.recordAudit('account-link.removed',req);res.json(value);});
  router.use((error,req,res,_next)=>res.status(error.status && error.status<500?error.status:503).json({message:error.status && error.status<500?error.message:'The accounts service could not complete this request. Retry shortly.'}));
  app.use('/api/server-account',router);
}
module.exports={accountOrigin,createLinkedAccount,registerLinkedAccount};
