const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createTcgPriceLookup, registerTcgPriceLookup, selectQuote } = require('../src/server/tcg-price-lookup.cjs');
const input = { cardName: 'Vision with Eyes of Blue', setCode: 'BACH-EN050', rarity: 'Super Rare', edition: '1st Edition', condition: 'Near Mint', language: 'English' };
const card = { id: 'fixture-card', name: input.cardName, number: input.setCode, rarity: input.rarity, variant: '1st Edition', game: { slug: 'yugioh' }, prices: { raw: { near_mint: { tcgplayer: { market: 3.25 } }, lightly_played: { tcgplayer: { market: 2.5 } } } } };
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-pricing-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let count = 0;
  const file = path.join(directory, 'pricing.json');
  const service = createTcgPriceLookup({ file, interval: 0, environmentKey: () => '', fetchImpl: async (url, settings) => {
    count++; assert(url.startsWith('https://api.tcgpricelookup.com/v1/')); assert.equal(settings.redirect, 'error');
    assert.equal(settings.headers['X-API-Key'], options.expectedKey || 'fixture-secret');
    return options.response ? options.response(url, settings) : Response.json({ data: [card], total: 1 });
  } });
  return { service, file, get count() { return count; } };
}
test('quotes require the exact game, name, number, rarity, edition and available condition', () => {
  assert.equal(selectQuote([card], input).marketValue, 3.25);
  assert.equal(selectQuote([card], { ...input, condition: 'Lightly Played' }).marketValue, 2.5);
  for (const fields of [{ cardName: 'Another' }, { setCode: 'OTHER-001' }, { rarity: 'Rare' }, { edition: 'Unlimited' }, { condition: 'Damaged' }]) {
    assert.equal(selectQuote([card], { ...input, ...fields }).priceAvailable, false);
  }
  assert.equal(selectQuote([card, card], input).priceAvailable, false);
  assert.equal(selectQuote([{ ...card, prices: { raw: { near_mint: { tcgplayer: { market: null } } } } }], input).priceAvailable, false);
  assert.equal(selectQuote([{ ...card, variant: '' }], input).pricedEdition, '');
});
test('disabled pricing never contacts the provider; configured concurrent queries share cache without returning the key', async t => {
  const f = fixture(t);
  assert.equal((await f.service.quote(input)).pricingStatus, 'not-configured'); assert.equal(f.count, 0);
  f.service.save({ enabled: true, apiKey: 'fixture-secret' });
  assert(!JSON.stringify(f.service.status()).includes('fixture-secret'));
  const results = await Promise.all(Array.from({ length: 5 }, () => f.service.quote(input)));
  assert.equal(f.count, 1); assert(results.every(row => row.marketValue === 3.25));
  assert.equal((await f.service.quote({ ...input, condition: 'Lightly Played' })).marketValue, 2.5); assert.equal(f.count, 1);
  f.service.save({ enabled: true }); assert.equal(f.service.status().configured, true);
  f.service.save({ enabled: false, clearKey: true }); assert.equal(f.service.status().configured, false);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).apiKey, '');
});
test('rate limits stop further upstream calls while provider errors do not leak response content or keys', async t => {
  const f = fixture(t, { response: () => Response.json({ error: 'fixture-secret must not be returned' }, { status: 429, headers: { 'retry-after': '60' } }) });
  f.service.save({ enabled: true, apiKey: 'fixture-secret' });
  await assert.rejects(f.service.quote(input), error => error.status === 429 && !error.message.includes('fixture-secret'));
  await assert.rejects(f.service.quote(input), error => error.status === 429); assert.equal(f.count, 1);
  const bad = fixture(t, { response: () => Response.json({ error: 'private upstream debug' }, { status: 401 }) });
  bad.service.save({ enabled: true, apiKey: 'fixture-secret' });
  await assert.rejects(bad.service.test(), /key was rejected/);
});
test('incomplete results never select an arbitrary quote; cached missing results do not burn repeated quota', async t => {
  const f = fixture(t, { response: () => Response.json({ data: [card], total: 200 }) });
  f.service.save({ enabled: true, apiKey: 'fixture-secret' });
  assert.equal((await f.service.quote(input)).pricingStatus, 'too-many-matches');
  assert.equal((await f.service.quote(input)).priceAvailable, false); assert.equal(f.count, 1);
});
test('pricing routes isolate keys, require inventory access, enforce read-only/entitlement boundaries and use server credentials', async t => {
  const f = fixture(t), app = express(); app.use(express.json());
  registerTcgPriceLookup(app, { service: f.service, config: () => ({}),
    feature: (req, res, next) => req.get('x-feature') === 'off' ? res.sendStatus(402) : next(),
    access: req => ({ user: req.get('x-user') === 'none' ? null : { role: req.get('x-role') || 'owner', readOnly: req.get('x-readonly') === 'yes', allowedLibraries: req.get('x-denied') ? [] : ['inventory'] } }),
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const call = (route = '', body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/inventory/native/pricing${route}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const headers of [{ 'x-user': 'none' }, { 'x-role': 'viewer', 'x-denied': 'yes' }]) assert.equal((await call('', undefined, headers)).status, 403);
  assert.equal((await call('', {}, { 'x-role': 'viewer' })).status, 403);
  assert.equal((await call('', {}, { 'x-readonly': 'yes' })).status, 403);
  assert.equal((await call('', {}, { 'x-feature': 'off' })).status, 402);
  const saved = await (await call('', { enabled: true, apiKey: 'fixture-secret' })).json();
  assert.equal(saved.configured, true); assert(!JSON.stringify(saved).includes('fixture-secret'));
  assert.equal((await (await call('/test', {})).json()).ok, true);
  assert.equal((await (await call('/quote?' + new URLSearchParams(input))).json()).quote.marketValue, 3.25);
  assert(!JSON.stringify(await (await call()).json()).includes('fixture-secret'));
  f.service.test = async () => { throw Error('API key private upstream debug must not escape'); };
  const error = await (await call('/test', {})).json();
  assert.equal(error.ok, false); assert(!error.message.includes('private upstream debug'));
});
