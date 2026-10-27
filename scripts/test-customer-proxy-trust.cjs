const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Stripe = require('stripe');
const { configureProxyTrust } = require('../src/server/customer/proxy-trust.cjs');
const { mountCustomer, customerOnlyGate } = require('../src/server/customer/index.cjs');
const { createStripeProvider } = require('../src/server/customer/providers/stripe.cjs');
const { testPool } = require('./customer-test-support.cjs');

test('customer proxy trust fails closed and refuses broad or ambiguous settings', () => {
  for (const customerMode of [{ HOMESTEAD_CUSTOMER_ENABLED: 'true' }, { HOMESTEAD_CUSTOMER_ONLY: 'true' }]) {
    const app = express();
    for (const legacy of ['true', 'loopback', 'uniquelocal', '0.0.0.0/0']) {
      configureProxyTrust(app, { ...customerMode, HOMESTEAD_TRUST_PROXY: legacy });
      assert.equal(app.get('trust proxy'), false, 'legacy media settings must not authorize customer proxies');
    }
    for (const value of ['true', 'false', '1', 'loopback', 'uniquelocal', '0.0.0.0/0', '::/0', '172.30.0.0/24',
      'cloudflared', 'homestead-accounts-public', 'https://192.0.2.10', '192.0.2.10:7312', '192.0.2.10,', ' ', 'fe80::1%eth0', true, 1]) {
      assert.throws(() => configureProxyTrust(app, { ...customerMode, HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: value }),
        /exact proxy IP addresses/);
    }
  }
});

test('customer allowlist matches exact IPv4/IPv6 peers only at the immediate hop', () => {
  const app = express();
  configureProxyTrust(app, { HOMESTEAD_CUSTOMER_ONLY: 'true', HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '192.0.2.10, 2001:db8::10' });
  const trust = app.get('trust proxy fn');
  for (const address of ['192.0.2.10', '::ffff:192.0.2.10', '2001:db8::10', '2001:0db8:0:0:0:0:0:10']) {
    assert.equal(trust(address, 0), true);
    assert.equal(trust(address, 1), false, 'addresses asserted upstream cannot extend the trust chain');
  }
  for (const address of ['192.0.2.11', '2001:db8::11', '127.0.0.1', '::1']) assert.equal(trust(address, 0), false);
});

test('media-only deployments retain their existing proxy behavior', () => {
  const app = express();
  configureProxyTrust(app, {});
  assert.equal(app.get('trust proxy'), 'loopback');
  configureProxyTrust(app, { HOMESTEAD_TRUST_PROXY: '192.0.2.25' });
  assert.equal(app.get('trust proxy fn')('192.0.2.25'), true);
});

test('real customer routes enforce the trusted proxy boundary over HTTP sockets', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-proxy-test-'));
  const pool = await testPool(path.join(directory, 'postgres'));
  const origin = 'https://accounts.example.test';
  const env = {
    NODE_ENV: 'production', HOMESTEAD_CUSTOMER_ENABLED: 'true', HOMESTEAD_CUSTOMER_ONLY: 'true',
    HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '127.0.0.1', HOMESTEAD_TRUST_PROXY: 'uniquelocal',
    HOMESTEAD_CUSTOMER_ORIGIN: origin, HOMESTEAD_CUSTOMER_MAIL_FROM: 'accounts@example.test',
    HOMESTEAD_CUSTOMER_MAIL_KEY: 'a'.repeat(64), HOMESTEAD_PAYMENT_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET: 'whsec_fixture_only',
  };
  const app = express();
  configureProxyTrust(app, env);
  app.use(customerOnlyGate);
  const mail = [];
  const provider = createStripeProvider(env, { webhooks: Stripe.webhooks });
  const service = mountCustomer({ app, express, env, pool, provider, sendMail: async message => mail.push(message), background: false });
  // This matches the application's parser order: webhook signatures need raw bytes.
  app.use(express.json());
  app.get('/customer/proxy-fixture', (req, res) => res.json({ secure: req.secure, ip: req.ip }));
  let server;
  try {
    await service.ready;
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const jar = {};
    async function request(route, body, headers = {}) {
      const response = await fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https',
          'X-Forwarded-For': '203.0.113.20', 'X-CSRF-Token': jar.csrf || '', Cookie: jar.cookie || '', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookies = response.headers.getSetCookie();
      for (const value of setCookies) {
        const pair = value.split(';')[0], index = pair.indexOf('=');
        jar.pairs ||= {}; jar.pairs[pair.slice(0, index)] = pair.slice(index + 1);
      }
      jar.cookie = Object.entries(jar.pairs || {}).map(([key, value]) => `${key}=${value}`).join('; ');
      const data = await response.json();
      if (data.csrfToken) jar.csrf = data.csrfToken;
      return { status: response.status, data, setCookies };
    }

    await t.test('trusted tunnel HTTPS reaches real session routes and issues secure host cookies', async () => {
      const response = await request('/api/customer/session');
      assert.equal(response.status, 200);
      assert.equal(response.data.customer, null);
      assert.match(response.setCookies[0], /^__Host-homestead_customer_csrf=/);
      assert.match(response.setCookies[0], /; Secure/);
      assert.match(response.setCookies[0], /; HttpOnly/);
      assert.match(response.setCookies[0], /; SameSite=Lax/);
      assert.match(response.setCookies[0], /; Path=\//);
      assert.doesNotMatch(response.setCookies[0], /Domain=/i);
      const probe = await request('/customer/proxy-fixture', undefined, { 'X-Forwarded-For': '198.51.100.99, 203.0.113.20' });
      assert.deepEqual(probe.data, { secure: true, ip: '203.0.113.20' }, 'client-supplied leftmost addresses do not extend the single-hop boundary');
    });

    await t.test('missing or non-HTTPS protocol still fails behind the trusted tunnel', async () => {
      for (const protocol of ['', 'http', 'invalid']) {
        const response = await request('/api/customer/session', undefined, { 'X-Forwarded-Proto': protocol });
        assert.equal(response.status, 400);
        assert.equal(response.data.message, 'Customer endpoints require HTTPS.');
        assert.deepEqual(response.setCookies, []);
      }
    });

    await t.test('untrusted socket cannot spoof HTTPS with forwarded, Cloudflare, host or client headers', async () => {
      configureProxyTrust(app, { ...env, HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '192.0.2.10' });
      for (const headers of [
        { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.10' },
        { 'X-Forwarded-Proto': 'https, http', 'X-Forwarded-For': '203.0.113.20, 192.0.2.10' },
        { Forwarded: 'for=203.0.113.20;proto=https', 'CF-Visitor': '{"scheme":"https"}',
          'CF-Connecting-IP': '192.0.2.10', 'X-Forwarded-Host': 'accounts.example.test' },
      ]) {
        const response = await request('/api/customer/session', undefined, headers);
        assert.equal(response.status, 400);
        assert.equal(response.data.message, 'Customer endpoints require HTTPS.');
        assert.deepEqual(response.setCookies, []);
      }
      assert.deepEqual((await request('/customer/proxy-fixture')).data, { secure: false, ip: '127.0.0.1' });
      configureProxyTrust(app, { ...env, HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '' });
      assert.equal((await request('/api/customer/session')).status, 400, 'empty allowlist ignores even loopback forwarded headers');
      configureProxyTrust(app, env);
    });

    await t.test('trusted HTTPS keeps origin, CSRF, authentication and email verification checks', async () => {
      assert.equal((await request('/api/customer/dashboard')).status, 401);
      const account = { email: 'proxy@example.test', displayName: 'Proxy fixture', password: 'fixture-long-password' };
      assert.equal((await request('/api/customer/register', account, { Origin: 'https://evil.example.test' })).status, 403);
      assert.equal((await request('/api/customer/register', account, { 'X-CSRF-Token': '' })).status, 403);
      assert.equal((await request('/api/customer/register', account)).status, 201);
      const login = await request('/api/customer/login', account);
      assert.equal(login.status, 200);
      assert.match(login.setCookies[0], /^__Host-homestead_customer=/);
      assert.ok(login.setCookies.every(cookie => cookie.includes('; Secure') && cookie.includes('; HttpOnly')));
      assert.equal((await request('/api/customer/license', {})).data.message, 'Verify your email before selecting a plan.');
      await service.mailer.flush();
      const token = new URL(mail[0].text.match(/https:\/\/\S+/)[0]).hash.slice(7);
      assert.equal((await request('/api/customer/verify', { token })).status, 200);
      assert.equal((await request('/api/customer/session')).data.customer.emailVerified, true);
      assert.equal((await request('/api/customer/license', {})).data.message, 'No active license is available.');
      configureProxyTrust(app, { ...env, HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '192.0.2.10' });
      assert.equal((await request('/api/customer/session')).status, 400, 'an existing authenticated session cannot bypass HTTPS enforcement');
      configureProxyTrust(app, env);
      assert.equal((await request('/api/customer/session')).data.customer.email, account.email, 'account and session survive trust configuration changes');
    });

    await t.test('Stripe raw-body signatures remain required and untrusted HTTPS spoofing fails before verification', async () => {
      const payload = JSON.stringify({ id: 'evt_proxy_fixture', type: 'fixture.unhandled', livemode: false, data: { object: {} } }, null, 2);
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
      async function webhook(sig, protocol = 'https') {
        const response = await fetch(base + '/api/customer/webhooks/stripe', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': protocol, 'Stripe-Signature': sig }, body: payload });
        return { status: response.status, data: await response.json() };
      }
      assert.equal((await webhook('invalid')).status, 400);
      assert.equal((await webhook(signature, 'http')).data.message, 'Customer webhooks require HTTPS.');
      configureProxyTrust(app, { ...env, HOMESTEAD_CUSTOMER_TRUSTED_PROXIES: '192.0.2.10' });
      assert.equal((await webhook(signature)).data.message, 'Customer webhooks require HTTPS.');
      configureProxyTrust(app, env);
      const accepted = await webhook(signature);
      assert.equal(accepted.status, 200);
      assert.equal(accepted.data.ignored, true);
      assert.equal((await pool.query('SELECT * FROM customer_payment_events')).rows.length, 1);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
