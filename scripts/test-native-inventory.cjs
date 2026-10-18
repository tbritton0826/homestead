const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const express = require('express');
const { createTcgOrganizations, moveHolding } = require('../src/server/tcg-organizations.cjs');
const { printingPriceDetails, refreshHoldings } = require('../src/server/tcg-pricing.cjs');
const { nativeInventoryDraft, inventoryPatch, inventoryAccess, createInventoryRequests, registerNativeInventory } = require('../src/server/native-inventory.cjs');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8');
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-inventory-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function actual(name, context) {
  let start = serverSource.indexOf('function ' + name + '(');
  if (serverSource.slice(start - 6, start) === 'async ') start -= 6;
  const end = serverSource.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return vm.runInNewContext(serverSource.slice(start, end) + ';' + name, context);
}
const plain = value => JSON.parse(JSON.stringify(value));

test('native draft uses the existing inventory schema, exact card identity and printing, with no extra destinations', () => {
  const input = { title: 'Example card', category: 'trading-cards', quantity: 3, condition: 'Near Mint', location: 'Shelf', requestId: crypto.randomUUID(),
    destinations: { personal: true }, libraryId: 'personal', tcg: { providerCardId: '1234', cardName: 'Example card', setCode: 'test-en001', rarity: 'Rare', edition: '1st Edition', language: 'English', selectedPrinting: { cardId: '1234', setCode: 'TEST-EN001', rarity: 'Rare' } } };
  const result = nativeInventoryDraft(input);
  assert.equal(result.libraryId, 'inventory'); assert.deepEqual(result.destinations, { inventory: true });
  assert.equal(result.tcg.providerCardId, '1234'); assert.equal(result.tcg.setCode, 'TEST-EN001');
  assert.equal(result.tcg.quantity, 3); assert.equal(result.tcg.selectedPrinting.setCode, 'TEST-EN001');
  for (const bad of [{ title: '' }, { title: 'Item', quantity: -1 }, { title: 'Item', quantity: 1.5 }, { title: 'Item', purchasePrice: Infinity }, { title: 'Item', category: '../outside' }]) assert.throws(() => nativeInventoryDraft(bad));
  assert.throws(() => nativeInventoryDraft({ ...input, tcg: { providerCardId: '../bad' } }));
  assert.throws(() => nativeInventoryDraft({ title: 'Item', captures: [{ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }] }));
  assert.throws(() => nativeInventoryDraft({ title: 'Item', captures: Array(5).fill({}) }));
});

test('photo normalization is stable for save identity checks and stays size bounded', () => {
  const photo = { id: 'chosen-photo', name: 'main-photo.jpg', dataUrl: 'data:image/jpeg;base64,' + Buffer.from('generated image fixture').toString('base64') };
  const input = { title: 'Item', captures: [photo] };
  assert.deepEqual(nativeInventoryDraft(input), nativeInventoryDraft(input));
  assert.equal(nativeInventoryDraft(input).captures[0].id, 'chosen-photo');
  assert.throws(() => nativeInventoryDraft({ title: 'Item', captures: [{ ...photo, dataUrl: 'data:image/jpeg;base64,' + Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }] }));
});

test('inventory access respects entitlement boundary inputs, disabled library, allowed libraries and read-only writes', () => {
  const user = { id: 'owner', role: 'owner', allowedLibraries: [] };
  assert.deepEqual(inventoryAccess({ user }, {}), { read: true, write: true });
  assert.deepEqual(inventoryAccess({ user }, { enabledLibraries: { inventory: false } }), { read: false, write: false });
  assert.deepEqual(inventoryAccess({ user: { ...user, role: 'viewer', allowedLibraries: ['inventory'] } }, {}), { read: true, write: false });
  assert.equal(inventoryAccess({ user: { ...user, role: 'admin', allowedLibraries: [] } }, {}).read, false);
  assert.equal(inventoryAccess({ user: { ...user, readOnly: true } }, {}).write, false);
});

async function httpFixture(t, mode = 'normal', adapters = {}) {
  const root = temporary(t), rows = []; let submissions = 0;
  const app = express();
  registerNativeInventory(app, { express,
    feature: (req, res, next) => req.get('x-feature') === 'off' ? res.sendStatus(402) : next(), config: () => ({}),
    access: req => ({ user: req.get('x-role') === 'none' ? null : { id: req.get('x-user') || 'owner', role: req.get('x-role') || 'owner', allowedLibraries: req.get('x-denied') ? [] : ['inventory'] } }),
    records: () => rows, binders: () => [], decks: () => [], requests: createInventoryRequests(root),
    complete: (req, res) => {
      submissions++;
      if (mode === 'adapter-failed') return res.json({ ok: true, record: null, message: 'Adapter needs attention.' });
      const record = { id: 'generated-' + submissions, title: req.body.title, libraryId: 'inventory', mobileRequestId: req.body.mobileRequestId };
      rows.push(record);
      if (mode === 'interrupted') throw Error('simulated lost reply');
      setTimeout(() => res.json({ ok: true, record }), 15);
    },
    update: (req, res) => res.json({ ok: true, record: { id: req.params.recordId, ...req.body }, library: req.params.libraryId }),
    updatePrinting: (req, res) => res.json({ ok: true, record: { id: req.params.recordId }, printing: req.body }),
    lookupCode: async code => ({ existing: false, code, metadata: { title: 'Generated product' } }),
    searchCards: async query => [{ cardId: query.cardId || '1234', cardName: 'Generated card', setCode: query.setCode }],
    recognize: (req, res) => res.json({ ok: true, matches: [{ cardId: '1234', setCode: 'TEST-EN001' }], usedImage: req.body.imageData.startsWith('data:image/jpeg;') }),
    ...adapters,
  });
  const listener = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  t.after(() => new Promise(resolve => { listener.closeAllConnections(); listener.close(resolve); }));
  const base = `http://127.0.0.1:${listener.address().port}/api/inventory/native`;
  const call = (suffix = '', body, headers = {}, method = body ? 'POST' : 'GET') => fetch(base + suffix, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { call, rows, submissions: () => submissions };
}

test('native APIs reject denied/read-only access and disabled entitlement, while allowed browsing returns shared records', async t => {
  const f = await httpFixture(t);
  assert.equal((await f.call('', undefined, { 'x-role': 'none' })).status, 403);
  assert.equal((await f.call('', undefined, { 'x-role': 'viewer', 'x-denied': 'yes' })).status, 403);
  assert.equal((await f.call('', undefined, { 'x-feature': 'off' })).status, 402);
  assert.equal((await f.call('/items', { title: 'Item', requestId: crypto.randomUUID() }, { 'x-role': 'viewer' })).status, 403);
  const response = await f.call('', undefined, { 'x-role': 'viewer' });
  const data = await response.json(); assert.equal(data.version, 1); assert.equal(data.canEdit, false); assert.equal(data.accountId, 'owner');
});

test('concurrent or repeated native saves create one record; changed payload and cross-account status cannot reuse the save', async t => {
  const f = await httpFixture(t), body = { title: 'Item', quantity: 2, requestId: crypto.randomUUID() };
  const responses = await Promise.all([f.call('/items', body), f.call('/items', body)]);
  assert(responses.every(response => response.ok)); assert.equal(f.submissions(), 1); assert.equal(f.rows.length, 1);
  assert.equal((await (await f.call('/items', body)).json()).state, 'complete');
  assert.equal((await f.call('/items', { ...body, title: 'Changed' })).status, 409);
  assert.equal((await (await f.call('/requests/' + body.requestId)).json()).record.id, 'generated-1');
  assert.equal((await (await f.call('/requests/' + body.requestId, undefined, { 'x-user': 'other' })).json()).state, 'unknown');
  assert.equal((await f.call('/requests/..%2Foutside')).status, 400);
});

test('interrupted replies recover an already-written item without executing intake again', async t => {
  const f = await httpFixture(t, 'interrupted'), body = { title: 'Item', requestId: crypto.randomUUID() };
  assert.equal((await f.call('/items', body)).status, 500);
  const recovered = await (await f.call('/requests/' + body.requestId)).json();
  assert.equal(recovered.state, 'complete'); assert.equal(recovered.record.id, 'generated-1');
  assert.equal((await f.call('/items', body)).status, 200); assert.equal(f.submissions(), 1);
});

test('successful intake without an actual inventory record stays uncertain and is never replayed', async t => {
  const f = await httpFixture(t, 'adapter-failed'), body = { title: 'Item', requestId: crypto.randomUUID() };
  assert.equal((await (await f.call('/items', body)).json()).state, 'uncertain');
  assert.equal((await (await f.call('/items', body)).json()).state, 'uncertain'); assert.equal(f.submissions(), 1);
  assert.equal((await f.call('/requests/' + body.requestId + '/resolve', {})).status, 400);
  assert.equal((await (await f.call('/requests/' + body.requestId + '/resolve', { confirmed: true })).json()).state, 'failed');
  assert.equal((await (await f.call('/items', body)).json()).state, 'failed'); assert.equal(f.submissions(), 1, 'the original request is retained, not deleted or replayed');
});

test('barcode lookup, passcode/printing search and narrow item/printing edits use existing adapters', async t => {
  const f = await httpFixture(t);
  assert.equal((await (await f.call('/lookup', { code: '0123456789012' })).json()).result.metadata.title, 'Generated product');
  const card = await (await f.call('/cards?cardId=1234&setCode=TEST-EN001')).json();
  assert.equal(card.matches[0].cardId, '1234'); assert.equal(card.matches[0].setCode, 'TEST-EN001');
  assert.equal((await f.call('/cards?cardId=oops')).status, 400);
  const item = await (await f.call('/items/existing', { title: 'Edited', quantity: 3, unknown: 'drop', location: 'Shelf' }, {}, 'PATCH')).json();
  assert.equal(item.library, 'inventory'); assert.equal(item.record.quantity, 3); assert.equal(item.record.unknown, undefined);
  const printing = await (await f.call('/items/card/printings/printing', { setCode: 'SET-001', quantity: 2 }, {}, 'PATCH')).json();
  assert.equal(printing.printing.quantity, 2); assert.equal(printing.printing.setCode, 'SET-001');
});

test('card photo recognition uses the existing service, validates bounded image input and never creates an item', async t => {
  const f = await httpFixture(t);
  const imageData = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff]).toString('base64');
  const response = await (await f.call('/recognize', { imageData })).json();
  assert.equal(response.usedImage, true); assert.equal(response.matches[0].setCode, 'TEST-EN001');
  assert.equal(f.submissions(), 0); assert.equal(f.rows.length, 0);
  assert.equal((await f.call('/recognize', { imageData: 'data:text/html;base64,YQ==' })).status, 400);
  assert.equal((await f.call('/recognize', { imageData }, { 'x-role': 'viewer' })).status, 403);
});

function cardCatalogContext(fetch) {
  const context = { fetch, URLSearchParams, AbortController, setTimeout, clearTimeout };
  context.normalizeYugiohSetCode = actual('normalizeYugiohSetCode', {});
  context.normalizeYugiohQuery = actual('normalizeYugiohQuery', context);
  return context;
}

test('printed codes alone, codes typed in the name field, and passcodes do not require or trust a title', () => {
  const context = cardCatalogContext();
  for (const query of [{ setCode: ' cori-en029 ' }, { name: 'Misspelled old title', setCode: 'CORI-EN029' }, { name: 'CORI–EN029' }]) {
    assert.deepEqual(plain(context.normalizeYugiohQuery(query)), { name: '', setCode: 'CORI-EN029', cardId: '' });
  }
  assert.deepEqual(plain(context.normalizeYugiohQuery({ name: ' 12345678 ' })), { name: '', setCode: '', cardId: '12345678' });
  assert.equal(context.normalizeYugiohQuery({ name: 'Seven Tools of the Bandit' }).name, 'Seven Tools of the Bandit');
});

test('full catalog uses the supported unparameterized endpoint and a fresh cache avoids another download', async t => {
  const root = temporary(t), cache = path.join(root, 'catalog.json'), urls = [];
  const context = { fs, getYugiohCachePath: () => cache, YGOPRODECK_CACHE_TTL_MS: 86400000, AbortController, setTimeout, clearTimeout,
    fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ data: [{ id: 1234, card_sets: [{ set_code: 'CORI-EN029' }] }] }) }; } };
  const fetchAll = actual('fetchAllYugiohCardsCached', context);
  assert.equal((await fetchAll()).length, 1);
  assert.equal((await fetchAll()).length, 1);
  assert.deepEqual(urls, ['https://db.ygoprodeck.com/api/v7/cardinfo.php']);
});

test('real provider search omits removed options, reports no-match normally, and retains actual provider failures', async () => {
  const urls = []; let status = 200;
  const context = cardCatalogContext(async url => {
    urls.push(new URL(url));
    return { ok: status === 200, status, json: async () => status === 200 ? { data: [{ id: 1234 }] } :
      { error: status === 400 ? 'No card matching your query was found in the database.' : 'Catalog service unavailable' } };
  });
  const search = actual('fetchYugiohCards', context);
  assert.equal((await search({ name: 'Example card' })).length, 1);
  assert.equal(urls[0].searchParams.get('fname'), 'Example card');
  await search({ cardId: '1234' });
  assert.equal(urls[1].searchParams.get('id'), '1234');
  assert(urls.every(url => !url.searchParams.has('tcgplayer_data')));
  status = 400; assert.equal((await search({ name: 'Missing card' })).length, 0);
  status = 503; await assert.rejects(search({ name: 'Example card' }), /Catalog service unavailable/);
});

test('native code-only lookup follows the production catalog path, selects the exact printing and saves once', async t => {
  const context = cardCatalogContext(() => { throw Error('must not issue a name search'); });
  context.fetchAllYugiohCardsCached = async () => [
    { id: 1234, name: 'Generated card', card_sets: [{ set_code: 'CORI-EN029', set_rarity: 'Rare' }, { set_code: 'OTHER-EN001' }], card_images: [] },
    { id: 5678, name: 'Different card', card_sets: [{ set_code: 'CORI-EN030' }] },
  ];
  context.yugiohPrintingPriceDetails = () => ({});
  const search = actual('fetchYugiohCards', context), map = actual('mapYugiohMatches', context);
  const f = await httpFixture(t, 'normal', { searchCards: async query => {
    const normalized = context.normalizeYugiohQuery(query);
    return map(await search(normalized), normalized.setCode);
  } });
  for (const query of ['setCode=CORI-EN029', 'setCode=CORI-EN029&name=Wrong%20name', 'name=CORI-EN029']) {
    const response = await f.call('/cards?' + query); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.matches.length, 1);
    assert.equal(data.matches[0].setCode, 'CORI-EN029'); assert.equal(data.matches[0].cardId, '1234');
  }
  assert.equal(f.submissions(), 0, 'search must not import automatically');
  const body = { title: 'Generated card', category: 'trading-cards', quantity: 1, requestId: crypto.randomUUID(),
    tcg: { cardName: 'Generated card', providerCardId: '1234', setCode: 'CORI-EN029', rarity: 'Rare' } };
  assert.equal((await (await f.call('/items', body)).json()).state, 'complete');
  assert.equal((await (await f.call('/items', body)).json()).state, 'complete');
  assert.equal(f.submissions(), 1);
});

test('save journals survive restart and fail closed on corrupt or linked request files', t => {
  const root = temporary(t), id = crypto.randomUUID(), requests = createInventoryRequests(root);
  requests.begin('owner', id, { title: 'Item' });
  assert.equal(createInventoryRequests(root).begin('owner', id, { title: 'Item' }).fresh, false);
  assert.throws(() => requests.begin('owner', '../outside', {}));
  const file = path.join(root, fs.readdirSync(root)[0]); fs.writeFileSync(file, '{bad');
  assert.throws(() => requests.read('owner', id), error => error.status === 503);
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});

test('linked journal roots cannot read or write outside recovery storage', t => {
  const root = temporary(t), outside = temporary(t), link = path.join(root, 'linked');
  try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Host does not allow test links'); throw error; }
  const service = createInventoryRequests(link), id = crypto.randomUUID();
  assert.throws(() => service.begin('owner', id, {}), error => error.status === 503);
  assert.throws(() => service.read('owner', id), error => error.status === 503);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('inventory summaries omit photo bytes and authenticated on-demand photo routes return only the selected item', async t => {
  const f = await httpFixture(t), bytes = Buffer.from([0xff, 0xd8, 0xff, 0]);
  f.rows.push({ id: 'photo-item', title: 'Item', captures: [{ id: 'capture', name: 'receipt.jpg', dataUrl: 'data:image/jpeg;base64,' + bytes.toString('base64') }] });
  const summary = await (await f.call()).json();
  assert.equal(summary.records[0].captures[0].dataUrl, undefined);
  assert.equal(summary.records[0].captures[0].name, 'receipt.jpg');
  assert.match(summary.records[0].poster, /\/items\/photo-item\/photos\/0/);
  const response = await f.call('/items/photo-item/photos/0');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await f.call('/items/other/photos/0')).status, 404);
  assert.equal((await f.call('/items/photo-item/photos/0', undefined, { 'x-role': 'none' })).status, 403);
});

test('the actual intake record adapter persists native general fields and the original save identity', t => {
  const root = temporary(t), target = path.join(root, 'inventory.json');
  const create = actual('createLibraryRecordFromIntake', {
    readIntakeLibraryRecords: () => fs.existsSync(target) ? JSON.parse(fs.readFileSync(target)) : [],
    consolidateTcgInventoryRecords: rows => ({ records: rows, idRemap: new Map() }),
    writeIntakeLibraryRecords: (_, rows) => fs.writeFileSync(target, JSON.stringify(rows)),
    getCaptureRequirements: () => ['main-photo'],
  });
  const payload = { id: 'new-item', libraryId: 'inventory', title: 'Test tool', inventoryCategory: 'tools', mobileRequestId: 'owner:uuid',
    inventoryDetails: { quantity: 4, condition: 'Good', location: 'Workshop', brand: 'Example', warrantyExpiry: '2027-01-01' } };
  const result = create({ queueItem: payload, session: { id: 'session' }, metadata: { description: 'Metadata retained' } });
  assert.equal(result.quantity, 4); assert.equal(result.location, 'Workshop'); assert.equal(result.category, 'tools');
  assert.equal(result.mobileRequestId, 'owner:uuid');
  const reopened = JSON.parse(fs.readFileSync(target))[0];
  assert.equal(reopened.warrantyExpiry, '2027-01-01'); assert.equal(reopened.metadata.description, 'Metadata retained');
});

test('canonical card reads preserve shared intake photos, metadata and recovery IDs while canonical printing data wins', () => {
  const indexed = [{ id: 'card', category: 'trading-cards', tcg: { quantity: 1 }, captures: [{ id: 'photo' }], metadata: { description: 'Preserved' }, mobileRequestId: 'owner:request' }];
  const read = actual('readIntakeLibraryRecords', {
    readIntakeCollection: () => indexed, intakeLibraryRecordsPath: () => '',
    readCanonicalTcgRecords: () => [{ id: 'card', tcg: { quantity: 3 }, captures: [], metadata: { thumbnail: 'canonical.jpg' } }],
  });
  const result = plain(read('inventory'));
  assert.equal(result.length, 1); assert.equal(result[0].tcg.quantity, 3);
  assert.equal(result[0].captures[0].id, 'photo'); assert.equal(result[0].metadata.description, 'Preserved'); assert.equal(result[0].mobileRequestId, 'owner:request');
});

test('actual shared item and physical printing PATCH handlers persist edits without dropping existing fields', () => {
  let rows = [{ id: 'item', title: 'Old', category: 'tools', metadata: { preserved: true }, serialNumber: 'KEEP' }], canonicalWrites = 0;
  const context = { inventoryPatch, readIntakeLibraryRecords: () => rows, writeIntakeLibraryRecords: (_, values) => { rows = values; },
    persistTcgCanonicalRecord: () => { canonicalWrites++; }, readIntakeCollection: () => [], activityDataPath: '', makeIntakeId: () => 'generated', writeJsonFile() {},
    normalizeYugiohSetCode: value => value, readTcgBinders: () => [], summarizeTcgPrintings: (tcg, printings) => ({ ...tcg, printings }) };
  const reply = { status() { return this; }, json(value) { assert.equal(value.ok, true); return this; } };
  actual('updateIntakeLibraryRecord', context)({ params: { libraryId: 'inventory', recordId: 'item' }, body: { title: 'Edited', quantity: 4, condition: 'Good', location: 'Garage' } }, reply);
  assert.equal(rows[0].title, 'Edited'); assert.equal(rows[0].quantity, 4); assert.equal(rows[0].serialNumber, 'KEEP'); assert.equal(rows[0].metadata.preserved, true);
  rows = [{ id: 'card', tcg: { printings: [{ id: 'printing', setCode: 'ONE', quantity: 1 }], preserve: 'yes' } }];
  actual('updateIntakePrinting', context)({ params: { recordId: 'card', printingId: 'printing' }, body: { quantity: 5, condition: 'Near Mint' } }, reply);
  assert.equal(rows[0].tcg.printings[0].quantity, 5); assert.equal(rows[0].tcg.preserve, 'yes'); assert.equal(canonicalWrites, 1);
});

test('editing a set code retains its verified canonical directory and does not leave a duplicate printing', t => {
  const root = temporary(t), prior = path.join(root, 'card', 'OLD-SET'), newDirectory = path.join(root, 'card', 'NEW-SET');
  fs.mkdirSync(prior, { recursive: true });
  fs.writeFileSync(path.join(prior, 'metadata.json'), JSON.stringify({ recordId: 'card', tcg: { id: 'printing', setCode: 'OLD-SET' } }));
  const context = { fs, path, tcgCanonicalRoot: root, tcgOrganizations: createTcgOrganizations(root), readTcgLocations: () => [], readCanonicalTcgRecords: () => [], summarizeTcgPrintings: (base, list) => ({ ...base, printings: list }),
    readJsonFile: (file, fallback) => { try { return JSON.parse(fs.readFileSync(file)); } catch { return fallback; } },
    writeJsonFile: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
    getTcgCanonicalPaths: () => ({ printingDir: newDirectory, metadataPath: path.join(newDirectory, 'metadata.json'), frontPath: path.join(newDirectory, 'front.jpg') }),
    makeCanonicalTcgMetadata: (record, printing) => ({ recordId: record.id, tcg: printing }),
  };
  context.getTcgHoldingPaths = actual('getTcgHoldingPaths', context);
  actual('persistTcgCanonicalRecord', context)({ id: 'card', tcg: { printings: [{ id: 'printing', setCode: 'NEW-SET', _canonicalDirectory: prior }] } });
  assert.equal(fs.existsSync(newDirectory), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(prior, 'metadata.json'))).tcg.setCode, 'NEW-SET');
});


test('exact set and rarity pricing never borrows a positive unrelated printing or generic price', () => {
  const card = { card_sets: [
    { set_code: 'RA01-EN043', set_rarity: 'Secret Rare', set_price: '0' },
    { set_code: 'GEIM-EN050', set_rarity: "Collector's Rare", set_price: '1.88' },
    { set_code: 'MP22-EN264', set_rarity: 'Prismatic Secret Rare', set_price: '8.69' },
  ], card_prices: [{ tcgplayer_price: '115.97' }] };
  const absent = printingPriceDetails(card, { setCode: 'RA01-EN043', rarity: 'Secret Rare' });
  assert.equal(absent.priceAvailable, false); assert.equal(absent.marketValue, 0); assert.equal(absent.genericPrice, 115.97);
  assert.equal(absent.pricedSetCode, '');
  const exact = printingPriceDetails(card, { setCode: 'mp22-en264', rarity: 'Prismatic Secret Rare', edition: '1st Edition' });
  assert.equal(exact.marketValue, 8.69); assert.equal(exact.pricedEdition, ''); assert.match(exact.priceSource, /edition and condition not quoted/);
  assert.equal(printingPriceDetails(card, { setCode: 'MP22-EN264', rarity: 'Ultra Rare' }).priceAvailable, false);
  card.card_sets.push({ set_code: 'MP22-EN264', set_rarity: 'Prismatic Secret Rare', set_price: '10' });
  assert.equal(printingPriceDetails(card, { setCode: 'MP22-EN264', rarity: 'Prismatic Secret Rare' }).priceAvailable, false);
});

test('refresh updates each holding separately and preserves manual estimates, purchase costs and quantities', () => {
  const record = { tcg: { printings: [
    { id: 'manual', marketValue: 7, priceSourceType: 'manual-override', quantity: 2, purchasePrice: 4 },
    { id: 'unpriced', setCode: 'ONE', rarity: 'Rare', marketValue: 99, quantity: 3, purchasePrice: 5 },
  ] } };
  const refreshed = refreshHoldings(record, { card_sets: [] }, (base, list) => ({ ...base, printings: list }));
  assert.equal(refreshed.tcg.printings[0].marketValue, 7); assert.equal(refreshed.tcg.printings[0].purchasePrice, 4);
  assert.equal(refreshed.tcg.printings[1].priceAvailable, false); assert.equal(refreshed.tcg.printings[1].marketValue, 0);
  assert.equal(refreshed.tcg.printings[1].quantity, 3); assert.equal(record.tcg.printings[1].marketValue, 99);
});

test('real location folders, membership quantities, archive persistence, wishlist and save receipts survive reopen', t => {
  const root = temporary(t), service = createTcgOrganizations(root);
  const binder = service.save({ kind: 'binder', name: 'Expensive cards' });
  const box = service.save({ kind: 'box', name: 'Commons' });
  let record = { id: 'ash', title: 'Ash Blossom', mobileRequestId: 'owner:save', tcg: { printings: [
    { id: 'first', locationId: binder.id, quantity: 2, rarity: 'Rare', captures: [{ dataUrl: 'private' }] },
    { id: 'second', locationId: box.id, quantity: 6, rarity: 'Common' },
  ] } };
  service.syncRecord(record, service.readLocations()); service.confirm(record);
  const file = path.join(root, 'tcg', 'locations', 'binder', binder.id, 'cards', 'ash.json');
  assert.equal(JSON.parse(fs.readFileSync(file)).quantity, 2); assert(!fs.readFileSync(file, 'utf8').includes('private'));
  record = moveHolding(record, 'first', 1, box, (base, list) => ({ ...base, printings: list }));
  assert.equal(record.tcg.printings.reduce((n, p) => n + p.quantity, 0), 8);
  assert.equal(record.tcg.printings[0].quantity, 1); assert.equal(record.tcg.printings[2].rarity, 'Rare');
  assert.throws(() => moveHolding(record, 'first', 2, box, () => {}));
  service.syncRecord(record, service.readLocations()); assert.equal(JSON.parse(fs.readFileSync(file)).quantity, 1);
  service.save({ name: 'High value' }, binder);
  service.writeWishlist([{ id: 'wish', quantity: 3 }]);
  const reopened = createTcgOrganizations(root);
  assert.equal(reopened.readLocations().find(r => r.id === binder.id).name, 'High value');
  assert.equal(reopened.wishlist()[0].id, 'wish'); assert.equal(reopened.confirmed(record, 'owner:save'), true);
  assert.equal(reopened.confirmed(record, 'other:save'), false);
  service.mirror([], 'binder'); assert.equal(reopened.readLocations().some(r => r.id === binder.id), false);
  assert.equal(reopened.readLocations(true).find(r => r.id === binder.id).archived, true);
});

test('unsafe or unavailable share destinations fail before writing outside Inventory', t => {
  const root = temporary(t), service = createTcgOrganizations(root);
  assert.throws(() => service.safe(path.join(root, '..', 'outside.json')));
  assert.throws(() => createTcgOrganizations(path.join(root, 'missing')).save({ kind: 'box', name: 'Box' }), e => e.status === 503);
  assert.throws(() => service.save({ kind: '../outside', name: 'Box' }));
  assert.throws(() => service.syncRecord({ id: '../outside', tcg: { printings: [] } }, []));
});

test('printing batches retain successful entries, retry failed entries only and keep account identities isolated', async t => {
  let calls = 0, rows, failSecond = true;
  const f = await httpFixture(t, 'normal', { complete: (req, res) => {
    calls++;
    if (req.body.title === 'Second' && failSecond) return res.json({ ok: false, record: null, message: 'Simulated write failure' });
    const record = { id: 'record-' + calls, title: req.body.title, mobileRequestId: req.body.mobileRequestId };
    rows.push(record); return res.json({ ok: true, record });
  } }); rows = f.rows;
  const body = { requestId: crypto.randomUUID(), entries: ['First', 'Second'].map(title => ({ id: crypto.randomUUID(), title })) };
  const first = await (await f.call('/batches', body)).json();
  assert.equal(first.state, 'partial'); assert.equal(first.entries[0].state, 'complete'); assert.equal(calls, 2);
  assert.equal((await (await f.call('/batches', body)).json()).state, 'partial'); assert.equal(calls, 2);
  failSecond = false;
  const second = await (await f.call('/batches', { ...body, retry: true })).json();
  assert.equal(second.state, 'complete'); assert.equal(calls, 3); assert.equal(rows.length, 2);
  assert.equal((await (await f.call('/batches/' + body.requestId, undefined, { 'x-user': 'other' })).json()).state, 'unknown');
  assert.equal((await f.call('/batches', { ...body, entries: [{ ...body.entries[0], quantity: 99 }] })).status, 409);
});

test('all new mutations require write permission and index-only saves remain uncertain', async t => {
  const f = await httpFixture(t, 'normal', { saveConfirmed: () => false });
  for (const [route, method] of [['/locations', 'POST'], ['/locations/id', 'PATCH'], ['/wishlist', 'POST'], ['/wishlist/id', 'DELETE'], ['/batches', 'POST'], ['/items/id/holdings/holding/move', 'POST']]) {
    assert.equal((await f.call(route, {}, { 'x-role': 'viewer' }, method)).status, 403);
    assert.equal((await f.call(route, {}, { 'x-feature': 'off' }, method)).status, 402);
  }
  const body = { title: 'Card', requestId: crypto.randomUUID() };
  assert.equal((await (await f.call('/items', body)).json()).state, 'uncertain');
  assert.equal((await (await f.call('/items', body)).json()).state, 'uncertain'); assert.equal(f.submissions(), 1);
});


function canonicalContext(root) {
  const context = { fs, path, Buffer, console, encodeURIComponent, tcgCanonicalRoot: path.join(root, 'tcg'),
    tcgOrganizations: createTcgOrganizations(root),
    readJsonFile: (file, fallback) => { try { return JSON.parse(fs.readFileSync(file)); } catch { return fallback; } },
    readTcgLocations: () => [],
  };
  for (const name of ['slugifyTcgPathPart', 'getTcgCanonicalPaths', 'makeCanonicalTcgMetadata', 'getTcgHoldingPaths', 'summarizeTcgPrintings', 'readCanonicalTcgRecords', 'persistTcgCanonicalRecord']) context[name] = actual(name, context);
  return context;
}
test('actual canonical writer and cold reader retain multiple holdings in one set folder, edits, photos and removed groups', t => {
  const root = temporary(t), context = canonicalContext(root);
  const capture = { id: 'front', dataUrl: 'data:image/jpeg;base64,' + Buffer.from('generated-photo-fixture').toString('base64') };
  const record = { id: 'card', title: 'Ash Blossom', notes: 'Saved bio', metadata: { custom: 'keep' }, mobileRequestId: 'owner:queue', tcg: { game: 'yugioh', providerCardId: '1234', cardName: 'Ash Blossom', printings: [
    { id: 'one', setCode: 'RA01-EN001', rarity: 'Rare', condition: 'Near Mint', quantity: 2, locationId: 'loose', priceAvailable: false, captures: [capture] },
    { id: 'two', setCode: 'RA01-EN001', rarity: 'Secret Rare', condition: 'Good', quantity: 4, locationId: 'loose', marketValue: 7, priceAvailable: true, captures: [] },
  ] } };
  context.persistTcgCanonicalRecord(record);
  let reopened = context.readCanonicalTcgRecords()[0];
  assert.equal(reopened.tcg.printings.length, 2); assert.equal(reopened.tcg.quantity, 6);
  assert.equal(reopened.metadata.custom, 'keep'); assert.equal(reopened.tcg.printings[1].captures.length, 0);
  assert.equal(reopened.tcg.printings[0].captures[0].dataUrl, undefined);
  const photo = reopened.tcg.printings[0].captures[0];
  assert.equal(fs.readFileSync(path.join(reopened.tcg.printings[0]._canonicalDirectory, photo.relativePath), 'utf8'), 'generated-photo-fixture');
  assert.equal(context.tcgOrganizations.confirmed(reopened, 'owner:queue'), true);
  const edited = { ...reopened, title: 'Edited name', notes: 'Edited notes', tcg: { ...reopened.tcg, cardName: 'Edited name', printings: [{ ...reopened.tcg.printings[0], setCode: 'NEW-EN001', quantity: 3 }] } };
  context.persistTcgCanonicalRecord(edited);
  reopened = canonicalContext(root).readCanonicalTcgRecords()[0];
  assert.equal(reopened.title, 'Edited name'); assert.equal(reopened.notes, 'Edited notes');
  assert.equal(reopened.tcg.printings.length, 1); assert.equal(reopened.tcg.quantity, 3); assert.equal(reopened.tcg.printings[0].setCode, 'NEW-EN001');
  assert.equal(fs.existsSync(path.join(root, 'tcg', 'yugioh', 'edited-name', 'new-en001')), false);
  context.persistTcgCanonicalRecord({ ...reopened, tcg: { ...reopened.tcg, printings: [] } });
  assert.equal(canonicalContext(root).readCanonicalTcgRecords().length, 0);
});

test('move requests never replay a successful partial move after a lost response', async t => {
  const root = temporary(t); let moved = 0;
  const f = await httpFixture(t, 'normal', { locations: () => [{ id: 'box', kind: 'box', name: 'Commons' }],
    move: (record, holding, quantity, destination, identity) => { moved++; record.mobileRequestIds = [identity]; return record; },
    requests: createInventoryRequests(root),
  });
  f.rows.push({ id: 'card', tcg: { printings: [{ id: 'holding', quantity: 3 }] } });
  const body = { requestId: crypto.randomUUID(), quantity: 1, locationId: 'box' };
  assert.equal((await (await f.call('/items/card/holdings/holding/move', body)).json()).state, 'complete');
  assert.equal((await (await f.call('/items/card/holdings/holding/move', body)).json()).state, 'complete');
  assert.equal(moved, 1);
  assert.equal((await f.call('/items/card/holdings/holding/move', { ...body, quantity: 2 })).status, 409);
});


test('reindex normalization retains holding identities, canonical paths, photos and manual pricing history', () => {
  const make = actual('makeTcgPrinting', { makeIntakeId: () => 'unexpected-new-id', readTcgBinders: () => [], normalizeYugiohSetCode: value => value });
  const holding = plain(make({ id: 'original', setCode: 'SET-EN001', quantity: 2, locationId: 'box', _canonicalDirectory: '/safe/card/set', captures: [{ url: 'photo' }], priceSourceType: 'manual-override', manualPriceOverride: 7, priceHistory: [{ at: 'yesterday' }], marketValue: 7 }));
  assert.equal(holding.id, 'original'); assert.equal(holding._canonicalDirectory, '/safe/card/set');
  assert.equal(holding.captures[0].url, 'photo'); assert.equal(holding.manualPriceOverride, 7); assert.equal(holding.priceHistory.length, 1);
});

test('Music/YouTube manual groups retain their library, kind and exact ordered references across save', () => {
  const context = { sanitizeCustomCollectionId: id => id };
  context.normalizeCustomCollectionItem = actual('normalizeCustomCollectionItem', {});
  const normalize = actual('normalizeCustomCollectionPayload', context);
  const saved = plain(normalize({ id: 'playlist', name: 'Drive', library: 'music', libraryTab: 'playlists', items: [
    { library: 'music', sourceId: '/media/music/b.mp3', order: 2 }, { library: 'music', sourceId: '/media/music/a.mp3', order: 1 },
  ] }));
  assert.equal(saved.library, 'music'); assert.equal(saved.libraryTab, 'playlists');
  assert.deepEqual(saved.items.map(row => row.sourceId), ['/media/music/a.mp3', '/media/music/b.mp3']);
  assert(saved.items.every(row => row.library === 'music'));
  const renamed = plain(normalize({ name: 'Renamed' }, saved));
  assert.equal(renamed.library, 'music'); assert.equal(renamed.items.length, 2);
});


test('rejected concurrent batch requests cannot release another active batch lock', async t => {
  const f = await httpFixture(t), body = { requestId: crypto.randomUUID(), entries: [{ id: crypto.randomUUID(), title: 'Card' }] };
  const first = f.call('/batches', body);
  await new Promise(resolve => setTimeout(resolve, 3));
  const repeated = await Promise.all([f.call('/batches', { ...body, retry: true }), f.call('/batches', { ...body, retry: true })]);
  assert(repeated.every(response => [200, 409].includes(response.status)));
  await first;
  assert.equal(f.submissions(), 1); assert.equal(f.rows.length, 1);
});

test('canonical recovery identities cannot be discarded by a stale fast index', () => {
  const read = actual('readIntakeLibraryRecords', {
    readIntakeCollection: () => [{ id: 'card', category: 'trading-cards', tcg: {}, mobileRequestIds: ['old'] }], intakeLibraryRecordsPath: () => '',
    readCanonicalTcgRecords: () => [{ id: 'card', tcg: {}, mobileRequestIds: ['new'], captures: [{ url: 'saved.jpg' }] }],
  });
  const row = plain(read('inventory'))[0];
  assert.deepEqual(row.mobileRequestIds, ['old', 'new']); assert.equal(row.captures[0].url, 'saved.jpg');
});

test('share repair rewrites an existing queue record without invoking intake or adding copies', async t => {
  let confirmed = false, repairs = 0;
  const f = await httpFixture(t, 'normal', { saveConfirmed: () => confirmed, repair: record => { repairs++; confirmed = true; return record; } });
  const body = { requestId: crypto.randomUUID(), entries: [{ id: crypto.randomUUID(), title: 'Card' }] };
  assert.equal((await (await f.call('/batches', body)).json()).entries[0].state, 'uncertain');
  assert.equal((await f.call('/batches/' + body.requestId + '/repair', { confirmed: true }, { 'x-role': 'viewer' })).status, 403);
  const repaired = await (await f.call('/batches/' + body.requestId + '/repair', { confirmed: true })).json();
  assert.equal(repaired.state, 'complete'); assert.equal(repairs, 1); assert.equal(f.submissions(), 1); assert.equal(f.rows.length, 1);
});
