const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const categories = new Set(['general', 'media', 'electronics', 'tools', 'collectibles', 'trading-cards', 'outdoor', 'documents']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, maximum = 4000) => String(value ?? '').trim().slice(0, maximum);
function number(value, name, maximum = 100000000, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < (integer ? 1 : 0) || result > maximum || (integer && !Number.isInteger(result))) throw fail(`Enter a valid ${name}.`);
  return result;
}
function inventoryPatch(input = {}) {
  const patch = {};
  for (const key of ['condition', 'location', 'brand', 'model', 'serialNumber', 'purchaseDate', 'warrantyExpiry']) {
    if (input[key] !== undefined) patch[key] = text(input[key], 240);
  }
  if (input.quantity !== undefined) patch.quantity = number(input.quantity, 'quantity', 100000, true);
  if (input.purchasePrice !== undefined) patch.purchasePrice = number(input.purchasePrice, 'purchase price');
  if (input.category !== undefined) {
    if (!categories.has(input.category)) throw fail('Choose an Inventory category.');
    patch.category = input.category;
  }
  return patch;
}
function nativeInventoryDraft(input = {}) {
  const title = text(input.title, 300);
  if (!title) throw fail('Enter an item title.');
  const details = inventoryPatch(input);
  if (!details.category) details.category = 'general';
  const captures = Array.isArray(input.captures) ? input.captures : [];
  if (captures.length > 4) throw fail('Choose at most four item photos.');
  let bytes = 0;
  const photos = captures.map((capture, index) => {
    const dataUrl = String(capture.dataUrl || '');
    const match = dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw fail('Item photos must be JPEG or PNG.');
    const size = Buffer.byteLength(match[2], 'base64'); bytes += size;
    if (!size || size > 2 * 1024 * 1024 || bytes > 6 * 1024 * 1024) throw fail('Item photos are too large.');
    return { id: text(capture.id || `photo-${index}`, 80), name: text(capture.name || 'item.jpg', 120), type: `image/${match[1]}`, size, dataUrl };
  });
  const draft = { libraryId: 'inventory', destinations: { inventory: true }, title, notes: text(input.notes),
    code: text(input.code, 200).replace(/\s+/g, ''), inventoryCategory: details.category,
    inventoryDetails: details, captures: photos, duplicateAction: ['create', 'copy'].includes(input.duplicateAction) ? input.duplicateAction : 'create' };
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  draft.metadata = Object.fromEntries(['title', 'description', 'brand', 'model', 'thumbnail', 'provider'].filter(key => metadata[key] !== undefined).map(key => [key, text(metadata[key])]));
  if (details.category === 'trading-cards') {
    const tcg = input.tcg || {};
    const cardName = text(tcg.cardName || title, 300);
    const providerCardId = text(tcg.providerCardId, 30);
    if (providerCardId && !/^\d{1,12}$/.test(providerCardId)) throw fail('Invalid card identity.');
    const selectedPrinting = tcg.selectedPrinting && typeof tcg.selectedPrinting === 'object' ? tcg.selectedPrinting : {};
    draft.tcg = { game: 'yugioh', cardName, providerCardId, cardIdentityKey: providerCardId || cardName.toLowerCase(),
      provider: providerCardId ? 'YGOPRODeck' : 'manual',
      setCode: text(tcg.setCode, 40).toUpperCase(), rarity: text(tcg.rarity, 120), edition: text(tcg.edition || 'Unlimited', 80),
      language: text(tcg.language || 'English', 80), condition: details.condition || 'Near Mint', quantity: details.quantity || 1,
      location: details.location || '', purchasePrice: details.purchasePrice || 0, marketValue: number(tcg.marketValue || 0, 'market value'),
      selectedArtwork: text(tcg.selectedArtwork, 2000), selectedArtworkId: text(tcg.selectedArtworkId, 80),
      selectedPrinting: Object.fromEntries(['cardId', 'cardName', 'setCode', 'setName', 'rarity', 'image', 'description', 'cardType', 'race', 'attribute', 'priceSource', 'priceSourceType'].filter(key => selectedPrinting[key] !== undefined).map(key => [key, text(selectedPrinting[key])])),
      binderId: text(tcg.binderId, 150), page: text(tcg.page, 20), pocket: text(tcg.pocket, 20),
      printingPrice: number(tcg.printingPrice || 0, 'printing price'), genericPrice: number(tcg.genericPrice || 0, 'generic price'),
      priceSource: text(tcg.priceSource || tcg.provider || 'manual', 100), priceSourceType: text(tcg.priceSourceType, 80), priceDifferenceWarning: tcg.priceDifferenceWarning === true,
      artworkVariants: Array.isArray(tcg.artworkVariants) ? tcg.artworkVariants.slice(0, 30).map(row => ({ id: text(row.id, 80), image: text(row.image, 2000), thumbnail: text(row.thumbnail, 2000) })) : [],
      linkedDeckIds: Array.isArray(tcg.linkedDeckIds) ? tcg.linkedDeckIds.slice(0, 20).map(value => text(value, 150)) : [],
    };
  }
  return draft;
}
function inventoryAccess(access, config) {
  const user = access?.user;
  const allowed = user?.allowedLibraries || [];
  const read = Boolean(user && config?.enabledLibraries?.inventory !== false &&
    (user.role === 'owner' || allowed.includes('*') || allowed.includes('inventory')));
  return { read, write: read && ['owner', 'admin'].includes(user.role) && user.readOnly !== true };
}
function createInventoryRequests(directory) {
  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw fail('Inventory request storage is unavailable.', 503);
  }
  function target(user, requestId) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw fail('Invalid save identity.');
    const key = crypto.createHash('sha256').update(String(user) + ':' + requestId.toLowerCase()).digest('hex');
    return path.join(directory, key + '.json');
  }
  function read(user, id) {
    const file = target(user, id);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw fail('Inventory request storage is unavailable.', 503);
    if (!fs.existsSync(file)) return null;
    if (fs.lstatSync(file).isSymbolicLink()) throw fail('Inventory request storage is unavailable.', 503);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw fail('Inventory save status needs repair; check the library before submitting again.', 503); }
  }
  function begin(user, id, body) {
    ensureDirectory();
    const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const existing = read(user, id);
    if (existing) {
      if (existing.hash !== hash) throw fail('This save identity belongs to a different item. Check its status before editing.', 409);
      return { fresh: false, value: existing };
    }
    const value = { state: 'saving', hash, recordId: '', at: new Date().toISOString() };
    try { fs.writeFileSync(target(user, id), JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') return begin(user, id, body); throw error; }
    return { fresh: true, value };
  }
  function finish(user, id, value) {
    ensureDirectory();
    const file = target(user, id), temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { read, begin, finish };
}
function inventorySummary(record) {
  const captures = (record.captures || []).map((capture, index) => {
    const details = { ...capture }; delete details.dataUrl;
    return { ...details, url: `/api/inventory/native/items/${encodeURIComponent(record.id)}/photos/${index}?v=${encodeURIComponent(record.updatedAt || '')}` };
  });
  return { ...record, captures, poster: record.poster || record.tcg?.selectedArtwork || record.metadata?.thumbnail || captures[0]?.url || '' };
}
function registerNativeInventory(app, { express, access, feature, config, records, binders, decks, complete, update, updatePrinting, recognize, lookupCode, searchCards, requests }) {
  const inFlight = new Set();
  const gate = (req, res, next) => {
    const permissions = inventoryAccess(access(req), config());
    if (!permissions.read || (req.method !== 'GET' && !permissions.write)) return res.status(403).json({ ok: false, message: 'This account cannot access or change Inventory.' });
    req.inventoryAccess = permissions; next();
  };
  app.use('/api/inventory/native', feature, gate, express.json({ limit: '12mb' }));
  app.get('/api/inventory/native', (req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, version: 1, accountId: access(req).user.id, canEdit: req.inventoryAccess.write, records: records().slice().reverse().map(inventorySummary), binders: binders(), decks: decks() }); }
    catch { res.status(500).json({ ok: false, message: 'Inventory could not load. Retry when the server is ready.' }); }
  });
  const userId = req => access(req).user.id;
  function status(req, value) {
    if (!value) return { ok: true, state: 'unknown' };
    const identity = `${userId(req)}:${req.params.requestId.toLowerCase()}`;
    const record = records().find(row => row.id === value.recordId || row.mobileRequestId === identity || row.mobileRequestIds?.includes(identity));
    return { ok: true, state: record ? 'complete' : value.state, record: record ? inventorySummary(record) : null, message: value.message || '' };
  }
  app.get('/api/inventory/native/requests/:requestId', (req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json(status(req, requests.read(userId(req), req.params.requestId))); }
    catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Save status could not be checked.' }); }
  });
  app.get('/api/inventory/native/items/:recordId/photos/:index', (req, res) => {
    try {
      if (!/^\d{1,2}$/.test(req.params.index)) return res.sendStatus(404);
      const record = records().find(row => row.id === req.params.recordId);
      const photo = record?.captures?.[Number(req.params.index)];
      const match = String(photo?.dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i);
      if (!match || match[2].length > 16 * 1024 * 1024) return res.sendStatus(404);
      res.setHeader('Cache-Control', 'private, max-age=60'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(`image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`).send(Buffer.from(match[2], 'base64'));
    } catch { res.sendStatus(500); }
  });
  app.post('/api/inventory/native/items', async (req, res) => {
    let reservation;
    let activeKey;
    try {
      const body = nativeInventoryDraft(req.body);
      req.params.requestId = String(req.body.requestId || '').toLowerCase();
      reservation = requests.begin(userId(req), req.params.requestId, body);
      if (!reservation.fresh) return res.json(status(req, reservation.value));
      activeKey = `${userId(req)}:${req.params.requestId}`; inFlight.add(activeKey);
      body.mobileRequestId = `${userId(req)}:${req.params.requestId}`;
      const output = await new Promise((resolve, reject) => {
        const reply = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ code: this.statusCode, value }); return this; } };
        try { complete({ ...req, params: { sessionId: 'new' }, body }, reply); } catch (error) { reject(error); }
      });
      const record = output.value.record;
      const value = { ...reservation.value, state: record ? 'complete' : output.code >= 400 ? 'failed' : 'uncertain', recordId: record?.id || '',
        message: record ? '' : output.value.message || 'Check Inventory before submitting again.' };
      requests.finish(userId(req), req.params.requestId, value);
      res.status(output.code >= 400 ? output.code : 200).json(status(req, value));
    } catch (error) {
      // A reserved write may have reached the ordinary intake adapter. Preserve
      // its identity for status recovery rather than replaying it after a crash.
      res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Inventory save was interrupted. Check save status before trying again.' });
    } finally { if (activeKey) inFlight.delete(activeKey); }
  });
  app.post('/api/inventory/native/requests/:requestId/resolve', (req, res) => {
    try {
      const id = req.params.requestId.toLowerCase();
      if (req.body?.confirmed !== true) throw fail('Confirm that you checked Inventory before starting another save.');
      if (inFlight.has(`${userId(req)}:${id}`)) throw fail('The save is still running. Check status again shortly.', 409);
      const value = requests.read(userId(req), id), current = status(req, value);
      if (current.state === 'complete' || !value) return res.json(current);
      requests.finish(userId(req), id, { ...value, state: 'failed', message: 'The unconfirmed save was reviewed. Check the draft before saving again.' });
      res.json(status(req, requests.read(userId(req), id)));
    } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Save status could not be resolved.' }); }
  });
  app.patch('/api/inventory/native/items/:recordId', (req, res) => {
    try { req.body = { ...inventoryPatch(req.body), ...(req.body.title !== undefined ? { title: text(req.body.title, 300) } : {}), ...(req.body.notes !== undefined ? { notes: text(req.body.notes) } : {}) }; req.params.libraryId = 'inventory'; update(req, res); }
    catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Inventory could not be updated.' }); }
  });
  app.patch('/api/inventory/native/items/:recordId/printings/:printingId', (req, res) => {
    try {
      const body = inventoryPatch(req.body);
      for (const key of ['setCode', 'rarity', 'edition', 'language', 'binderId', 'page', 'pocket']) if (req.body[key] !== undefined) body[key] = text(req.body[key], 150);
      req.body = body; updatePrinting(req, res);
    } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Card printing could not be updated.' }); }
  });
  app.post('/api/inventory/native/lookup', async (req, res) => {
    try {
      const code = text(req.body?.code, 200).replace(/\s+/g, '');
      if (!code) throw fail('Scan or enter a barcode.');
      const category = categories.has(req.body?.category) ? req.body.category : 'general';
      res.json({ ok: true, result: await lookupCode(code, category) });
    } catch (error) { res.status(error.status || 502).json({ ok: false, message: error.status ? error.message : 'Barcode lookup is unavailable. Manual entry remains available.' }); }
  });
  app.get('/api/inventory/native/cards', async (req, res) => {
    try {
      const query = { name: text(req.query.name, 200), setCode: text(req.query.setCode, 40), cardId: text(req.query.cardId, 20) };
      if (!query.name && !query.setCode && !query.cardId) throw fail('Enter a card name, passcode or set code.');
      if (query.cardId && !/^\d{1,12}$/.test(query.cardId)) throw fail('Enter a valid card passcode.');
      res.json({ ok: true, matches: await searchCards(query) });
    } catch (error) { res.status(error.status || 502).json({ ok: false, message: error.status ? error.message : 'Card search is unavailable. Try again or enter the card manually.' }); }
  });
  app.post('/api/inventory/native/recognize', async (req, res) => {
    try {
      const photo = nativeInventoryDraft({ title: 'Card photo', captures: [{ dataUrl: req.body?.imageData }] }).captures[0];
      req.body = { imageData: photo.dataUrl };
      await recognize(req, res);
    } catch (error) { res.status(error.status || 502).json({ ok: false, message: error.status ? error.message : 'Card photo recognition is unavailable. Search by card name or set code.' }); }
  });
}
module.exports = { nativeInventoryDraft, inventoryPatch, inventoryAccess, createInventoryRequests, inventorySummary, registerNativeInventory };
