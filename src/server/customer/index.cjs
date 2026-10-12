const {createPool,migrate}=require('./database.cjs');
const {seedDrafts}=require('./catalog.cjs');
const {configuration,cookies,digest,failure,rateLimit}=require('./security.cjs');
const {createMailer}=require('./mail.cjs');
const {createAuth}=require('./auth.cjs');
const {createBilling}=require('./billing.cjs');
const {createStripeProvider}=require('./providers/stripe.cjs');

function customerOnlyGate(req,res,next) {
  if (req.path==='/') return res.redirect(302,'/customer/pricing');
  if (/^\/(customer(?:\/|$)|api\/customer(?:\/|$)|assets\/)/.test(req.path)) return next();
  return res.status(404).json({message:'Not available on the customer service.'});
}

function mountCustomer({app,express,env=process.env,pool,provider,sendMail,background=true}) {
  const router=express.Router();
  if (env.HOMESTEAD_CUSTOMER_ENABLED!=='true') {
    router.use((req,res)=>res.status(503).json({message:'Customer accounts are not enabled on this installation.'}));
    app.use('/api/customer',router);return {ready:Promise.resolve(),close:async()=>{}};
  }
  const config=configuration(env);pool=pool || createPool(env);
  const mailer=createMailer({pool,env,send:sendMail});
  if (env.NODE_ENV==='production' && (!mailer.available || !env.HOMESTEAD_CUSTOMER_MAIL_FROM)) throw new Error('Production customer accounts require configured email delivery');
  provider=provider || (env.STRIPE_SECRET_KEY ? createStripeProvider(env) : null);
  if (env.HOMESTEAD_PAYMENT_MODE && env.HOMESTEAD_PAYMENT_MODE!=='test') throw new Error('Live payment mode is disabled');
  const ready=migrate(pool).then(()=>seedDrafts(pool));
  // Keep startup failure handled even if no customer request has arrived yet.
  let startupFailed=false;ready.catch(()=>{startupFailed=true;console.error('Customer database initialization failed. Run the migration diagnostics.');});
  const auth=createAuth({pool,config,mailer});const billing=createBilling({pool,provider,config,auth});
  router.use(async(req,res,next)=>{
    res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
    if (startupFailed) return res.status(503).json({message:'Customer database is unavailable.'});
    try {await ready;next();} catch {res.status(503).json({message:'Customer database is unavailable.'});}
  });
  // This router is mounted BEFORE the app-wide JSON parser and local-account gate.
  router.post('/webhooks/stripe',express.raw({type:'application/json',limit:'1mb'}),async(req,res,next)=>{
    try {
      if (config.secure && !req.secure) throw failure(400,'Customer webhooks require HTTPS.');
      if (!provider || provider.name!=='stripe') throw failure(503,'Stripe test webhooks are not configured.');
      const event=provider.verify(req.body,req.get('Stripe-Signature'));
      if (typeof event.id!=='string' || event.id.length>200 || typeof event.type!=='string' || event.type.length>120) throw failure(400,'Invalid event.');
      res.json(await billing.processEvent(event));
    }catch(error){next(error);}
  });
  router.use(express.json({limit:'32kb'}));
  router.get('/health',async(req,res)=>{await pool.query('SELECT 1');res.json({ok:true,mode:'test'});});
  router.use(async(req,res,next)=>{
    try {
      if (config.secure && !req.secure) throw failure(400,'Customer endpoints require HTTPS.');
      const origin=req.get('Origin');
      if (origin && origin!==config.origin) throw failure(403,'Request origin is not allowed.');
      req.customer=await auth.current(req);
      if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
        if (origin!==config.origin) throw failure(403,'A same-origin request is required.');
        const csrf=cookies(req)[config.csrfName];const supplied=req.get('X-CSRF-Token');
        if (!csrf || supplied!==csrf || (req.customer && digest(csrf)!==req.customer.csrf_hash)) throw failure(403,'Refresh the page and retry.');
      }
      const isAuth=['/login','/register','/forgot-password','/reset','/verify','/verification'].includes(req.path);
      await rateLimit(pool,`${isAuth?'auth':'api'}:${req.ip}`,isAuth?30:300,isAuth?900:60);
      if (req.customer && req.method!=='GET') await rateLimit(pool,`write:${req.customer.id}`,60,60);
      next();
    }catch(error){next(error);}
  });
  auth.register(router);billing.register(router);
  router.post('/license',async(req,res)=>{
    const customer=auth.requireVerified(req);const access=await billing.entitlements(customer.id);
    if (!access.active) throw failure(403,'No active license is available.');
    if (!env.HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY) throw failure(503,'License signing is not configured.');
    const order=['free','family','plus','pro'];
    const license=access.licenses.sort((a,b)=>order.indexOf(b.tier)-order.indexOf(a.tier))[0];
    const now=Math.floor(Date.now()/1000);const expiration=Math.min(now+86400,license.expiresAt?Math.floor(new Date(license.expiresAt).getTime()/1000):Infinity);
    const payload=Buffer.from(JSON.stringify({customerId:customer.id,tier:license.tier,notBefore:now,expiresAt:expiration})).toString('base64url');
    const signature=require('node:crypto').sign(null,Buffer.from(payload),env.HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY.replace(/\\n/g,'\n')).toString('base64url');
    res.json({token:`${payload}.${signature}`,expiresAt:new Date(expiration*1000).toISOString()});
  });
  router.use((req,res)=>res.status(404).json({message:'Customer endpoint not found.'}));
  router.use((error,req,res,next)=>{
    const status=error.status || (error.code==='23505'?409:500);
    res.status(status).json({message:error.code==='23505'?'This account or billing resource already exists.':status<500?error.message:'The request could not be completed. Please retry.'});
  });
  app.use('/api/customer',router);
  app.use('/customer',(req,res,next)=>{
    res.set('Content-Security-Policy',"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'");
    res.set('Referrer-Policy','no-referrer');res.set('Cache-Control','no-store');
    if (config.secure) res.set('Strict-Transport-Security','max-age=31536000');next();
  });
  let timer,cleanupTimer,busy=false;
  if (background) {
    timer=setInterval(async()=>{if(busy || startupFailed)return;busy=true;try{await ready;await mailer.flush();}catch{console.error('Customer mail delivery retry deferred.');}finally{busy=false;}},30000);timer.unref();
    cleanupTimer=setInterval(async()=>{try{await ready;await pool.query('DELETE FROM customer_rate_limits WHERE expires_at<now()');await pool.query('DELETE FROM customer_sessions WHERE expires_at<now()');await pool.query('DELETE FROM customer_tokens WHERE expires_at<now()');}catch{/* A later interval retries cleanup. */}},3600000);cleanupTimer.unref();
  }
  return {ready,auth,billing,mailer,close:async()=>{clearInterval(timer);clearInterval(cleanupTimer);mailer.close();await pool.end?.();}};
}
module.exports={mountCustomer,customerOnlyGate};
