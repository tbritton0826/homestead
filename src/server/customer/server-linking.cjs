const crypto = require('node:crypto');
const {transaction} = require('./database.cjs');
const {failure, text, digest, randomToken, rateLimit} = require('./security.cjs');
const {publicIdentity, validProof} = require('../server-link-proof.cjs');
const {licenseSigningKey}=require('./license-signing.cjs');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const safeServer = row => ({id:row.id, name:row.name, fingerprint:row.fingerprint,
  linkedAt:row.linked_at, lastSeenAt:row.last_seen_at, revokedAt:row.revoked_at});

function createServerLinking({pool, env, config, auth, billing}) {
  function signingKey() {
    return licenseSigningKey(env);
  }
  function publicKey() { return crypto.createPublicKey(signingKey()).export({type:'spki',format:'pem'}); }
  async function prove(db, action, body, row) {
    if (body.installationId !== row.installation_id || !validProof(action, body, row.public_key)) throw failure(401, 'Server identity could not be verified.');
    const inserted = await db.query(`INSERT INTO customer_server_nonces(fingerprint,nonce,expires_at) VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT DO NOTHING RETURNING nonce`, [row.fingerprint,body.nonce]);
    if (!inserted.rows.length) throw failure(409, 'This server request was already used. Retry with a new request.');
  }
  async function grant(row, db) {
    const customer = (await db.query("SELECT id,email,display_name FROM customers WHERE id=$1 AND status='active'", [row.customer_id])).rows[0];
    if (!customer || row.revoked_at) throw failure(403, 'This server link was removed. Link the server again.');
    const access = await billing.entitlements(customer.id, db);
    const license = access.effectiveLicense;
    const now = Math.floor(Date.now()/1000);
    const expiresAt = Math.min(now+86400, license?.expiresAt ? Math.floor(new Date(license.expiresAt).getTime()/1000) : Infinity);
    const payload = Buffer.from(JSON.stringify({audience:'homestead-linked-server', mode:'test',
      serverId:row.id, installationId:row.installation_id, fingerprint:row.fingerprint,
      customerId:customer.id, licenseId:license?.id || null, tier:license?.tier || 'free',
      subscriptionId:license?.subscriptionId || null, notBefore:now, expiresAt})).toString('base64url');
    const token = `${payload}.${crypto.sign(null,Buffer.from(payload),signingKey()).toString('base64url')}`;
    return {server:safeServer(row), account:{id:customer.id,email:customer.email,displayName:customer.display_name}, token};
  }
  function machineRoutes(router) {
    router.use('/linking', async(req,res,next) => {
      try {
        if (config.secure && !req.secure) throw failure(400, 'Server linking requires HTTPS.');
        if (req.get('Origin') && req.get('Origin') !== config.origin) throw failure(403, 'Request origin is not allowed.');
        if (req.method==='POST' && (!req.body || typeof req.body!=='object' || Array.isArray(req.body))) throw failure(400,'A JSON server request is required.');
        // These routes never read browser cookies. Every write proves possession of a server key.
        await rateLimit(pool, `server-link-ip:${req.ip}`, 120, 60);
        next();
      } catch(error) {next(error);}
    });
    router.get('/linking/metadata', (req,res) => res.json({mode:'test',publicKey:publicKey(),verificationUrl:`${config.origin}/customer/servers`}));
    router.post('/linking/start', async(req,res) => {
      await rateLimit(pool, `server-link-start:${req.ip}`, 5, 60);
      const body = req.body;
      let key; try {key=publicIdentity(body.data?.publicKey);} catch {throw failure(400, 'Invalid server identity.');}
      const name = text(body.data?.name,1,100,'server name');
      if (!uuid(body.installationId)) throw failure(400, 'Invalid installation identity.');
      await rateLimit(pool, `server-link-key:${key.fingerprint}`, 20, 3600);
      publicKey(); // Fail before issuing a code if activation cannot be signed.
      const id=crypto.randomUUID(), deviceSecret=randomToken();
      const code=crypto.randomBytes(6).toString('hex').toUpperCase();
      await transaction(pool, async db => {
        await prove(db,'start',body,{installation_id:body.installationId,public_key:key.publicKey,fingerprint:key.fingerprint});
        await db.query(`INSERT INTO customer_server_pairings(id,code_hash,device_hash,installation_id,public_key,fingerprint,name,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`, [id,digest(code),digest(deviceSecret),body.installationId,key.publicKey,key.fingerprint,name]);
      });
      res.status(201).json({id,deviceSecret,code:code.match(/.{4}/g).join('-'),expiresAt:new Date(Date.now()+600000).toISOString(),interval:5});
    });
    async function pairing(db, body, action) {
      if (!uuid(body.data?.id) || typeof body.data?.deviceSecret !== 'string') throw failure(400, 'Invalid pairing request.');
      const row=(await db.query('SELECT * FROM customer_server_pairings WHERE id=$1 FOR UPDATE',[body.data.id])).rows[0];
      if (!row || row.device_hash!==digest(body.data.deviceSecret) || new Date(row.expires_at)<=new Date()) throw failure(410, 'The linking code expired. Start again on your server.');
      await prove(db,action,body,row);
      await rateLimit(db, `server-link-poll:${row.id}`, 15, 60);
      return row;
    }
    router.post('/linking/poll', async(req,res) => {
      const result=await transaction(pool,async db => {
        const row=await pairing(db,req.body,'poll');
        const account=row.customer_id ? (await db.query("SELECT id,email,display_name FROM customers WHERE id=$1 AND status='active'",[row.customer_id])).rows[0] : null;
        return {status:account?'approved':'pending',account:account?{id:account.id,email:account.email,displayName:account.display_name}:null};
      });res.json(result);
    });
    router.post('/linking/complete', async(req,res) => {
      const result=await transaction(pool,async db => {
        const row=await pairing(db,req.body,'complete');
        if (!row.customer_id || row.customer_id!==req.body.data.customerId) throw failure(409, 'Confirm the approved account on your server.');
        if (row.server_id) {
          const existing=(await db.query('SELECT * FROM customer_servers WHERE id=$1 FOR UPDATE',[row.server_id])).rows[0];
          if (!existing || existing.customer_id!==row.customer_id) throw failure(403,'Start a new server link.');
          return grant(existing,db);
        }
        // Unique key plus guarded upsert makes overlapping completions safe across accounts.
        const server=(await db.query(`INSERT INTO customer_servers(id,customer_id,installation_id,public_key,fingerprint,name,last_seen_at)
          VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(fingerprint) DO UPDATE SET customer_id=excluded.customer_id,
          installation_id=excluded.installation_id,name=excluded.name,revoked_at=NULL,linked_at=now(),last_seen_at=now()
          WHERE customer_servers.revoked_at IS NOT NULL OR customer_servers.customer_id=excluded.customer_id RETURNING *`,
          [crypto.randomUUID(),row.customer_id,row.installation_id,row.public_key,row.fingerprint,row.name])).rows[0];
        if (!server) throw failure(409, 'Unlink this server from its current account before linking another account.');
        await db.query('UPDATE customer_server_pairings SET server_id=$1 WHERE id=$2',[server.id,row.id]);
        return grant(server,db);
      });res.json(result);
    });
    for (const action of ['refresh','unlink']) router.post(`/linking/${action}`, async(req,res) => {
      const result=await transaction(pool,async db => {
        if (!uuid(req.body.data?.serverId)) throw failure(400, 'Invalid server.');
        const row=(await db.query('SELECT * FROM customer_servers WHERE id=$1 FOR UPDATE',[req.body.data.serverId])).rows[0];
        if (!row) throw failure(403, 'This server link is no longer available.');
        await prove(db,action,req.body,row);
        if (action==='unlink') {await db.query('UPDATE customer_servers SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1',[row.id]);return {ok:true};}
        const value=await grant(row,db);
        await db.query('UPDATE customer_servers SET last_seen_at=now() WHERE id=$1',[row.id]);
        return value;
      });res.json(result);
    });
  }
  function browserRoutes(router) {
    router.get('/servers',async(req,res) => {
      const customer=auth.requireVerified(req);
      res.json({servers:(await pool.query('SELECT * FROM customer_servers WHERE customer_id=$1 ORDER BY linked_at DESC LIMIT 100',[customer.id])).rows.map(safeServer)});
    });
    async function fromCode(req,db) {
      const customer=auth.requireVerified(req);
      const code=text(req.body?.code,12,14,'linking code').replace(/-/g,'').toUpperCase();
      if (!/^[A-F0-9]{12}$/.test(code)) throw failure(400,'Enter the code shown on your server.');
      const row=(await db.query('SELECT * FROM customer_server_pairings WHERE code_hash=$1 FOR UPDATE',[digest(code)])).rows[0];
      if (!row || row.server_id || new Date(row.expires_at)<=new Date() || (row.customer_id && row.customer_id!==customer.id)) throw failure(404,'This linking code is unavailable or expired. Start again on your server.');
      return {row,customer};
    }
    router.use('/server-link',async(req,res,next)=>{
      try {await rateLimit(pool,`pairing-code:${auth.requireVerified(req).id}`,10,60);next();} catch(error){next(error);}
    });
    router.post('/server-link/preview',async(req,res) => res.json(await transaction(pool,async db => {
      const {row}=await fromCode(req,db);return {name:row.name,fingerprint:row.fingerprint,expiresAt:row.expires_at};
    })));
    router.post('/server-link/approve',async(req,res) => res.json(await transaction(pool,async db => {
      const {row,customer}=await fromCode(req,db);
      if (req.body.fingerprint!==row.fingerprint) throw failure(409,'Review this server before linking it.');
      await db.query('UPDATE customer_server_pairings SET customer_id=$1 WHERE id=$2',[customer.id,row.id]);
      return {ok:true,message:'Approved. Return to your Homestead server and confirm this account.'};
    })));
    router.delete('/servers/:id',async(req,res) => {
      const customer=auth.requireVerified(req);
      if (!uuid(req.params.id)) throw failure(404,'Server not found.');
      const result=await pool.query('UPDATE customer_servers SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND customer_id=$2 RETURNING id',[req.params.id,customer.id]);
      if (!result.rows.length) throw failure(404,'Server not found.');
      res.json({ok:true,message:'Server unlinked. Offline access ends when its current activation expires, within 24 hours.'});
    });
  }
  return {machineRoutes,browserRoutes};
}
module.exports={createServerLinking};
