const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createProfileFolderService, registerProfileFolderRoutes, canEditProfileFolder, relativeParts } = require('../src/server/profile-media-folders.cjs');
const { registerBookLocalFiles } = require('../src/server/book-local-files.cjs');
const typeFolders = { photo: 'photos', nude: 'nudes', artwork: 'artwork', reference: 'references' };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-v36-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, 'personal'), profile = path.join(library, 'example');
  fs.mkdirSync(profile, { recursive: true });
  const service = createProfileFolderService({ roots: () => [library], findProfile: (_, id) => path.join(library, id), typeFolders });
  return { root, profile, library, service };
}
test('folder browsing does not create directories; create and nested selection stay category/profile scoped', t => {
  const { profile, service } = fixture(t);
  assert.deepEqual(service.list(profile, 'photo'), { ok: true, version: 1, parent: '', folders: [] });
  assert.equal(fs.existsSync(path.join(profile, 'photos')), false);
  assert.equal(service.create(profile, 'photo', '', 'Summer 2026').path, 'Summer 2026');
  service.create(profile, 'photo', 'Summer 2026', 'Beach');
  assert.equal(service.directory(profile, 'photo', 'Summer 2026/Beach'), path.join(profile, 'photos', 'Summer 2026', 'Beach'));
  assert.deepEqual(service.list(profile, 'photo', 'Summer 2026').folders, [{ name: 'Beach', path: 'Summer 2026/Beach' }]);
  assert.deepEqual(service.list(profile, 'nude').folders, []);
  assert.throws(() => service.create(profile, 'photo', '', 'Summer 2026'), e => e.status === 409);
  assert.equal(service.directory(profile, 'photo', 'missing'), null);
});
test('folder paths reject traversal, absolute paths, separators, hidden folders and excessive depth', t => {
  const { profile, service } = fixture(t);
  for (const name of ['..', '.', '../other', 'a/../b', '/tmp', 'C:\\Windows', 'one\\two', 'a//b', '.private', ' space', 'bad\nname', 'a/'.repeat(13)]) {
    assert.throws(() => relativeParts(name), name);
    assert.throws(() => service.directory(profile, 'photo', name, true), name);
  }
  assert.throws(() => service.resolveProfile('personal', '../other'));
  assert.throws(() => service.resolveProfile('pets', 'example'));
  assert.throws(() => service.directory(profile, 'poster', 'anything', true));
});
test('linked subfolders cannot escape into another profile or an external directory', t => {
  const { root, profile, service } = fixture(t);
  fs.mkdirSync(path.join(profile, 'photos'));
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  try { fs.symlinkSync(outside, path.join(profile, 'photos', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating test symlinks requires host permission'); throw error; }
  assert.throws(() => service.directory(profile, 'photo', 'linked', true), e => e.status === 403);
  assert.throws(() => service.create(profile, 'photo', 'linked', 'escape'), e => e.status === 403);
  assert.equal(fs.existsSync(path.join(outside, 'escape')), false);
  assert.deepEqual(service.list(profile, 'photo').folders, []);
});
test('profile resolution rejects a linked profile outside configured roots', t => {
  const { root, library, service } = fixture(t);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  try { fs.symlinkSync(outside, path.join(library, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Creating test symlinks requires host permission'); throw error; }
  assert.throws(() => service.resolveProfile('personal', 'linked'), e => e.status === 403);
});

async function start(t, app) {
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('folder HTTP APIs enforce edit permission and return relative paths without metadata', async t => {
  const { service } = fixture(t);
  const app = express(); app.use(express.json());
  const requireAdmin = (req, res, next) => req.get('x-test-role') === 'owner' ? next() : res.sendStatus(403);
  registerProfileFolderRoutes(app, { service, requireAdmin, requireAdult: (req, res, next) => req.get('x-test-feature') === 'disabled' ? res.sendStatus(402) : next(), canEditProfile: (_, library, id) => library === 'personal' && id === 'example' });
  const base = await start(t, app), suffix = '/api/adult/profile-folders';
  const payload = { library: 'personal', profileId: 'example', type: 'photo', parent: '', name: 'Chosen' };
  assert.equal((await fetch(base + suffix + '?library=personal&profileId=example')).status, 403);
  assert.equal((await fetch(base + suffix + '?library=personal&profileId=other', { headers: { 'x-test-role': 'owner' } })).status, 403);
  assert.equal((await fetch(base + suffix + '?library=personal&profileId=example', { headers: { 'x-test-role': 'owner', 'x-test-feature': 'disabled' } })).status, 402);
  assert.equal((await fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })).status, 403);
  const created = await fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': 'owner' }, body: JSON.stringify(payload) });
  assert.equal(created.status, 200); assert.equal((await created.json()).path, 'Chosen');
  const listed = await fetch(base + suffix + '?library=personal&profileId=example', { headers: { 'x-test-role': 'owner' } });
  assert.equal(listed.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await listed.json()).folders, [{ name: 'Chosen', path: 'Chosen' }]);
});
test('profile folder authorization honors disabled sections, child/read-only accounts and linked profile boundaries', () => {
  const config = { enabledLibraries: { adult: true } };
  assert.equal(canEditProfileFolder({ user: { role: 'owner' }, fullAdultAccess: true }, config, 'personal', 'one'), true);
  assert.equal(canEditProfileFolder({ user: { role: 'owner' }, fullAdultAccess: true }, { ...config, adultSublibraries: { personalProfiles: false } }, 'personal', 'one'), false);
  assert.equal(canEditProfileFolder({ user: { role: 'child' }, fullAdultAccess: true }, config, 'personal', 'one'), false);
  const linked = { user: { role: 'admin' }, adultAccessMode: 'linked-profile', linkedAdultProfileId: 'one' };
  assert.equal(canEditProfileFolder(linked, config, 'personal', 'one'), true);
  assert.equal(canEditProfileFolder(linked, config, 'personal', 'two'), false);
  assert.equal(canEditProfileFolder(linked, config, 'performers', 'one'), false);
  assert.equal(canEditProfileFolder({ user: { role: 'admin' }, adultSublibraryAccess: { performers: true } }, config, 'performers', 'one'), true);
});
test('book format lookup uses filtered identities and never accepts an arbitrary folder as authorization', async t => {
  const app = express();
  const visible = { books: { allowed: { id: 'allowed', files: [{ path: '/books/Author/Title/audiobook/Part02.mp3' }, { path: '/books/Author/Title/audiobook/Part01.mp3' }] } } };
  registerBookLocalFiles(app, {
    requireSession: (req, res, next) => req.get('x-test-role') ? next() : res.sendStatus(401),
    authorizedIndex: () => ({ libraries: visible }),
  });
  const base = await start(t, app);
  assert.equal((await fetch(base + '/api/books/local-files?recordId=allowed')).status, 401);
  const options = { headers: { 'x-test-role': 'member' } };
  assert.equal((await fetch(base + '/api/books/local-files?recordId=denied&folder=/secret', options)).status, 404);
  assert.equal((await fetch(base + '/api/books/local-files?recordId=__proto__', options)).status, 404);
  const response = await fetch(base + '/api/books/local-files?recordId=books:allowed', options);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).records, [visible.books.allowed]);
});
test('actual upload writer saves binary bytes in the selected existing folder and rejects a missing folder', t => {
  const { profile, service } = fixture(t);
  service.create(profile, 'photo', '', 'Selected');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  const start = source.indexOf('function saveAdultUploadedMediaToProfile('), end = source.indexOf('\napp.post(["/api/adult/import-upload"', start);
  assert.ok(start > 0 && end > start);
  const context = { fs, path, profileFolderService: service, ADULT_IMPORT_TYPE_FOLDERS: typeFolders,
    ADULT_IMPORT_VIDEO_EXTS: new Set(['.mp4']), ADULT_IMPORT_MAX_VIDEO_BYTES: 10000, ADULT_IMPORT_MAX_IMAGE_BYTES: 10000,
    sanitizeAdultImportSegment: s => s, extensionFromContentType: () => '.jpg', isAllowedAdultImportMedia: () => true,
    inferAdultUploadMediaType: () => 'image', Date: class extends Date { static now() { return 1800000000000; } } };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const bytes = Buffer.from([0, 255, 32, 128]), file = { originalName: 'fixture.jpg', contentType: 'image/jpeg', buffer: bytes };
  const result = context.saveAdultUploadedMediaToProfile({ file, profileDir: profile, importType: 'photo', destinationFolder: 'Selected', sourceName: 'test' });
  assert.equal(path.dirname(result.destination), path.join(profile, 'photos', 'Selected'));
  assert.deepEqual(fs.readFileSync(result.destination), bytes);
  assert.throws(() => context.saveAdultUploadedMediaToProfile({ file, profileDir: profile, importType: 'photo', destinationFolder: 'Selected', sourceName: 'test' }), error => error.code === 'EEXIST');
  assert.throws(() => context.saveAdultUploadedMediaToProfile({ file, profileDir: profile, importType: 'photo', destinationFolder: 'missing' }));
  assert.match(source, /app\.post\(\["\/api\/adult\/import-upload", "\/api\/adult\/profile-media-upload"\], homesteadAccess\.requireAdmin/);
});
