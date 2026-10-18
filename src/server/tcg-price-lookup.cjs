const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inventoryAccess } = require('./native-inventory.cjs');
const clean = value => String(value || '').trim();
const normalize = value => clean(value).toLowerCase().replace(/[\s’'_-]+/g, '');
const safeError = (message, status) => Object.assign(new Error(message), { status, expose: true });
const unavailable = reason => ({ priceAvailable: false, priceSourceType: 'unavailable', priceSource: 'TCG Price Lookup', pricingStatus: reason });
function selectQuote(rows, input) {
  const condition = clean(input.condition || 'Near Mint').toLowerCase().replace(/\s+/g, '_');
  const matches = rows.filter(row => (row.game?.slug || row.game) === 'yugioh' &&
    normalize(row.name) === normalize(input.cardName) && normalize(row.number) === normalize(input.setCode) &&
    normalize(row.rarity) === normalize(input.rarity) && (!row.variant || !input.edition || normalize(row.variant) === normalize(input.edition)) &&
    (!row.currency || row.currency === 'USD') &&
    (row.language ? normalize(row.language) === normalize(input.language || 'English') : normalize(input.language || 'English') === 'english'));
  if (matches.length !== 1) return unavailable(matches.length ? 'ambiguous-printing' : 'no-exact-printing');
  const row = matches[0], raw = row.prices?.raw?.[condition]?.tcgplayer?.market;
  if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) <= 0) return unavailable('no-condition-quote');
  return { priceAvailable: true, marketValue: Number(raw), printingPrice: Number(raw), priceSourceType: 'exact-printing',
    priceSource: 'TCG Price Lookup / TCGplayer · ' + (input.condition || 'Near Mint') + (row.variant ? ' · ' + row.variant : ' · edition not quoted'),
    priceCurrency: 'USD', priceProviderId: row.id, priceCheckedAt: new Date().toISOString(),
    priceUpdatedAt: row.last_price_update || row.updated_at || '', pricedSetCode: input.setCode, pricedRarity: row.rarity,
    pricedEdition: row.variant || '', pricedCondition: input.condition || 'Near Mint', pricingStatus: 'available' };
}
function createTcgPriceLookup({ file, fetchImpl = fetch, now = Date.now, interval = 3100, cacheMs = 6 * 60 * 60 * 1000, environmentKey = () => process.env.HOMESTEAD_TCG_PRICE_LOOKUP_KEY }) {
  let configuration = { enabled: false, apiKey: '' }, blockedUntil = 0, nextRequest = 0, queueDepth = 0, tail = Promise.resolve();
  const cache = new Map(), pending = new Map();
  try { if (fs.existsSync(file)) { if (fs.lstatSync(file).isSymbolicLink()) throw Error(); configuration = JSON.parse(fs.readFileSync(file, 'utf8')); if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw Error(); } } catch { configuration = { enabled: false, apiKey: '' }; }
  const key = () => clean(environmentKey() || configuration.apiKey);
  const status = () => ({ enabled: configuration.enabled === true, configured: Boolean(key()), blockedUntil, provider: 'TCG Price Lookup' });
  function save(input) {
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw safeError('Enter a valid API key.', 400);
    const apiKey = input.clearKey ? '' : input.apiKey === undefined || input.apiKey === '' ? configuration.apiKey : clean(input.apiKey);
    if (typeof apiKey !== 'string' || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw safeError('Enter a valid API key.', 400);
    const next = { enabled: input.enabled === true, apiKey };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw Error('Pricing settings are unavailable.');
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    configuration = next; cache.clear(); blockedUntil = 0; return status();
  }
  async function request(route, requestedKey) {
    if (queueDepth >= 4) throw safeError('Pricing is busy. Try again shortly.', 429);
    queueDepth++;
    const previous = tail; let release; tail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (now() < blockedUntil) throw safeError('Pricing quota reached. Try after the provider reset.', 429);
      const delay = Math.max(0, nextRequest - now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextRequest = now() + interval;
      const response = await fetchImpl('https://api.tcgpricelookup.com/v1/' + route, {
        headers: { 'X-API-Key': requestedKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000),
      });
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        blockedUntil = now() + (retry > 0 ? Math.min(retry, 86400) * 1000 : 60000);
        if (response.headers.get('x-ratelimit-remaining') === '0' && reset > now()) blockedUntil = Math.min(reset, now() + 86400000);
        throw safeError('Pricing rate limit reached. Cached prices remain available.', 429);
      }
      if (!response.ok) throw safeError(response.status === 401 ? 'The pricing API key was rejected.' : response.status === 403 ? 'Your pricing plan does not allow this request.' : 'The pricing service is unavailable.', response.status === 401 || response.status === 403 ? 400 : 502);
      if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw Error('Pricing response exceeds the size limit.');
      const reader = response.body.getReader(); let total = 0, chunks = [];
      try { while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > 4 * 1024 * 1024) throw Error('Pricing response exceeds the size limit.'); chunks.push(Buffer.from(part.value)); } }
      finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { queueDepth--; release(); }
  }
  async function quote(input) {
    if (!configuration.enabled || !key()) return unavailable('not-configured');
    if (!clean(input.cardName) || !/^[A-Z0-9-]{3,40}$/i.test(input.setCode || '') || !clean(input.rarity) || clean(input.cardName).length > 300 || clean(input.rarity).length > 120) return unavailable('missing-printing-details');
    const apiKey = key(), scope = crypto.createHash('sha256').update(apiKey).digest('hex');
    const cacheKey = scope + ':' + normalize(input.setCode);
    let entry = cache.get(cacheKey);
    if (!entry || now() - entry.at >= cacheMs) {
      if (!pending.has(cacheKey)) {
        const work = (async () => {
          const data = await request('cards/search?' + new URLSearchParams({ q: clean(input.setCode), game: 'yugioh', limit: '100' }), apiKey);
          if (!Array.isArray(data.data)) throw Error('Pricing response format is unsupported.');
          const complete = Number(data.total ?? data.data.length) <= data.data.length;
          const result = { at: now(), rows: complete ? data.data : [], complete };
          if (cache.size >= 1000) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, result); return result;
        })().finally(() => pending.delete(cacheKey));
        pending.set(cacheKey, work);
      }
      entry = await pending.get(cacheKey);
    }
    if (!entry.complete) return unavailable('too-many-matches');
    return { ...selectQuote(entry.rows, input), priceCached: true };
  }
  return { status, save, quote, test: async () => {
    if (!key()) throw safeError('Save an API key first.', 400);
    const data = await request('games?limit=1', key());
    if (!Array.isArray(data.data)) throw Error('Pricing response format is unsupported.');
    return { ok: true, ...status(), message: 'Connected. Live printing coverage still depends on the catalog.' };
  } };
}
function registerTcgPriceLookup(app, { service, access, config, feature }) {
  const guard = write => (req, res, next) => {
    const allowed = inventoryAccess(access(req), config());
    if (!(write ? allowed.write : allowed.read)) return res.status(403).json({ ok: false, message: 'Inventory access is required.' });
    res.setHeader('Cache-Control', 'private, no-store'); next();
  };
  const run = action => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) { res.status(error.status || 502).json({ ok: false, message: error.expose === true ? error.message : 'Pricing could not be checked. Try again later.' }); }
  };
  app.get('/api/inventory/native/pricing', feature, guard(false), run(async req => ({ ok: true, ...service.status(), canEdit: inventoryAccess(access(req), config()).write })));
  app.post('/api/inventory/native/pricing', feature, guard(true), run(async req => ({ ok: true, ...service.save(req.body || {}) })));
  app.post('/api/inventory/native/pricing/test', feature, guard(true), run(() => service.test()));
  app.get('/api/inventory/native/pricing/quote', feature, guard(false), run(async req => ({ ok: true, quote: await service.quote(req.query || {}) })));
}
module.exports = { createTcgPriceLookup, registerTcgPriceLookup, selectQuote };
