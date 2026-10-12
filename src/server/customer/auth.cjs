const crypto = require('node:crypto');
const { transaction } = require('./database.cjs');
const security = require('./security.cjs');
const { randomToken, digest, failure, text, email, password, hashPassword, verifyPassword, cookies, setCookie, rateLimit } = security;
const publicCustomer = row => ({ id: row.id, email: row.email, displayName: row.display_name,
  emailVerified: Boolean(row.email_verified_at), preferences: row.preferences, createdAt: row.created_at });

function createAuth({ pool, config, mailer }) {
  async function current(req) {
    const token = cookies(req)[config.sessionName];
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    return (await pool.query(`SELECT c.*,s.csrf_hash FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND c.status='active'`, [digest(token)])).rows[0] || null;
  }
  async function issueSession(db, res, customerId) {
    const token = randomToken(); const csrf = randomToken();
    await db.query("INSERT INTO customer_sessions(token_hash,customer_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')", [digest(token),customerId,digest(csrf)]);
    setCookie(res,config.sessionName,token,config); setCookie(res,config.csrfName,csrf,config);
    return csrf;
  }
  async function queueToken(db, customer, purpose) {
    const token = randomToken();
    await db.query('DELETE FROM customer_tokens WHERE customer_id=$1 AND purpose=$2', [customer.id,purpose]);
    await db.query("INSERT INTO customer_tokens(token_hash,customer_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [digest(token),customer.id,purpose]);
    // Fragment prevents reset/verification tokens being sent in GET URLs or access logs.
    const url = `${config.origin}/customer/${purpose === 'verify' ? 'verify' : 'reset'}#token=${token}`;
    await mailer.enqueue(db, { to: customer.email, subject: purpose === 'verify' ? 'Verify your Homestead email' : 'Reset your Homestead password',
      text: `${purpose === 'verify' ? 'Verify your email' : 'Reset your password'}: ${url}\nThis link expires in one hour. If you did not request it, ignore this email.` });
  }
  function requireCustomer(req) { if (!req.customer) throw failure(401,'Sign in to your customer account.'); return req.customer; }
  function requireVerified(req) { const customer = requireCustomer(req); if (!customer.email_verified_at) throw failure(403,'Verify your email before selecting a plan.'); return customer; }
  function register(router) {
    router.get('/session', async (req,res) => {
      let csrf = cookies(req)[config.csrfName];
      if (!csrf || !/^[\w-]{43}$/.test(csrf) || (req.customer && digest(csrf) !== req.customer.csrf_hash)) {
        csrf = randomToken(); setCookie(res,config.csrfName,csrf,config);
        if (req.customer) await pool.query('UPDATE customer_sessions SET csrf_hash=$1 WHERE token_hash=$2', [digest(csrf),digest(cookies(req)[config.sessionName])]);
      }
      res.json({ customer: req.customer ? publicCustomer(req.customer) : null, csrfToken: csrf, emailDeliveryAvailable: mailer.available });
    });
    router.post('/register', async (req,res) => {
      if (!mailer.available) throw failure(503,'Email delivery must be configured before registration.');
      const address=email(req.body.email), name=text(req.body.displayName,1,100,'display name');
      const hashed=await hashPassword(password(req.body.password));
      await transaction(pool,async db => {
        const id=crypto.randomUUID();
        const customer=(await db.query('INSERT INTO customers(id,email,display_name) VALUES($1,$2,$3) RETURNING *',[id,address,name])).rows[0];
        await db.query("INSERT INTO customer_identities(customer_id,provider,subject,password_hash) VALUES($1,'password',$2,$3)",[id,address,hashed]);
        await queueToken(db,customer,'verify');
      });
      res.status(201).json({ message:'Account created. Check your email to verify it, then sign in.' });
    });
    router.post('/login',async(req,res)=> {
      const address=email(req.body.email); const supplied=req.body.password;
      if (typeof supplied!=='string' || !supplied.length || Buffer.byteLength(supplied)>256) throw failure(400,'Invalid password.');
      await rateLimit(pool,`login-email:${address}`,15);
      const session=await transaction(pool,async db=> {
        // Lock the identity through verification and session creation so a concurrent
        // password reset cannot leave a newly issued session using an old password.
        const customer=(await db.query("SELECT c.*,i.password_hash FROM customers c JOIN customer_identities i ON c.id=i.customer_id WHERE i.provider='password' AND i.subject=$1 FOR UPDATE OF c,i",[address])).rows[0];
        if (!await verifyPassword(supplied,customer?.password_hash) || customer?.status!=='active') throw failure(401,'Invalid email or password.');
        await db.query('DELETE FROM customer_sessions WHERE token_hash=$1 OR expires_at<now()',[digest(cookies(req)[config.sessionName] || '')]);
        return {customer:publicCustomer(customer),csrfToken:await issueSession(db,res,customer.id)};
      });
      res.json(session);
    });
    router.post('/logout',async(req,res)=> {
      await pool.query('DELETE FROM customer_sessions WHERE token_hash=$1',[digest(cookies(req)[config.sessionName] || '')]);
      setCookie(res,config.sessionName,'',config,0);setCookie(res,config.csrfName,'',config,0);res.json({ok:true});
    });
    router.post('/verification',async(req,res)=> {
      const customer=requireCustomer(req);
      if (!mailer.available) throw failure(503,'Email delivery is unavailable.');
      if (!customer.email_verified_at) await transaction(pool,db=>queueToken(db,customer,'verify'));
      res.json({message:'Check your email for a verification link.'});
    });
    router.post('/forgot-password',async(req,res)=> {
      const address=email(req.body.email);
      if (!mailer.available) throw failure(503,'Email delivery is unavailable.');
      await rateLimit(pool,`reset-email:${address}`,3);
      await transaction(pool,async db=> {
        const customer=(await db.query("SELECT * FROM customers WHERE email=$1 AND status='active'",[address])).rows[0];
        if (customer) await queueToken(db,customer,'reset');
      });
      res.json({message:'If an active account matches, a reset email will be sent.'});
    });
    for (const purpose of ['verify','reset']) router.post(`/${purpose}`,async(req,res)=> {
      const token=text(req.body.token,43,43,'link');
      const hashed=purpose==='reset' ? await hashPassword(password(req.body.password)) : null;
      await transaction(pool,async db=> {
        const record=(await db.query('DELETE FROM customer_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING customer_id',[digest(token),purpose])).rows[0];
        if (!record) throw failure(400,'This link is invalid or expired.');
        if (purpose==='verify') await db.query("UPDATE customers SET email_verified_at=now(),updated_at=now() WHERE id=$1 AND status='active'",[record.customer_id]);
        else {
          await db.query("UPDATE customer_identities SET password_hash=$1 WHERE customer_id=$2 AND provider='password'",[hashed,record.customer_id]);
          await db.query('DELETE FROM customer_sessions WHERE customer_id=$1',[record.customer_id]);
          await db.query('DELETE FROM customer_tokens WHERE customer_id=$1',[record.customer_id]);
        }
      });res.json({message:purpose==='verify'?'Email verified. You can sign in.':'Password updated. Sign in again.'});
    });
    router.patch('/profile',async(req,res)=> {
      const customer=requireCustomer(req);const name=text(req.body.displayName,1,100,'display name');
      const preferences={};
      if (req.body.preferences?.theme) preferences.theme=text(req.body.preferences.theme,1,20,'theme');
      if (req.body.preferences?.locale) preferences.locale=text(req.body.preferences.locale,1,40,'locale');
      const updated=(await pool.query('UPDATE customers SET display_name=$1,preferences=$2,updated_at=now() WHERE id=$3 RETURNING *',[name,JSON.stringify(preferences),customer.id])).rows[0];
      res.json({customer:publicCustomer(updated)});
    });
  }
  return { current, register, requireCustomer, requireVerified };
}
module.exports={createAuth,publicCustomer};
