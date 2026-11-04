const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSubscriptionService, verifyLicenseToken } = require('../src/server/subscription-entitlements.cjs');
const { createLinkedAccount } = require('../src/server/linked-account.cjs');
const { initializeSigningKey, licenseSigningKey } = require('../src/server/customer/license-signing.cjs');
const { customerReadiness } = require('../src/server/customer/readiness.cjs');
const { migrate } = require('../src/server/customer/database.cjs');
const { seedDrafts } = require('../src/server/customer/catalog.cjs');
const { publishCatalogRelease } = require('../src/server/customer/catalog-release.cjs');
const reviewed = require('../deploy/customer-catalog/stripe-sandbox-v3.json');
const { testPool } = require('./customer-test-support.cjs');

function identity() {
  const keys = crypto.generateKeyPairSync('ed25519');
  return { installationId: crypto.randomUUID(), privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
}
function signed(key, claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${crypto.sign(null, Buffer.from(payload), key.privateKey).toString('base64url')}`;
}

test('linking migration upgrades existing accounts and published catalog without changing historical rows', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-link-upgrade-'));
  const pool = await testPool(path.join(directory, 'postgres'));
  try {
    await pool.query('CREATE TABLE customer_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const migrations = path.join(__dirname, '../src/server/customer/migrations');
    for (const name of (await fs.readdir(migrations)).filter(name => /^00[12]-/.test(name)).sort()) {
      const sql = await fs.readFile(path.join(migrations, name), 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO customer_schema_migrations(name,checksum) VALUES($1,$2)', [name, crypto.createHash('sha256').update(sql).digest('hex')]);
    }
    await seedDrafts(pool);
    await publishCatalogRelease({ pool, provider: { name: 'stripe', validatePrice: async () => {} }, input: reviewed, publish: true });
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO customers(id,email,display_name,email_verified_at) VALUES($1,'existing@example.test','Existing account',now())", [id]);
    await pool.query("INSERT INTO customer_identities(customer_id,provider,subject,password_hash) VALUES($1,'password','existing@example.test','existing-password-hash')", [id]);
    await pool.query("INSERT INTO customer_licenses(id,customer_id,plan_id,features,status,expires_at) VALUES($1,$2,'family-month-v3','[]','active',now()+interval '1 day')", [crypto.randomUUID(), id]);
    const tables = ['customers', 'customer_identities', 'customer_plans', 'customer_provider_prices', 'customer_licenses'];
    const snapshotRows = async table => (await pool.query(`SELECT row_to_json(t)::text AS value FROM ${table} t ORDER BY value`)).rows;
    const before = await Promise.all(tables.map(snapshotRows));
    await migrate(pool); await migrate(pool);
    const after = await Promise.all(tables.map(snapshotRows));
    assert.deepEqual(after, before);
    assert.equal((await pool.query('SELECT name FROM customer_schema_migrations')).rows.length, 3);
    assert.equal((await pool.query('SELECT * FROM customer_servers')).rows.length, 0);
  } finally { await pool.end(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('running installation enforces manual license expiry, feature gates and stream limits without restart', () => {
  const key = identity(); let clock = 1700000000000;
  const env = { NODE_ENV: 'production', HOMESTEAD_LICENSE_PUBLIC_KEY: key.publicKey,
    HOMESTEAD_LICENSE_TOKEN: signed(key, { tier: 'family', notBefore: clock / 1000 - 1, expiresAt: clock / 1000 + 1.5 }) };
  const service = createSubscriptionService({ env, now: () => clock });
  assert.equal(service.status().tier, 'family'); assert.equal(service.has('familyLibrary'), true);
  clock += 1499; assert.equal(service.status().tier, 'family');
  clock += 1; assert.equal(service.status().tier, 'free'); assert.equal(service.has('familyLibrary'), false);
  assert.equal(service.allowsLibrary('family'), false);
  assert.equal(service.claimStream({ clientId: 'one', mediaKey: 'fixture' }).allowed, true);
  assert.equal(service.claimStream({ clientId: 'two', mediaKey: 'fixture' }).allowed, false);
  let failure;
  service.requireFeature('familyLibrary')({}, { status(code) { assert.equal(code, 402); return this; }, json(body) { failure = body; } }, () => assert.fail('expired feature granted'));
  assert.equal(failure.currentTier, 'free');
  assert.equal(verifyLicenseToken(env.HOMESTEAD_LICENSE_TOKEN, key.publicKey, clock), null);
  env.HOMESTEAD_LICENSE_TOKEN = signed(key, { tier: 'plus', expiresAt: clock / 1000 + 60 });
  assert.equal(service.status().tier, 'plus'); assert.equal(service.has('cloud'), true);
});

test('bound activation cannot be installed as a portable environment license; legacy perpetual licenses still work', () => {
  const key = identity();
  const env = { NODE_ENV: 'production', HOMESTEAD_LICENSE_PUBLIC_KEY: key.publicKey,
    HOMESTEAD_LICENSE_TOKEN: signed(key, { tier: 'pro', audience: 'homestead-linked-server', expiresAt: Date.now() / 1000 + 60 }) };
  assert.equal(createSubscriptionService({ env }).status().tier, 'free');
  env.HOMESTEAD_LICENSE_TOKEN = signed(key, { tier: 'pro', productKind: 'one_time' });
  assert.equal(createSubscriptionService({ env }).status().tier, 'pro');
});

test('damaged account or identity files refuse every mutation and preserve original bytes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-storage-guard-'));
  try {
    for (const [index, fixture] of [
      { file: 'account.json', value: '{ invalid json' },
      { file: 'account.json', value: 'null' },
      { file: 'account.json', value: '[]' },
      { file: 'account.json', value: JSON.stringify({ server: { id: crypto.randomUUID() } }) },
      { file: 'identity.json', value: JSON.stringify({ installationId: crypto.randomUUID(), publicKey: identity().publicKey, privateKey: identity().privateKey }) },
      { file: 'identity.json', value: '{ damaged identity' },
    ].entries()) {
      const folder = path.join(directory, String(index)); await fs.mkdir(folder);
      const file = path.join(folder, fixture.file); await fs.writeFile(file, fixture.value);
      let requests = 0;
      const service = createLinkedAccount({ directory: folder, env: { NODE_ENV: 'test' }, background: false,
        fetchImpl: async () => { requests++; throw new Error('Network forbidden'); } });
      try {
        assert.equal(service.status().activation, 'free'); assert.match(service.status().message, /Restore its backup/);
        for (const action of [() => service.begin('Fixture'), () => service.poll(), () => service.confirm('fixture'), () => service.refresh(), () => service.unlink()])
          await assert.rejects(action(), /Restore its backup/);
        assert.equal(requests, 0); assert.equal(await fs.readFile(file, 'utf8'), fixture.value);
        assert.deepEqual(await fs.readdir(folder), [fixture.file]);
      } finally { service.close(); }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('Free startup creates no identity, and concurrent first pairing never replaces an existing installation key', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-identity-guard-'));
  const folder = path.join(directory, 'not-created'); const signer = identity();
  const env = { NODE_ENV: 'test', HOMESTEAD_ACCOUNTS_ORIGIN: 'http://localhost:7312' };
  const observed = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/metadata')) return Response.json({ mode: 'test', publicKey: signer.publicKey });
    const proof = JSON.parse(options.body); observed.push(proof.installationId);
    throw new Error('Fixture stops before pairing is saved');
  };
  const a = createLinkedAccount({ directory: folder, env, background: false, fetchImpl });
  const b = createLinkedAccount({ directory: folder, env, background: false, fetchImpl });
  try {
    assert.equal(a.status().activation, 'free'); await assert.rejects(fs.stat(folder), { code: 'ENOENT' });
    await Promise.allSettled([a.begin('A'), b.begin('B')]);
    assert.equal(observed.length, 2); assert.equal(observed[0], observed[1]);
    const saved = await fs.readFile(path.join(folder, 'identity.json'), 'utf8');
    assert.equal(JSON.parse(saved).installationId, observed[0]);
    await assert.rejects(a.begin('Retry'));
    assert.equal(await fs.readFile(path.join(folder, 'identity.json'), 'utf8'), saved);
  } finally { a.close(); b.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('signing initialization is exclusive, validates Ed25519, and preserves configured keys', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-signing-guard-'));
  try {
    const env = { HOMESTEAD_DATA_DIR: directory }; const file = initializeSigningKey(env);
    assert.equal(licenseSigningKey(env).asymmetricKeyType, 'ed25519');
    const original = await fs.readFile(file, 'utf8');
    assert.throws(() => initializeSigningKey(env), { code: 'EEXIST' });
    assert.equal(await fs.readFile(file, 'utf8'), original);
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    const key = identity(); const configured = { ...env, HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY: key.privateKey.replace(/\n/g, '\\n') };
    assert.equal(crypto.createPublicKey(licenseSigningKey(configured)).export({ type: 'spki', format: 'pem' }), key.publicKey);
    assert.throws(() => initializeSigningKey(configured), /already configured/);
    assert.throws(() => licenseSigningKey({ ...env, HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY: 'invalid' }), /not configured correctly/);
    assert.equal(await fs.readFile(file, 'utf8'), original);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('readiness validates current six-price V3 release, leaves optional lifetime disabled, and never writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-readiness-'));
  const pool = await testPool(path.join(directory, 'postgres'));
  const key = identity();
  const env = { NODE_ENV: 'production', HOMESTEAD_CUSTOMER_ENABLED: 'true', HOMESTEAD_CUSTOMER_ONLY: 'true',
    HOMESTEAD_CUSTOMER_ORIGIN: 'https://accounts.example.test', HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '192.0.2.10',
    HOMESTEAD_CUSTOMER_SMTP_URL: 'smtps://mail.example.test:465', HOMESTEAD_CUSTOMER_MAIL_FROM: 'accounts@example.test',
    HOMESTEAD_CUSTOMER_MAIL_KEY: 'a'.repeat(64), HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY: key.privateKey,
    STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET: 'whsec_fixture_only', HOMESTEAD_PAYMENT_MODE: 'test' };
  let rejectPrice = false;
  const provider = { name: 'stripe', async validatePrice(plan) {
    if (rejectPrice || !reviewed.plans.some(w => w.priceId === plan.priceId && w.amount === plan.amount && w.interval === plan.billingInterval)) throw new Error('Fixture price unavailable');
  } };
  try {
    await migrate(pool); await seedDrafts(pool);
    const readOnly = { async query(sql, values) { assert.match(sql, /^SELECT /); return pool.query(sql, values); } };
    assert.equal((await customerReadiness({ pool: readOnly, env, provider })).checks.approvedPriceMappings, false);
    await publishCatalogRelease({ pool, provider, input: reviewed, publish: true });
    const before = (await pool.query('SELECT count(*) AS count FROM customer_plans')).rows[0].count;
    const result = await customerReadiness({ pool: readOnly, env, provider });
    assert.equal(result.ready, true); assert.equal(result.plans.length, 6); assert.ok(result.plans.every(p => p.id.endsWith('-v3') && p.ready));
    assert.equal((await pool.query("SELECT active FROM customer_plans WHERE id='pro-none-v2'")).rows[0].active, false);
    assert.equal((await pool.query('SELECT count(*) AS count FROM customer_plans')).rows[0].count, before);
    assert.equal(JSON.stringify(result).includes(key.privateKey), false);
    rejectPrice = true; assert.equal((await customerReadiness({ pool: readOnly, env, provider })).checks.approvedPriceMappings, false); rejectPrice = false;
    const missing = await customerReadiness({ pool: readOnly, env: { ...env, STRIPE_WEBHOOK_SECRET: '', HOMESTEAD_CUSTOMER_LICENSE_PRIVATE_KEY: 'invalid' }, provider });
    assert.equal(missing.ready, false); assert.equal(missing.checks.signingReady, false); assert.equal(missing.checks.stripeWebhook, false);
    await pool.query("INSERT INTO customer_plans(id,tier,version,name,amount,currency,billing_interval,product_kind,active,draft,features) VALUES('family-month-v4','family',4,'Future Family',699,'usd','month','subscription',false,true,'[]')");
    assert.equal((await customerReadiness({ pool: readOnly, env, provider })).checks.approvedPriceMappings, false, 'a newer unready plan must not be hidden by historical mappings');
  } finally { await pool.end(); await fs.rm(directory, { recursive: true, force: true }); }
});
