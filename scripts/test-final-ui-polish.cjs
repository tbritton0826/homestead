const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const express = require('express');
const { libraryDiagnostics } = require('../src/server/library-diagnostics.cjs');
const { registerNextVersionRoutes } = require('../src/server/next-version.cjs');
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function source(name, text = appSource) {
  const start = text.indexOf(`function ${name}(`), end = text.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return text.slice(start, end);
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-polish-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  return 'http://127.0.0.1:' + server.address().port;
}

test('season organizer preserves Specials, deduplicates membership and keeps crossover episode order', async () => {
  const draft = await import('../src/utils/collection-draft.js');
  const show = { library: 'tv', sourceId: 'series', title: 'Series', files: [
    { type: 'video', name: 'Series.S00E01.mkv' },
    { type: 'video', name: 'Series.S01E02.mkv' },
    { type: 'video', name: 'Series.S01E01.mkv' },
    { type: 'image', name: 'Series.S01E03.jpg' },
  ] };
  assert.match(draft.collectionDraftId({}), /^draft-[a-z0-9-]+$/);
  assert.notEqual(draft.collectionDraftId({}), draft.collectionDraftId({}), 'same-name drafts get separate identities on local HTTP');
  const rows = draft.seasonRows(show);
  assert.deepEqual(rows.map(row => [row.season, row.episodes]), [[0, [1]], [1, [1, 2]]]);
  const split = draft.splitSeason(rows, 1);
  const movie = { library: 'movies', sourceId: 'film', title: 'Film', unit: 'title' };
  const interleaved = [split[0], split[2], movie, split[1]];
  const grouped = draft.groupSeason(interleaved, 1);
  assert.deepEqual(grouped[1].episodes, [2, 1], 'regrouping keeps authored episode order');
  assert.equal(grouped[2], movie);
  assert.equal(draft.membersFromRows(interleaved).length, 2, 'episodes do not duplicate series membership');
  const order = draft.watchOrderFromRows(interleaved, 'Crossovers');
  assert.deepEqual(draft.matchImportedRows(order, [show, movie]), interleaved.map((row, index) => ({ ...row, detail: draft.collectionRowLabel(row), order: index + 1, unmatched: false })));
  const ambiguous = draft.matchImportedRows({ sections: [{ items: [{ title: 'Series', type: 'tv' }] }] }, [show, { ...show, sourceId: 'other' }]);
  assert.equal(ambiguous[0].sourceId, ''); assert.equal(ambiguous[0].unmatched, true);
  const nested = draft.seasonRows({ ...show, files: [], seasons: { 2: { episodes: [{ episodeNumber: 4 }] } } });
  assert.deepEqual(nested[0].episodes, [4]); assert.equal(nested[0].season, 2);
});

test('saved collection count agrees with the actual list, excluding stale overrides and suggestions', () => {
  const names = ['normalizeSharedCollectionText', 'normalizeSharedSmartMatchText', 'normalizeTimelineMatchText', 'getSharedItemCollections', 'getSharedCollectionYear', 'makeSharedCollectionItem', 'sharedSmartTermMatchesTitle', 'sharedSmartExactTitleMatch', 'sharedSmartPhraseTitleMatch', 'sharedSmartSeedMatchesItem', 'sharedSmartTermMatchesItem', 'sortSharedMediaItems', 'buildSharedMediaCollections', 'stripSharedTitleYearSuffix', 'getSharedCollectionDateSortValue', 'getSharedCollectionDateValue', 'countSavedSharedCollections'];
  const context = { SHARED_SMART_COLLECTION_SEEDS: require('../src/data/shared-collection-presets.json') };
  const api = vm.runInNewContext(names.map(name => source(name)).join('\n') + ';({buildSharedMediaCollections,countSavedSharedCollections})', context);
  const movies = [{ id: 'iron-man', title: 'Iron Man', year: '2008' }];
  for (const customs of [[], [{ id: 'saved', name: 'My collection', generatedCollectionId: 'mcu', items: [] }]]) {
    for (const orders of [[], [{ collectionId: 'mcu', items: [] }, { collectionId: 'stale', items: [] }]]) {
      const args = [movies, [], customs, orders, [{ collectionId: 'missing' }], []];
      assert.equal(api.countSavedSharedCollections(...args), api.buildSharedMediaCollections(...args).length);
    }
  }
});

test('thumbnail URLs preserve revisions, resize local artwork only, and tolerate malformed paths', async () => {
  const { posterPreviewUrl } = await import('../src/utils/poster-preview.js');
  const url = new URL(posterPreviewUrl('/api/file?path=%2Fmedia%2Fposter.jpg&v=chosen-2'), 'https://test.invalid');
  assert.equal(url.searchParams.get('v'), 'chosen-2'); assert.equal(url.searchParams.get('width'), '360');
  assert.equal(new URL(posterPreviewUrl('/media/poster.jpg?v=3', 480), 'https://test.invalid').searchParams.get('v'), '3');
  assert.equal(posterPreviewUrl('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');
  assert.equal(posterPreviewUrl('/media/%XX.jpg'), '/media/%XX.jpg');
  assert.equal(posterPreviewUrl('/api/file?path=movie.mkv'), '/api/file?path=movie.mkv');
});

test('actual playback expansion preserves authored Specials order and never substitutes a missing episode', () => {
  const context = { URL, URLSearchParams, getPlayableMediaUrl: file => file.sourcePath || file.path || '', getLocalMediaExtraInfo: () => null };
  const found = new Set(), pending = ['getImportedWatchOrderExpandedRows', 'getImportedWatchOrderPlayable'];
  while (pending.length) {
    const name = pending.pop();
    if (found.has(name) || Object.hasOwn(context, name)) continue;
    if (!appSource.includes(`function ${name}(`)) continue;
    found.add(name);
    for (const match of source(name).matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) if (!found.has(match[1])) pending.push(match[1]);
  }
  const api = vm.runInNewContext([...found].map(name => source(name)).join('\n') + ';({getImportedWatchOrderExpandedRows,getImportedWatchOrderPlayable})', context);
  const tv = { library: 'tv', sourceId: 'series', title: 'Series', files: [1, 2].map(episode => ({ type: 'video', name: `Series.S00E0${episode}.mkv`, sourcePath: `/fixture/S00E0${episode}.mkv` })) };
  const rows = api.getImportedWatchOrderExpandedRows({ manualOrder: true, items: [{ library: 'tv', sourceId: 'series', title: 'Series', unit: 'season', season: 0, episodes: [2, 99, 1] }] }, [tv]);
  assert.deepEqual(plain(rows.map(row => row.info.episode)), [2, 99, 1]);
  assert.match(api.getImportedWatchOrderPlayable(rows[0]).url, /S00E02/);
  assert.equal(api.getImportedWatchOrderPlayable(rows[1]), null);
  assert.match(api.getImportedWatchOrderPlayable(rows[2]).url, /S00E01/);
  const legacySeries = api.getImportedWatchOrderExpandedRows({ manualOrder: true, items: [{ sourceId: 'series', library: 'tv', unit: 'series', title: 'Series' }] }, [tv]);
  assert.deepEqual(plain(legacySeries.map(row => row.info.episode)), [1, 2]);
  assert.equal(api.getImportedWatchOrderPlayable({ kind: 'item', ownedItem: tv, item: { unit: 'season', season: 42 } }), null);
});

test('read-only count review explains merged folders, ISO, empty and unavailable storage', async t => {
  const root = temporary(t);
  for (const folder of ['Movie', 'Movie alternate', 'Disc', 'Empty', 'Not indexed']) fs.mkdirSync(path.join(root, folder));
  fs.writeFileSync(path.join(root, 'Movie', 'film.mkv'), 'fixture video');
  fs.writeFileSync(path.join(root, 'Disc', 'disc.iso'), 'fixture disc');
  fs.writeFileSync(path.join(root, 'Not indexed', 'poster.jpg'), 'fixture image');
  const library = { film: { name: 'Movie', sourcePath: path.join(root, 'Movie'), sourcePaths: [path.join(root, 'Movie alternate')], files: [{ type: 'video', path: path.join(root, 'Movie', 'film.mkv') }] }, disc: { sourcePath: path.join(root, 'Disc'), files: [] }, empty: { sourcePath: path.join(root, 'Empty'), files: [] } };
  const before = fs.readdirSync(root, { recursive: true }).sort();
  const result = await libraryDiagnostics({ roots: [root, path.join(root, 'offline')], library });
  assert.equal(result.counts.folders, 5); assert.equal(result.counts.records, 3); assert.equal(result.counts.withVideo, 1);
  assert.equal(result.counts.mergedGroups, 1); assert.equal(result.counts.discOnly, 1); assert.equal(result.counts.empty, 1);
  assert.equal(result.complete, false); assert.equal(result.counts.unavailable, 1);
  assert.equal(result.problems.filter(row => row.kind === 'unindexed').length, 1);
  assert.equal(result.problems.filter(row => row.kind === 'stale').length, 0, 'an offline root never becomes a stale/empty claim');
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before, 'review never changes media');
});

test('atomic collection save and read preserve artwork, identity, specials and exact order after reopening', async t => {
  const dir = temporary(t), app = express(); app.use(express.json());
  const getCustomCollectionPath = id => ({ safeId: id, filePath: path.join(dir, id + '.json') });
  const access = { requireAdmin: (req, res, next) => req.headers['x-read-only'] ? res.sendStatus(403) : next(), accessContext: () => ({ user: {} }), canAccessLibrary: (req, library) => library !== 'books' || req.headers['x-books'] !== 'disabled' };
  const context = { app, fs, path, homesteadAccess: access, getCustomCollectionPath, getCollectionWatchOrderPath: getCustomCollectionPath,
    readJsonFile: (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : fallback,
    writeJsonFile: (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); }, console };
  const functions = ['sanitizeCustomCollectionId', 'normalizeCustomCollectionItem', 'normalizeCustomCollectionPayload', 'normalizeCollectionDraftOrder', 'reconcileCollectionOrderMembership'].map(name => source(name, serverSource)).join('\n');
  const save = serverSource.slice(serverSource.indexOf('app.post("/api/collections/custom"'), serverSource.indexOf('app.delete("/api/collections/custom/'));
  const get = serverSource.slice(serverSource.indexOf('app.get("/api/collections/watch-order/:collectionId"'), serverSource.indexOf('app.post("/api/collections/watch-order/import"'));
  vm.runInNewContext(functions + '\n' + save + '\n' + get, context);
  const url = await listen(t, app);
  const order = { sections: [{ items: [{ library: 'tv', type: 'tv', sourceId: 'series', title: 'Series', unit: 'season', season: 0, episodes: [3, 1] }] }] };
  const request = payload => fetch(url + '/api/collections/custom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let response = await request({ id: 'saved', name: 'Original', poster: 'custom-art.jpg?v=2', banner: 'banner.jpg', items: [{ library: 'tv', sourceId: 'series', title: 'Series' }], watchOrder: order });
  assert.equal(response.status, 200); const original = (await response.json()).collection;
  response = await request({ id: original.id, name: 'Renamed', watchOrder: order });
  assert.equal(response.status, 200); const saved = (await response.json()).collection;
  assert.equal(saved.id, original.id); assert.equal(saved.createdAt, original.createdAt); assert.equal(saved.poster, original.poster); assert.equal(saved.banner, original.banner);
  const read = (await (await fetch(url + '/api/collections/watch-order/' + saved.id)).json()).order;
  assert.deepEqual(read.sections[0].items[0].episodes, [3, 1]); assert.equal(read.sections[0].items[0].season, 0);
  const changed = await request({ id: saved.id, items: [{ library: 'movies', sourceId: 'movie', title: 'Added movie' }], watchOrder: saved.watchOrder });
  assert.equal(changed.status, 200);
  const changedOrder = (await changed.json()).collection.watchOrder;
  assert.deepEqual(changedOrder.sections.flatMap(section => section.items).map(row => row.sourceId), ['movie'], 'quick membership changes reconcile the persisted playback order');
  const bytes = fs.readFileSync(getCustomCollectionPath(saved.id).filePath, 'utf8');
  response = await fetch(url + '/api/collections/custom', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-books': 'disabled' }, body: JSON.stringify({ id: saved.id, watchOrder: { sections: [{ items: [{ title: 'Private book', library: 'books' }] }] } }) });
  assert.equal(response.status, 403); assert.equal(fs.readFileSync(getCustomCollectionPath(saved.id).filePath, 'utf8'), bytes);
});

test('suggestion dismissal persists across restart and remains scoped to its account', async t => {
  const dir = temporary(t);
  const makeApp = () => { const app = express(); app.use(express.json()); registerNextVersionRoutes({ app, express, dataDir: dir, readSetupConfig: () => ({ adminAccount: { username: 'owner' } }), writeSetupConfig() {} }); return app; };
  let url = await listen(t, makeApp());
  const response = await fetch(url + '/api/accounts/complete-owner-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'fixture-password-polish' }) });
  assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie').split(';')[0];
  for (const values of [['mcu'], ['ncis-universe']]) {
    assert.equal((await fetch(url + '/api/account/preferences', { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: { dismissedCollectionSuggestions: values } }) })).status, 200);
  }
  url = await listen(t, makeApp());
  const data = await (await fetch(url + '/api/account/preferences', { headers: { cookie } })).json();
  assert.deepEqual(data.preferences.dismissedCollectionSuggestions.sort(), ['mcu', 'ncis-universe']);
  assert.equal((await fetch(url + '/api/account/preferences')).status, 401);
  const accounts = JSON.parse(fs.readFileSync(path.join(dir, 'next-version/accounts.json')));
  assert.deepEqual(accounts.users.find(user => user.username === 'owner').preferences.dismissedCollectionSuggestions.sort(), ['mcu', 'ncis-universe']);
});
