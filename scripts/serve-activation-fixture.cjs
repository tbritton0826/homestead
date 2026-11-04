// Local browser QA only: isolated database, reserved test identities, no real
// Stripe calls or mail. Never start this helper as the production application.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { testPool } = require('./customer-test-support.cjs');
const { mountCustomer } = require('../src/server/customer/index.cjs');
const { hashPassword } = require('../src/server/customer/security.cjs');
const { publishCatalogRelease } = require('../src/server/customer/catalog-release.cjs');
const { createLinkedAccount, registerLinkedAccount } = require('../src/server/linked-account.cjs');
const { createSubscriptionService } = require('../src/server/subscription-entitlements.cjs');
const { registerNextVersionRoutes } = require('../src/server/next-version.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-activation-ui-'));
  const pool = await testPool(path.join(directory, 'postgres'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const cloud = express(), local = express();
  const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })); });
  const cloudHost = await listen(cloud), localHost = await listen(local);
  const env = { NODE_ENV: 'test', HOMESTEAD_CUSTOMER_ENABLED: 'true', HOMESTEAD_CUSTOMER_ORIGIN: cloudHost.origin,
    HOMESTEAD_CUSTOMER_MAIL_KEY: 'a'.repeat(64), HOMESTEAD_PAYMENT_MODE: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_fixture_only',
    HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const provider = { name: 'stripe', validatePrice: async () => {}, checkout: async () => { throw new Error('Fixture has no payment provider'); } };
  const service = mountCustomer({ app: cloud, express, pool, env, provider, sendMail: async () => {}, background: false });
  await service.ready;
  await publishCatalogRelease({ pool, provider, input: require('../deploy/customer-catalog/stripe-sandbox-v3.json'), publish: true });
  const customerId = crypto.randomUUID();
  await pool.query("INSERT INTO customers(id,email,display_name,email_verified_at) VALUES($1,'tester@example.test','Activation QA',now())", [customerId]);
  await pool.query("INSERT INTO customer_identities(customer_id,provider,subject,password_hash) VALUES($1,'password','tester@example.test',$2)", [customerId, await hashPassword('fixture-long-password')]);
  await pool.query("INSERT INTO customer_licenses(id,customer_id,plan_id,features,status,expires_at) SELECT $1,$2,id,features,'active',now()+interval '3 days' FROM customer_plans WHERE id='pro-month-v3'", [crypto.randomUUID(), customerId]);
  const linked = createLinkedAccount({ directory: path.join(directory, 'identity'), env: { NODE_ENV: 'test', HOMESTEAD_ACCOUNTS_ORIGIN: cloudHost.origin }, background: false });
  const subscription = createSubscriptionService({ env: { NODE_ENV: 'production' }, linkedLicense: linked.license });
  local.use(express.json());
  const ownerHash = `scrypt:fixture-salt:${crypto.scryptSync('fixture-owner-password', 'fixture-salt', 64).toString('hex')}`;
  const access = registerNextVersionRoutes({ app: local, express, dataDir: path.join(directory, 'local'),
    readSetupConfig: () => ({ serverName: 'Browser QA server', adminAccount: { username: 'owner', passwordHash: ownerHash }, enabledLibraries: {} }),
    writeSetupConfig: () => {}, subscriptionService: subscription });
  registerLinkedAccount({ app: local, express, service: linked, access, serverName: () => 'Browser QA server' });
  const fixtureSources = path.join(root, 'work', 'activation-ui'); await fs.mkdir(fixtureSources, { recursive: true });
  await fs.writeFile(path.join(fixtureSources, 'cloud.jsx'), "import React from 'react';import{createRoot}from'react-dom/client';import CustomerApp from'/src/customer/CustomerApp.jsx';createRoot(document.getElementById('root')).render(<CustomerApp/>);");
  await fs.writeFile(path.join(fixtureSources, 'local.jsx'), "import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from'/src/components/ServerAccountPanel.jsx';import'/src/App.css';function Fixture(){const[s,setS]=useState(null);return <main style={{maxWidth:800,margin:'40px auto',padding:24}}><h1>Local activation QA</h1><p>Current plan: {s?.name||'Homestead Free'}</p><Panel onSubscriptionChange={setS}/></main>}createRoot(document.getElementById('root')).render(<Fixture/>);");
  const { createServer } = await import('vite'); const { default: react } = await import('@vitejs/plugin-react');
  const vite = await createServer({ root, configFile: false, plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false } });
  const html = entry => async (req, res, next) => {
    try { res.type('html').send(await vite.transformIndexHtml(req.originalUrl, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/work/activation-ui/${entry}.jsx"></script></body></html>`)); } catch (error) { next(error); }
  };
  cloud.use('/customer', html('cloud')); local.get('/activation-qa', html('local'));
  cloud.use(vite.middlewares); local.use(vite.middlewares);
  console.log(JSON.stringify({ fixtureOnly: true, cloud: `${cloudHost.origin}/customer/login`, local: `${localHost.origin}/activation-qa`, email: 'tester@example.test', password: 'fixture-long-password', ownerPassword: 'fixture-owner-password' }));
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true; linked.close();
    for (const server of [cloudHost.server, localHost.server]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await vite.close(); await service.close();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('homestead-activation-ui-')) await fs.rm(directory, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(() => { console.error('Isolated activation browser fixture failed to start.'); process.exitCode = 1; });
