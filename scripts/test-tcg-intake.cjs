const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { nativeInventoryDraft } = require('../src/server/native-inventory.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

// Execute the actual component handlers with synchronous state setters. These
// checks exercise values and requests, not string assertions about implementation.
function handler(name, context) {
  const signature = new RegExp(`^  (?:async )?function ${name}\\(`, 'm');
  const start = source.search(signature);
  assert(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return vm.runInNewContext(source.slice(start, end) + ';' + name, context);
}
function harness() {
  const state = {
    crypto: { getRandomValues: bytes => crypto.randomFillSync(bytes) },
    busy: false, mode: 'tcg-match', status: '', libraryId: 'inventory', inventoryCategory: 'trading-cards',
    tcgGame: 'yugioh', tcgCardName: 'Blazing Cartesia, the Virtuous', title: 'Blazing Cartesia, the Virtuous',
    tcgSetCode: 'MP23-EN162', tcgRarity: 'Prismatic Secret Rare', tcgEdition: 'Unlimited',
    tcgCondition: 'Near Mint', tcgLanguage: 'English', tcgQuantity: 1, tcgMarketValue: '', tcgPurchasePrice: '',
    tcgSelectedArtwork: '', tcgSelectedArtworkId: '', tcgSelectedMatch: null, tcgPrintingDraft: null,
    tcgMatches: [], tcgPhysicalCopies: [], tcgBinderOptions: [], tcgLocations: [], tcgBinderId: '', tcgBinderPage: '',
    tcgBinderPocket: '', tcgLinkedDeckIds: [], captures: [], notes: '', result: null,
    tcgBatch: [], tcgRecentItems: [], tcgBatchStats: { scanned: 0, added: 0, needsReview: 0 },
    tcgSaveInFlight: { current: false }, prepareTcgPhotos: async photos => photos,
    giveScannerFeedback() {}, onActivityChanged() {},
  };
  const names = [...Object.keys(state), 'createdRecord', 'tcgRecognition', 'tcgRecognitionMessage', 'tcgLookupMessage'];
  for (const name of names) state['set' + name[0].toUpperCase() + name.slice(1)] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  for (const name of ['cryptoRandomId', 'makeTcgPhysicalCopy', 'updateTcgPrintingDraft', 'getTcgPrintingOptions', 'applyTcgMatchToPrintingDraft', 'selectTcgDraftSetCode', 'selectTcgMatch',
    'addDraftPrintingToQueue', 'editQueuedTcgPrinting', 'getTcgEntriesForSave', 'saveSingleTcgBatchEntry', 'resetTcgScanner', 'addCurrentTcgToBatch', 'completeIntake']) {
    state[name] = handler(name, state);
  }
  return state;
}
const quote = { cardId: '95515789', cardName: 'Blazing Cartesia, the Virtuous', setCode: 'MP23-EN162', rarity: 'Prismatic Secret Rare', marketValue: 0, printingPrice: 0, priceAvailable: false, priceSourceType: 'unavailable' };
async function manualQueue(state, value = 8.75) {
  state.selectTcgMatch(quote);
  state.updateTcgPrintingDraft({ marketValue: value, quantity: 2, purchasePrice: 1.25, locationId: 'box', locationType: 'box' });
  state.captures = [{ id: 'front', name: 'card.jpg', dataUrl: 'data:image/jpeg;base64,' + Buffer.from('generated fixture').toString('base64') }];
  await state.addDraftPrintingToQueue();
}

test('HTTP LAN UUID fallback creates valid distinct save identities without randomUUID', () => {
  const state = harness(), values = Array.from({ length: 100 }, () => state.cryptoRandomId());
  assert.equal(new Set(values).size, 100);
  for (const id of values) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('manual pricing survives queue, edit, payload validation, and catalog reselection', async () => {
  const state = harness();
  await manualQueue(state);
  const saved = state.tcgPhysicalCopies[0];
  assert.equal(saved.marketValue, 8.75); assert.equal(saved.manualPriceOverride, 8.75);
  state.editQueuedTcgPrinting(saved);
  state.applyTcgMatchToPrintingDraft(quote);
  assert.equal(state.tcgPrintingDraft.marketValue, 8.75);
  state.selectTcgMatch(quote);
  assert.equal(state.tcgPrintingDraft.marketValue, 8.75);
  await state.addDraftPrintingToQueue();
  const entry = state.getTcgEntriesForSave()[0];
  const draft = nativeInventoryDraft({ ...entry, category: 'trading-cards', quantity: entry.tcg.quantity, condition: entry.tcg.condition, purchasePrice: entry.tcg.purchasePrice });
  assert.equal(draft.tcg.marketValue, 8.75); assert.equal(draft.tcg.priceSourceType, 'manual-override');
  assert.equal(draft.tcg.manualPriceOverride, 8.75); assert.equal(draft.tcg.priceAvailable, true);
  assert.equal(draft.tcg.quantity, 2); assert.equal(draft.tcg.purchasePrice, 1.25);
  assert.equal(draft.tcg.locationId, 'box'); assert.equal(draft.captures.length, 1);
});

test('an explicit zero manual estimate differs from clearing the field or choosing another printing', () => {
  const state = harness(); state.selectTcgMatch(quote);
  state.updateTcgPrintingDraft({ marketValue: 0 });
  state.applyTcgMatchToPrintingDraft(quote);
  assert.equal(state.tcgPrintingDraft.priceSourceType, 'manual-override');
  assert.equal(state.tcgPrintingDraft.priceAvailable, true); assert.equal(state.tcgPrintingDraft.manualPriceOverride, 0);
  state.updateTcgPrintingDraft({ marketValue: '' });
  assert.equal(state.tcgPrintingDraft.priceAvailable, false); assert.equal(state.tcgPrintingDraft.manualPriceOverride, null);
  state.updateTcgPrintingDraft({ marketValue: 9 });
  state.applyTcgMatchToPrintingDraft({ ...quote, setCode: 'OTHER-EN001' });
  assert.equal(state.tcgPrintingDraft.priceAvailable, false); assert.equal(state.tcgPrintingDraft.manualPriceOverride, null);
});

test('choosing the same set preserves a manual estimate and copy details; a different unknown set clears the old quote', () => {
  const state = harness(); state.selectTcgMatch(quote); state.tcgMatches = [quote];
  state.updateTcgPrintingDraft({ marketValue: 4.5, edition: '1st Edition', selectedArtwork: '/chosen.jpg', quantity: 3 });
  state.selectTcgDraftSetCode('MP23-EN162');
  assert.equal(state.tcgPrintingDraft.marketValue, 4.5); assert.equal(state.tcgPrintingDraft.priceSourceType, 'manual-override');
  assert.equal(state.tcgPrintingDraft.quantity, 3); assert.equal(state.tcgPrintingDraft.edition, '1st Edition');
  assert.equal(state.tcgPrintingDraft.selectedArtwork, '/chosen.jpg');
  state.selectTcgDraftSetCode('UNKNOWN-EN001');
  assert.equal(state.tcgPrintingDraft.priceAvailable, false); assert.equal(state.tcgPrintingDraft.manualPriceOverride, null);
});

test('Save and scan next posts the queued manual value and returns to the scanner only after confirmation', async () => {
  const state = harness(); await manualQueue(state);
  const payloads = [];
  state.fetch = async (url, options) => {
    assert.equal(url, '/api/inventory/native/batches');
    payloads.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ok: true, state: 'complete' }) };
  };
  await state.addCurrentTcgToBatch();
  assert.equal(payloads.length, 1); assert.equal(payloads[0].requestId, payloads[0].entries[0].id);
  assert.equal(payloads[0].entries[0].tcg.marketValue, 8.75);
  assert.equal(payloads[0].entries[0].tcg.manualPriceOverride, 8.75);
  assert.equal(state.mode, 'tcg-scan'); assert.equal(state.tcgPhysicalCopies.length, 0);
  assert.equal(state.tcgBatchStats.added, 1); assert.equal(state.tcgSaveInFlight.current, false);
});

test('failed or interrupted scan-next saves retain prices and stable identities for retry', async () => {
  const state = harness(); await manualQueue(state);
  const id = state.tcgPhysicalCopies[0].id, requests = [];
  let fail = true;
  state.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (fail) throw Error('Connection interrupted');
    return { ok: true, json: async () => ({ ok: true, state: 'complete' }) };
  };
  await state.addCurrentTcgToBatch();
  assert.equal(state.mode, 'tcg-match'); assert.equal(state.tcgPhysicalCopies[0].marketValue, 8.75);
  assert.match(state.status, /Connection interrupted/); assert.equal(state.tcgSaveInFlight.current, false);
  fail = false; await state.addCurrentTcgToBatch();
  assert.equal(requests[0].requestId, id); assert.deepEqual(requests[1], requests[0]);
  assert.equal(state.mode, 'tcg-scan');
});

test('review saves queued prices rather than stale generic fields, retaining only unsaved groups on partial failure', async () => {
  const state = harness(); await manualQueue(state);
  const first = state.tcgPhysicalCopies[0];
  state.tcgPhysicalCopies.push({ ...first, id: state.cryptoRandomId(), marketValue: 12, manualPriceOverride: 12 });
  const second = state.tcgPhysicalCopies[1].id;
  state.mode = 'tcg-review'; state.tcgMarketValue = '0';
  let fail = true;
  const saved = [];
  state.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.requestId === second && fail) throw Error('Share unavailable');
    saved.push(body);
    return { ok: true, json: async () => ({ ok: true, state: 'complete' }) };
  };
  await state.completeIntake();
  assert.equal(saved[0].entries[0].tcg.marketValue, 8.75);
  assert.equal(state.mode, 'tcg-review'); assert.equal(state.tcgPhysicalCopies.length, 1);
  assert.equal(state.tcgPhysicalCopies[0].marketValue, 12);
  fail = false; await state.completeIntake();
  assert.equal(saved.length, 2); assert.equal(saved[1].entries[0].tcg.marketValue, 12);
  assert.equal(state.mode, 'complete'); assert.equal(state.tcgPhysicalCopies.length, 0);
});

test('rapid repeated scan-next clicks cannot submit two simultaneous batches', async () => {
  const state = harness(); await manualQueue(state);
  let finish, calls = 0;
  state.fetch = async () => { calls++; await new Promise(resolve => { finish = resolve; }); return { ok: true, json: async () => ({ ok: true, state: 'complete' }) }; };
  const first = state.addCurrentTcgToBatch();
  await state.addCurrentTcgToBatch(); assert.equal(calls, 1);
  finish(); await first;
});
