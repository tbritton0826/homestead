const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const express = require('express');
const {buildBookLibrary} = require('../src/server/book-library-scan.cjs');
const {registerNextVersionRoutes} = require('../src/server/next-version.cjs');
const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
function source(text, name) {
  const start = text.indexOf(`function ${name}(`), end = text.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, name); return text.slice(start, end);
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-book-reliability-'));
  t.after(() => {assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('homestead-book-reliability-')); fs.rmSync(dir, {recursive: true, force: true});});
  return dir;
}
const file = (root, relative, type = 'ebook') => ({root, name: path.basename(relative), absolutePath: path.join(root, relative), type});

test('33 Alex Cross and 11 Maximum Ride novels remain distinct in shared series folders', () => {
  const base = path.resolve('fixture-books');
  const files = ['Alex Cross', 'Maximum Ride'].flatMap((series, i) => Array.from({length: i ? 11 : 33}, (_, n) => file(base, `James Patterson/${series}/${series} Novel ${n + 1} (${series}, ${n + 1}) -- Patterson, James.epub`)));
  const index = buildBookLibrary(files);
  assert.equal(Object.keys(index).length, 44);
  assert.equal(new Set(Object.values(index).map(row => row.title)).size, 44);
  assert.equal(Object.values(index).filter(row => row.series === 'Alex Cross').length, 33);
  assert.ok(Object.values(index).every(row => row.counts.ebooks === 1));
  const again = buildBookLibrary([...files].reverse(), index);
  assert.deepEqual(Object.keys(again).sort(), Object.keys(index).sort());
});

test('splitting a collapsed row preserves a uniquely identifiable match, file progress IDs, and independent siblings', () => {
  const base = path.resolve('fixture-books');
  const files = ['Along Came a Spider', 'Kiss the Girls'].map(title => file(base, `James Patterson/Alex Cross/${title}.epub`));
  const original = {legacy: {id: 'legacy', name: 'Alex Cross', metadata: {title: 'Alex Cross'}, poster: '/chosen.jpg',
    files: files.map((f, i) => ({path: f.absolutePath, id: `progress-file-${i}`, addedAt: '2026-01-01'}))}};
  const matches = {'books:legacy': {localId: 'legacy', title: 'Kiss the Girls', poster: '/chosen.jpg'}};
  const next = buildBookLibrary(files, original, matches);
  assert.equal(Object.keys(next).length, 2);
  assert.equal(next.legacy.files.length, 1);
  assert.equal(next.legacy.files[0].name, 'Kiss the Girls.epub');
  assert.equal(next.legacy.title, 'Kiss the Girls');
  assert.equal(next.legacy.files[0].id, 'progress-file-1');
  assert.equal(next.legacy.poster, '/chosen.jpg');
  const sibling = Object.values(next).find(row => row.id !== 'legacy');
  assert.equal(sibling.title, 'Along Came a Spider');
  assert.equal(sibling.metadata.workId, undefined);
  assert.deepEqual(sibling.splitFromIds, ['legacy']);
  assert.deepEqual(matches['books:legacy'].title, 'Kiss the Girls');
  assert.deepEqual(Object.keys(buildBookLibrary(files, next)).sort(), Object.keys(next).sort());
});

test('distinct authors/roots never merge; added formats and chapters retain the saved installation identity', () => {
  const base = path.resolve('fixture-books');
  const ebook = file(base, 'Author/City of Bones/City of Bones.epub');
  const audio = Array.from({length: 15}, (_, i) => file(base, `Author/City of Bones/audiobook/Part${i + 1}.mp3`, 'audiobook'));
  const old = {fixed: {id: 'fixed', metadata: {workId: 'known-work'}, files: [{path: ebook.absolutePath}], addedAt: '2026-01-01'}};
  const next = buildBookLibrary([ebook, ...audio, file(base, 'Another/City of Bones/City of Bones.epub'), file(base + '-other', 'Author/City of Bones/City of Bones.epub')], old);
  assert.equal(Object.keys(next).length, 3);
  assert.equal(next.fixed.files.length, 16); assert.equal(next.fixed.metadata.workId, 'known-work');
  assert.equal(next.fixed.addedAt, '2026-01-01');
  const loose = buildBookLibrary([file(base, 'Author/First.epub'), file(base, 'Author/Second.m4b', 'audiobook')]);
  assert.equal(Object.keys(loose).length, 2);
  const audioOnly = buildBookLibrary([file(base, 'Author/Series/First.m4b', 'audiobook'), file(base, 'Author/Series/Second.m4b', 'audiobook')]);
  assert.equal(Object.keys(audioOnly).length, 2);
  const formats = buildBookLibrary([file(base, 'Author/City of Bones/City of Bones.epub'), file(base, 'Author/City of Bones/ebook/Book.pdf')]);
  assert.equal(Object.keys(formats).length, 1); assert.equal(Object.values(formats)[0].counts.ebooks, 2);
});

test('actual CLI scans, live scans and repeated scans agree without rewriting match records', t => {
  const dir = fixture(t), books = path.join(dir, 'books'), data = path.join(dir, 'data');
  fs.mkdirSync(data); fs.mkdirSync(path.join(books, 'Author/Series'), {recursive: true});
  for (const title of ['First', 'Second']) fs.writeFileSync(path.join(books, `Author/Series/${title}.epub`), 'synthetic ebook');
  fs.writeFileSync(path.join(data, 'setup-config.json'), JSON.stringify({folderMappings: {books: [books]}}));
  const matched = JSON.stringify({'books:unrelated': {localId: 'unrelated', title: 'Keep my match', poster: '/chosen.jpg'}});
  fs.writeFileSync(path.join(data, 'metadata-matches.json'), matched);
  const scan = () => execFileSync(process.execPath, ['scripts/scanners/scan-media.cjs', '--library', 'books'], {cwd: root, env: {...process.env, HOMESTEAD_DATA_DIR: data, MEDIA_ROOT: dir}, stdio: 'pipe'});
  scan(); const first = JSON.parse(fs.readFileSync(path.join(data, 'media-index.json'))).libraries.books;
  assert.equal(Object.keys(first).length, 2);
  const liveCode = serverSource.slice(serverSource.indexOf('const BOOK_EBOOK_EXTENSIONS ='), serverSource.indexOf('function reconcileNestedBooksMediaIndex()'));
  const live = vm.runInNewContext(liveCode + ';scanNestedBooksLibrary', {fs, path, crypto, readSetupConfig: () => ({folderMappings: {books: [books]}}), normalizeFolderList: v => v || [], require: name => {assert.equal(name, './src/server/book-library-scan.cjs'); return {buildBookLibrary};}});
  const second = live(first, {force: true}); assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  scan(); const third = JSON.parse(fs.readFileSync(path.join(data, 'media-index.json'))).libraries.books;
  assert.deepEqual(Object.keys(third).sort(), Object.keys(first).sort());
  assert.equal(fs.readFileSync(path.join(data, 'metadata-matches.json'), 'utf8'), matched);
});

function cacheFixture({blocked = false, stored = '{}', serverMatches = {}, fail = false} = {}) {
  let value = stored;
  const context = {console: {warn() {}, error() {}}, window: {__homesteadSessionUserRole: 'member'},
    localStorage: {getItem() {if (blocked) throw Error('Storage disabled'); return value;}, setItem(_key, text) {if (blocked) throw Error('Quota'); value = text;}, removeItem() {assert.fail('Never remove a good cache on write failure');}},
    fetch: async () => {if (fail) throw Error('Offline'); return {ok: true, json: async () => ({ok: true, matches: serverMatches})};},
    HOMESTEAD_METADATA_MATCHES_KEY: 'fixture', HOMESTEAD_METADATA_MATCH_VOLATILE_FIELDS: new Set(['raw', 'files', 'originalItem', 'localItem'])};
  const names = ['normalizeMetadataMatchAlias', 'slugMetadataMatchAlias', 'uniqueMetadataMatchAliases', 'compactHomesteadMetadataMatchRecord', 'compactHomesteadMetadataMatches', 'persistHomesteadMetadataMatches', 'loadHomesteadMetadataMatches', 'syncHomesteadMetadataMatchesFromServer'];
  const api = vm.runInNewContext(names.map(name => (name.startsWith('sync') ? 'async ' : '') + source(appSource, name)).join('\n') + ';({loadHomesteadMetadataMatches,persistHomesteadMetadataMatches,syncHomesteadMetadataMatchesFromServer})', context);
  return {api, context, stored: () => value};
}
test('fresh reload with disabled/quota storage renders server matches from memory; failure preserves the last valid set', async () => {
  const matches = {'books:one': {localId: 'one', title: 'Reviewed title', poster: '/chosen.jpg'}};
  for (const blocked of [false, true]) {
    const {api} = cacheFixture({blocked, serverMatches: matches});
    await api.syncHomesteadMetadataMatchesFromServer();
    assert.equal(api.loadHomesteadMetadataMatches()['books:one'].poster, '/chosen.jpg');
    assert.equal(api.syncHomesteadMetadataMatchesFromServer.lastError, '');
  }
  const fixture = cacheFixture({stored: JSON.stringify(matches), fail: true});
  await fixture.api.syncHomesteadMetadataMatchesFromServer();
  assert.equal(fixture.api.loadHomesteadMetadataMatches()['books:one'].title, 'Reviewed title');
  assert.match(fixture.api.syncHomesteadMetadataMatchesFromServer.lastError, /could not be refreshed/);
  const original = fixture.stored(); fixture.context.localStorage.setItem = () => {throw Error('Quota');};
  fixture.api.persistHomesteadMetadataMatches({...matches, 'books:two': {localId: 'two', title: 'New match'}});
  assert.equal(fixture.stored(), original);
  assert.equal(fixture.api.loadHomesteadMetadataMatches()['books:two'].title, 'New match');
});

test('manual separation survives automatic provider grouping, disk reload and a server restart', async t => {
  const dir = fixture(t);
  const api = vm.runInNewContext(source(appSource, 'bookEditionRecordId') + '\n' + source(appSource, 'normalizeBookWorkIdentity') + ';normalizeBookWorkIdentity');
  const one = {id: 'one', metadata: {workId: 'same-wrong-provider-work'}}, two = {id: 'two', metadata: {workId: 'same-wrong-provider-work'}};
  assert.equal(api(one), api(two));
  let app, listener;
  async function start() {
    app = express(); app.use(express.json());
    registerNextVersionRoutes({app, express, dataDir: dir, readSetupConfig: () => ({}), writeSetupConfig() {}});
    listener = await new Promise(resolve => {const s = app.listen(0, '127.0.0.1', () => resolve(s));});
    return `http://127.0.0.1:${listener.address().port}/api/books/edition-links`;
  }
  const close = () => new Promise(resolve => {listener.closeAllConnections(); listener.close(resolve);});
  let url = await start(); t.after(close);
  let response = await fetch(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({links: {two: '!separate'}})});
  assert.equal(response.status, 200);
  let links = (await response.json()).links; assert.notEqual(api(one, links), api(two, links));
  await close(); url = await start(); links = (await (await fetch(url)).json()).links;
  assert.equal(links.two, '!separate'); assert.notEqual(api(one, links), api(two, links));
  const file = path.join(dir, 'next-version/book-edition-links.json'); fs.writeFileSync(file, 'damaged original');
  assert.equal((await fetch(url)).status, 503);
  assert.equal((await fetch(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({links: {}})})).status, 503);
  assert.equal(fs.readFileSync(file, 'utf8'), 'damaged original');
});

test('unreadable metadata storage fails closed rather than appearing empty and permitting overwrite', t => {
  const dir = fixture(t), file = path.join(dir, 'metadata-matches.json');
  const read = vm.runInNewContext(source(serverSource, 'readMetadataMatches') + ';readMetadataMatches', {fs, METADATA_MATCHES_FILE: file, ensureHomesteadDataDir() {}, compactMetadataMatches: value => value, console: {error() {}}});
  for (const content of ['{ broken', 'null', '[]']) {
    fs.writeFileSync(file, content); assert.throws(read, error => error.status === 503);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('bookmarks follow exact files after splitting IDs and normalizing public paths; they never attach to another novel', async () => {
  const {getBookReadingProgress} = await import('../src/utils/book-progress.js');
  const progress = {'book:legacy:/media/books/Author/Series/First.epub': {type: 'book', path: '/media/books/Author/Series/First.epub', location: 'epubcfi(fixture)', updatedAt: '2026-11-01'}};
  const first = {id: 'new-first', ebookFiles: [{path: '/mnt/books/Author/Series/First.epub', legacyPaths: ['/media/books/Author/Series/First.epub']}]};
  assert.equal(getBookReadingProgress(first, null, progress).location, 'epubcfi(fixture)');
  assert.equal(getBookReadingProgress(first, null, progress).path, first.ebookFiles[0].path);
  assert.equal(getBookReadingProgress({id: 'new-second', ebookFiles: [{path: '/mnt/books/Author/Series/Second.epub'}]}, null, progress), null);
});

test('an edition save error leaves the displayed server links unchanged instead of reporting a browser-only success', async () => {
  const start = appSource.indexOf('  const saveBookEditionLinks ='), end = appSource.indexOf('\n  const linkBookEdition =', start);
  let displayed = {one: 'group', two: 'group'}, error = '';
  const save = vm.runInNewContext('(function(){' + appSource.slice(start, end) + ';return saveBookEditionLinks;})()', {
    editionSaveInFlight: {current: false}, editionLinksBusy: false, editionLinksError: '', setEditionLinksBusy() {},
    setBookEditionLinks: value => {displayed = value;}, setEditionLinksError: value => {error = value;},
    fetch: async () => ({ok: false, json: async () => ({ok: false, message: 'Fixture save unavailable'})}),
  });
  await save({two: '!separate'});
  assert.deepEqual(displayed, {one: 'group', two: 'group'}); assert.match(error, /unavailable/);
});
