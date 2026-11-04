const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const express=require('express');
const {testPool}=require('./customer-test-support.cjs');
const {mountCustomer}=require('../src/server/customer/index.cjs');
const {digest,randomToken}=require('../src/server/customer/security.cjs');
const {signRequest,publicIdentity}=require('../src/server/server-link-proof.cjs');
const {createLinkedAccount,registerLinkedAccount,accountOrigin}=require('../src/server/linked-account.cjs');
const {createSubscriptionService,verifyLicenseToken}=require('../src/server/subscription-entitlements.cjs');
const {registerNextVersionRoutes}=require('../src/server/next-version.cjs');

const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
async function listen(app){const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {server,origin:`http://127.0.0.1:${server.address().port}`};}
function identity(){const keys=crypto.generateKeyPairSync('ed25519');return {installationId:crypto.randomUUID(),privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:keys.publicKey.export({type:'spki',format:'pem'})};}

test('linked accounts reject insecure origins and malformed/expired license claims',()=>{
  for(const value of ['http://public.example','https://a.example/path','https://user:pass@a.example','https://a.example/?token=x','file:///tmp'])assert.throws(()=>accountOrigin({NODE_ENV:'production',HOMESTEAD_ACCOUNTS_ORIGIN:value}));
  assert.equal(accountOrigin({NODE_ENV:'test',HOMESTEAD_ACCOUNTS_ORIGIN:'http://127.0.0.1:1234'}),'http://127.0.0.1:1234');
  const key=identity();
  const token=payload=>{const value=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${value}.${crypto.sign(null,Buffer.from(value),key.privateKey).toString('base64url')}`;};
  const valid=token({tier:'pro',expiresAt:Date.now()/1000+3600});
  assert.equal(verifyLicenseToken(valid+'.extra',key.publicKey),null);
  assert.equal(verifyLicenseToken(token({tier:'pro',expiresAt:'not-a-date'}),key.publicKey),null);
  let now=Date.now();const subscription=createSubscriptionService({env:{NODE_ENV:'production',HOMESTEAD_LICENSE_TOKEN:valid,HOMESTEAD_LICENSE_PUBLIC_KEY:key.publicKey},now:()=>now});
  assert.equal(subscription.has('plugins'),true);now+=3601000;assert.equal(subscription.status().tier,'free');assert.equal(subscription.has('plugins'),false);
});

test('account/server linking lifecycle over HTTP with persistent identities and isolated database',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'homestead-server-link-'));
  const pool=await testPool(path.join(directory,'postgres'));
  const app=express(),cloud=await listen(app),keys=identity();
  const env={NODE_ENV:'test',HOMESTEAD_CUSTOMER_ENABLED:'true',HOMESTEAD_CUSTOMER_ORIGIN:cloud.origin,HOMESTEAD_CUSTOMER_MAIL_KEY:'a'.repeat(64),HOMESTEAD_PAYMENT_MODE:'test',HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY:keys.privateKey};
  const customerService=mountCustomer({app,express,pool,env,background:false,sendMail:async()=>{}});await customerService.ready;
  const localDirectory=path.join(directory,'server'),localEnv={NODE_ENV:'test',HOMESTEAD_ACCOUNTS_ORIGIN:cloud.origin};
  let clock=Date.now(),outage=false,tamper=false;
  const fetchImpl=async(...args)=>{
    if(outage)throw new Error('fixture network outage');
    const response=await fetch(...args);
    if(tamper && args[0].endsWith('/refresh') && response.ok){const value=await response.json();value.token=value.token.slice(0,-2)+'XX';return Response.json(value);}
    return response;
  };
  let local=createLinkedAccount({directory:localDirectory,env:localEnv,fetchImpl,background:false,now:()=>Math.max(clock,Date.now())});
  const subscription=createSubscriptionService({env:{NODE_ENV:'production'},linkedLicense:()=>local.license(),now:()=>Math.max(clock,Date.now())});
  async function customer(email,verified=true){
    const id=crypto.randomUUID(),session=randomToken(),csrf=randomToken();
    await pool.query('INSERT INTO customers(id,email,display_name,email_verified_at) VALUES($1,$2,$2,$3)',[id,email,verified?new Date():null]);
    await pool.query("INSERT INTO customer_sessions(token_hash,customer_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",[digest(session),id,digest(csrf)]);
    return {id,csrf,cookie:`homestead_customer=${session}; homestead_customer_csrf=${csrf}`};
  }
  const a=await customer('owner-a@example.test'),b=await customer('owner-b@example.test'),unverified=await customer('unverified@example.test',false);
  async function browser(endpoint,body,account=a,method=body?'POST':'GET',headers={}){
    const response=await fetch(`${cloud.origin}/api/customer${endpoint}`,{method,headers:{Origin:cloud.origin,Cookie:account.cookie,'X-CSRF-Token':account.csrf,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json()};
  }
  async function machine(action,data,key=identity(),proof){const response=await fetch(`${cloud.origin}/api/customer/linking/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof || signRequest(key,action,data))});return {status:response.status,data:await response.json()};}
  let pairing,serverId,device,approved;
  try {
    await t.test('browser writes require verified account, correct origin and CSRF',async()=>{
      assert.equal((await browser('/servers',null,unverified)).status,403);
      assert.equal((await browser('/server-link/preview',{code:'ABCD-1234-5678'},a,'POST',{'X-CSRF-Token':''})).status,403);
      assert.equal((await browser('/server-link/preview',{code:'ABCD-1234-5678'},a,'POST',{Origin:'https://evil.invalid'})).status,403);
    });
    await t.test('start proves private-key ownership and cannot replay signed requests',async()=>{
      const key=identity(),data={name:'Fixture fake server',publicKey:key.publicKey},proof=signRequest(key,'start',data);
      proof.signature='a'.repeat(86);assert.equal((await machine('start',data,key,proof)).status,401);
      const good=signRequest(key,'start',data);assert.equal((await machine('start',data,key,good)).status,201);
      assert.equal((await machine('start',data,key,good)).status,409);
      const old=signRequest(key,'start',data,Date.now()-180000);assert.equal((await machine('start',data,key,old)).status,401);
      await pool.query('DELETE FROM customer_rate_limits');
    });
    await t.test('code approval exposes only the intended server and requires matching fingerprint',async()=>{
      assert.equal(subscription.status().tier,'free');
      pairing=await local.begin('Fixture living room');
      assert.match(pairing.pairing.code,/^[A-F0-9]{4}(-[A-F0-9]{4}){2}$/);
      assert.equal(JSON.stringify(pairing).includes('deviceSecret'),false);
      const preview=await browser('/server-link/preview',{code:pairing.pairing.code});assert.equal(preview.status,200);
      assert.equal(preview.data.fingerprint,pairing.fingerprint);
      assert.equal((await browser('/server-link/approve',{code:pairing.pairing.code,fingerprint:'wrong'})).status,409);
      assert.equal((await browser('/server-link/approve',{code:pairing.pairing.code,fingerprint:pairing.fingerprint})).status,200);
      assert.equal((await browser('/server-link/preview',{code:pairing.pairing.code},b)).status,404);
      approved=await local.poll();assert.equal(approved.pairing.account.id,a.id);
      await assert.rejects(local.confirm(b.id));
      assert.equal((await browser('/servers')).data.servers.length,0);
    });
    await t.test('owner confirmation issues a bound short lease and survives lost completion response',async()=>{
      const linked=await local.confirm(a.id);serverId=linked.server.id;
      assert.equal(linked.account.id,a.id);assert.equal(subscription.status().tier,'free');
      const saved=JSON.parse(await fs.readFile(path.join(localDirectory,'account.json'),'utf8'));
      const license=verifyLicenseToken(saved.token,saved.publicKey);assert.equal(license.installationId,JSON.parse(await fs.readFile(path.join(localDirectory,'identity.json'),'utf8')).installationId);
      assert.equal(license.mode,'test');assert.ok(license.expiresAt-Date.now()/1000<=86400);
      device=JSON.parse(await fs.readFile(path.join(localDirectory,'identity.json'),'utf8'));
      const row=(await pool.query('SELECT * FROM customer_server_pairings WHERE fingerprint=$1',[pairing.fingerprint])).rows[0];
      // Recreate the request secret from a fixture-specific ticket, without storing it in logs.
      const secret=randomToken();await pool.query('UPDATE customer_server_pairings SET device_hash=$1 WHERE id=$2',[digest(secret),row.id]);
      const retry=await machine('complete',{id:row.id,deviceSecret:secret,customerId:a.id},device);
      assert.equal(retry.status,200);assert.equal(retry.data.server.id,serverId);
      assert.equal((await browser('/servers')).data.servers.length,1);
    });
    await t.test('only the linked customer can see or unlink their server',async()=>{
      assert.equal((await browser('/servers',null,b)).data.servers.length,0);
      assert.equal((await browser(`/servers/${serverId}`,{},b,'DELETE')).status,404);
      assert.equal((await machine('refresh',{serverId},identity())).status,401);
      const proof=signRequest(device,'refresh',{serverId});assert.equal((await machine('refresh',null,device,proof)).status,200);
      assert.equal((await machine('refresh',null,device,proof)).status,409);
    });
    await t.test('confirmed entitlements activate without restart; tampering and outages retain last valid lease',async()=>{
      await pool.query("UPDATE customer_plans SET active=true,draft=false WHERE id='plus-month-v2'");
      await pool.query("INSERT INTO customer_licenses(id,customer_id,plan_id,features,status,expires_at) VALUES($1,$2,'plus-month-v2','[]','active',now()+interval '3 days')",[crypto.randomUUID(),a.id]);
      await local.refresh();assert.equal(subscription.status().tier,'plus');assert.equal(subscription.has('cloud'),true);
      const persisted=await fs.readFile(path.join(localDirectory,'account.json'),'utf8');
      tamper=true;await local.refresh();tamper=false;assert.equal(subscription.status().tier,'plus');assert.equal(await fs.readFile(path.join(localDirectory,'account.json'),'utf8'),persisted);
      outage=true;assert.match((await local.refresh()).message,/Cannot reach/);assert.equal(subscription.status().tier,'plus');
      local.close();local=createLinkedAccount({directory:localDirectory,env:localEnv,fetchImpl,background:false,now:()=>Math.max(clock,Date.now())});assert.equal(subscription.status().tier,'plus');
      clock+=86401000;assert.equal(subscription.status().tier,'free');clock=Date.now();outage=false;
    });
    await t.test('invalid paid access falls back to Free, lifetime uses bounded online lease too',async()=>{
      await pool.query("UPDATE customer_licenses SET status='revoked' WHERE customer_id=$1",[a.id]);await local.refresh();assert.equal(subscription.status().tier,'free');
      await pool.query("UPDATE customer_plans SET active=true,draft=false WHERE id='pro-none-v2'");
      // A perpetual license still gets an expiring linked-server lease.
      const purchase=crypto.randomUUID();
      await pool.query("INSERT INTO customer_transactions(id,customer_id,plan_id,provider,external_payment_id,amount,currency,status,plan_snapshot) VALUES($1,$2,'pro-none-v2','stripe','pi_fixture_lifetime',24999,'usd','paid','{}')",[purchase,a.id]);
      await pool.query("INSERT INTO customer_licenses(id,customer_id,plan_id,purchase_id,features,status) VALUES($1,$2,'pro-none-v2',$3,'[]','active')",[crypto.randomUUID(),a.id,purchase]);
      await local.refresh();assert.equal(subscription.status().tier,'pro');assert.ok(Date.parse(local.status().expiresAt)-clock<=86400000);
    });
    await t.test('an active lease copied to a different installation or signing service is ignored',async()=>{
      assert.ok(local.license(),'the source installation must still hold an active grant');
      const saved=JSON.parse(await fs.readFile(path.join(localDirectory,'account.json'),'utf8'));
      assert.equal(verifyLicenseToken(saved.token,saved.publicKey).tier,'pro');
      const otherDirectory=path.join(directory,'copy');await fs.mkdir(otherDirectory);
      await fs.writeFile(path.join(otherDirectory,'identity.json'),JSON.stringify(identity()));
      await fs.writeFile(path.join(otherDirectory,'account.json'),JSON.stringify(saved));
      const other=createLinkedAccount({directory:otherDirectory,env:localEnv,background:false});
      try {assert.equal(other.license(),null);}finally{other.close();}
      const signerDirectory=path.join(directory,'other-signer');await fs.mkdir(signerDirectory);
      await fs.copyFile(path.join(localDirectory,'identity.json'),path.join(signerDirectory,'identity.json'));
      await fs.writeFile(path.join(signerDirectory,'account.json'),JSON.stringify({...saved,publicKey:identity().publicKey}));
      const changedSigner=createLinkedAccount({directory:signerDirectory,env:localEnv,background:false});
      try {assert.equal(changedSigner.license(),null);}finally{changedSigner.close();}
      assert.ok(local.license(),'negative copies must not alter the original activation');
    });
    await t.test('dashboard revocation clears activation on refresh and old approval cannot resurrect it',async()=>{
      assert.equal((await browser(`/servers/${serverId}`,{},a,'DELETE')).status,200);
      const row=(await pool.query('SELECT * FROM customer_server_pairings WHERE server_id=$1',[serverId])).rows[0];
      const secret=randomToken();await pool.query('UPDATE customer_server_pairings SET device_hash=$1 WHERE id=$2',[digest(secret),row.id]);
      assert.equal((await machine('complete',{id:row.id,deviceSecret:secret,customerId:a.id},device)).status,403);
      await local.refresh();assert.equal(local.status().linked,false);assert.equal(subscription.status().tier,'free');
    });
    await t.test('competing account completions serialize; retries cannot take over a server until it is unlinked',async()=>{
      await pool.query('DELETE FROM customer_rate_limits');
      const key=identity(),data={name:'Concurrent fixture',publicKey:key.publicKey};
      const first=await machine('start',data,key),second=await machine('start',data,key);
      assert.equal(first.status,201);assert.equal(second.status,201);
      const fingerprint=publicIdentity(key.publicKey).fingerprint;
      assert.equal((await browser('/server-link/approve',{code:first.data.code,fingerprint},a)).status,200);
      assert.equal((await browser('/server-link/approve',{code:second.data.code,fingerprint},b)).status,200);
      const requests=[{ticket:first.data,customer:a},{ticket:second.data,customer:b}];
      const complete=entry=>machine('complete',{id:entry.ticket.id,deviceSecret:entry.ticket.deviceSecret,customerId:entry.customer.id},key);
      const results=await Promise.all(requests.map(complete));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const winner=results.findIndex(r=>r.status===200),loser=1-winner;
      const server=results[winner].data.server;
      const rows=(await pool.query('SELECT * FROM customer_servers WHERE fingerprint=$1',[fingerprint])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].customer_id,requests[winner].customer.id);
      const retries=await Promise.all([complete(requests[winner]),complete(requests[winner])]);
      assert.ok(retries.every(r=>r.status===200 && r.data.server.id===server.id));
      assert.equal((await browser(`/servers/${server.id}`,{},requests[loser].customer,'DELETE')).status,404);
      assert.equal((await browser(`/servers/${server.id}`,{},requests[winner].customer,'DELETE')).status,200);
      const relink=await complete(requests[loser]);
      assert.equal(relink.status,200);assert.equal(relink.data.account.id,requests[loser].customer.id);
      assert.equal((await complete(requests[winner])).status,403,'old approval cannot resurrect access for the prior account');
      assert.equal((await browser(`/servers/${server.id}`,{},requests[winner].customer,'DELETE')).status,404);
    });
    await t.test('expired codes, signatures from other keys, and suspended customers cannot finish pairing',async()=>{
      await pool.query('DELETE FROM customer_rate_limits');
      const key=identity(),started=await machine('start',{name:'Expiry fixture',publicKey:key.publicKey},key);
      assert.equal(started.status,201);const data={id:started.data.id,deviceSecret:started.data.deviceSecret};
      assert.equal((await machine('poll',data,identity())).status,401);
      await pool.query("UPDATE customer_server_pairings SET expires_at=now()-interval '1 minute' WHERE id=$1",[data.id]);
      assert.equal((await machine('poll',data,key)).status,410);
      assert.equal((await browser('/server-link/preview',{code:started.data.code})).status,404);
      await pool.query("UPDATE customers SET status='suspended' WHERE id=$1",[b.id]);assert.equal((await browser('/servers',null,b)).status,401);
    });
    await t.test('local endpoints require actual owner role, same-origin JSON, and owner password',async()=>{
      const localApp=express();localApp.use(express.json());
      const salt='fixture-salt',passwordHash=`scrypt:${salt}:${crypto.scryptSync('fixture-owner-password',salt,64).toString('hex')}`;
      const access=registerNextVersionRoutes({app:localApp,express,dataDir:path.join(directory,'local-auth'),readSetupConfig:()=>({adminAccount:{username:'owner',passwordHash},enabledLibraries:{movies:true}}),writeSetupConfig:()=>{},subscriptionService:subscription});
      registerLinkedAccount({app:localApp,express,service:local,access,serverName:()=> 'Auth fixture'});
      const {server,origin}=await listen(localApp);
      try {
        const send=async(action,body={},originHeader=origin)=>fetch(`${origin}/api/server-account/${action}`,{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify(body)});
        assert.equal((await send('start',{ownerPassword:'wrong'})).status,403);
        assert.equal((await send('start',{ownerPassword:'fixture-owner-password'},'https://evil.invalid')).status,403);
        assert.equal((await send('start',{ownerPassword:'fixture-owner-password'})).status,200);
        const stateFile=path.join(directory,'local-auth','next-version','accounts.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8'));
        state.authEnabled=true;await fs.writeFile(stateFile,JSON.stringify(state));
        assert.equal((await fetch(`${origin}/api/server-account`)).status,401);
      } finally {await close(server);}
    });
  } finally {local.close();await close(cloud.server);await customerService.close();await fs.rm(directory,{recursive:true,force:true});}
});
