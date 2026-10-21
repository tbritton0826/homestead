const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const express = require('express');
const { createPetProfiles, createAsyncPetProfiles, registerPetProfiles } = require('../src/server/pet-profiles.cjs');
const { registerNextVersionRoutes } = require('../src/server/next-version.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-v318-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'pets'), photoRoot = path.join(dir, 'photos'); fs.mkdirSync(root); fs.mkdirSync(photoRoot);
  const options = { roots: () => [root], photoRoots: () => [photoRoot] }, service = createPetProfiles(options);
  const bella = service.create({ name: 'Bella' }), cookie = service.create({ name: 'Cookie' });
  return { dir, root, photoRoot, options, service, bella, cookie };
}
const photo = (file, content = 'generated fixture bytes') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file; };
const upload = ids => ({ kind: 'photos', petIds: JSON.stringify(ids), folder: '', name: 'dogs.jpg', requestId: crypto.randomUUID() });

test('exact shared names, nested contents, persisted membership and rename survive restart without combined profiles', t => {
  const f = fixture(t), file = photo(path.join(f.root, 'Shared Photos', 'Bella + Cookie', '2026', 'dogs.jpg'));
  let rows = f.service.list(); assert.equal(rows.length, 2);
  assert.equal(rows.find(pet => pet.id === f.bella.id).files[0].path, file);
  assert.equal(rows.find(pet => pet.id === f.cookie.id).files[0].path, file);
  const meta = path.join(f.root, f.bella.id, 'metadata.json'), data = JSON.parse(fs.readFileSync(meta));
  data.metadata.name = 'Bella renamed'; fs.writeFileSync(meta, JSON.stringify(data));
  rows = createPetProfiles(f.options).list(); assert.equal(rows.find(pet => pet.id === f.bella.id).files[0].path, file);
  assert.throws(() => f.service.record('Shared Photos'));
  const group = f.service.groups()[0]; f.service.setMembers(group.id, [f.bella.id]);
  assert.equal(f.service.record(f.cookie.id).files.length, 0); assert.ok(fs.existsSync(file));
  f.service.setMembers(group.id, []); assert.equal(f.service.record(f.bella.id).files.length, 0); assert.ok(fs.existsSync(file));
});

test('unknown, duplicate and substring names require confirmation, legacy group folders never create pets', t => {
  const f = fixture(t); f.service.create({ name: 'Teddy Bear' });
  const files = ['Bear + Cookie', 'Bella + Unknown', 'Bella + Bella'].map(name => photo(path.join(f.root, name, 'one.jpg')));
  assert.equal(f.service.list().length, 3); assert.equal(f.service.groups().every(group => !group.confirmed), true);
  assert.equal(f.service.record(f.cookie.id).files.length, 0);
  const group = f.service.groups().find(group => group.name === 'Bear + Cookie');
  assert.deepEqual(group.unresolved, ['Bear']); f.service.setMembers(group.id, [f.bella.id, f.cookie.id]);
  assert.equal(f.service.record(f.cookie.id).files[0].path, files[0]);
  f.service.create({ name: 'Bella' });
  photo(path.join(f.root, 'Shared Photos', 'Bella + Cookie', 'ambiguous.jpg'));
  assert.ok(f.service.groups().find(group => group.name === 'Bella + Cookie').unresolved.includes('Bella'));
});

test('multi-pet import, retry, new identity and restart retain one physical original', t => {
  const f = fixture(t), input = upload([f.bella.id, f.cookie.id]), bytes = Buffer.from('fixture original');
  const receipt = f.service.upload(f.bella.id, input, bytes);
  assert.match(receipt.path, /Shared Photos/); assert.equal(f.service.list().length, 2);
  assert.deepEqual(createPetProfiles(f.options).upload(f.bella.id, input, bytes), receipt);
  assert.equal(f.service.upload(f.bella.id, { ...input, requestId: crypto.randomUUID() }, bytes).path, receipt.path);
  assert.equal(f.service.catalog(false).length, 1);
  assert.equal(fs.readdirSync(path.dirname(receipt.path)).filter(name => !name.startsWith('.')).length, 1);
  assert.throws(() => f.service.upload(f.bella.id, input, Buffer.from('changed')), error => error.status === 409);
  assert.throws(() => f.service.upload(f.bella.id, { ...upload([f.bella.id]), folder: '' }, bytes), error => error.status === 409);
  assert.throws(() => f.service.upload(f.bella.id, { ...input, folder: '../escape' }, bytes));
});

test('reviewed bulk moves preserve original names, link pets and remain repeatable after process restart', t => {
  const f = fixture(t), first = photo(path.join(f.photoRoot, 'Album', 'one.jpg'), 'one'), second = photo(path.join(f.photoRoot, 'Album', 'two.jpg'), 'two');
  const input = { requestId: crypto.randomUUID(), paths: [first, second], petIds: [f.bella.id, f.cookie.id], folder: '2026/Summer' };
  const prepared = f.service.plan(input, true);
  assert.ok(fs.existsSync(first)); assert.ok(!fs.existsSync(prepared.plan.items[0].to));
  assert.deepEqual(f.service.plan(input, true), prepared);
  const result = f.service.apply(input.requestId, true); assert.ok(result.plan.items.every(item => item.done));
  assert.ok(!fs.existsSync(first)); assert.ok(!fs.existsSync(second));
  assert.deepEqual(createPetProfiles(f.options).apply(input.requestId, true), result);
  assert.equal(f.service.record(f.bella.id).files.length, 2); assert.equal(f.service.catalog(true).length, 2);
  assert.deepEqual(f.service.record(f.bella.id).files.map(file => file.path), f.service.record(f.cookie.id).files.map(file => file.path));
  assert.ok(result.plan.items[0].to.endsWith('one.jpg'));
});

test('move conflicts, changed source, changed mapping and outside/linked paths never replace originals', t => {
  const f = fixture(t), source = photo(path.join(f.photoRoot, 'one.jpg'), 'original');
  const input = { requestId: crypto.randomUUID(), paths: [source], petIds: [f.bella.id] };
  const prepared = f.service.plan(input, true); photo(prepared.plan.items[0].to, 'other');
  assert.throws(() => f.service.apply(input.requestId, true), error => error.status === 409);
  assert.equal(fs.readFileSync(source, 'utf8'), 'original');
  fs.unlinkSync(prepared.plan.items[0].to); fs.writeFileSync(source, 'changed');
  assert.throws(() => f.service.apply(input.requestId, true), error => error.status === 409);
  assert.throws(() => f.service.plan({ ...input, requestId: crypto.randomUUID(), paths: [photo(path.join(f.dir, 'private.jpg'))] }, true), error => error.status === 403);
  assert.throws(() => f.service.plan({ ...input, requestId: crypto.randomUUID() }, false), error => error.status === 403);
  assert.throws(() => f.service.plan({ ...input, petIds: ['missing'], requestId: crypto.randomUUID() }, true));
});

test('lost move response and interrupted rename reconcile without deleting a changed original', t => {
  const f = fixture(t), from = photo(path.join(f.photoRoot, 'one.jpg'), 'original');
  const input = { requestId: crypto.randomUUID(), paths: [from], petIds: [f.bella.id, f.cookie.id] };
  const { plan } = f.service.plan(input, true), item = plan.items[0];
  const journal = path.join(f.root, '.pet-operations', input.requestId + '.json');
  const data = JSON.parse(fs.readFileSync(journal)); data.items[0].started = true; fs.writeFileSync(journal, JSON.stringify(data));
  fs.renameSync(from, item.to);
  assert.ok(createPetProfiles(f.options).apply(input.requestId, true).plan.items[0].done);
  assert.equal(f.service.catalog(true).length, 1);
});

test('cross-device move verifies staged bytes before removing source and finishes a retained-source retry', t => {
  const f = fixture(t), from = photo(path.join(f.photoRoot, 'cross.jpg'), 'cross-volume original');
  const input = { requestId: crypto.randomUUID(), paths: [from], petIds: [f.bella.id] };
  const { plan } = f.service.plan(input, true), original = fs.renameSync;
  fs.renameSync = (source, destination) => { if (source === from) throw Object.assign(Error('cross volume fixture'), { code: 'EXDEV' }); return original(source, destination); };
  try { f.service.apply(input.requestId, true); } finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(plan.items[0].to, 'utf8'), 'cross-volume original'); assert.ok(!fs.existsSync(from));
  assert.equal(fs.statSync(plan.items[0].to).nlink, 1);
});

test('legacy poster files stay artwork and are excluded from shared original selection', t => {
  const f = fixture(t), file = photo(path.join(f.root, f.bella.id, 'poster.jpg'));
  assert.equal(f.service.record(f.bella.id).poster, file); assert.equal(f.service.catalog(false).length, 0);
  assert.throws(() => f.service.plan({ requestId: crypto.randomUUID(), paths: [file], petIds: [f.cookie.id] }, false));
});

test('worker-backed photo operations have the same durable catalog and receipts', async t => {
  const f = fixture(t), asyncService = createAsyncPetProfiles(f.options);
  const input = upload([f.bella.id, f.cookie.id]), bytes = Buffer.from('worker fixture');
  const receipt = await asyncService.upload(f.bella.id, input, bytes);
  assert.deepEqual(await asyncService.upload(f.bella.id, input, bytes), receipt);
  const records = await asyncService.list(); assert.equal(records.length, 2); assert.equal(records[0].files[0].path, receipt.path);
});

test('photo routes enforce session, pet entitlement, admin writes and separate Photos access', async t => {
  const f = fixture(t), app = express(); app.use(express.json());
  let role = 'owner', session = true, feature = true, photos = false, allowed = true;
  const access = {
    accessContext: () => ({ user: { role } }), canAccessLibrary: (_req, name) => name === 'photos' ? photos : allowed,
    requireSession: (_req, res, next) => session ? next() : res.status(401).json({ ok: false }),
    requireFeature: () => (_req, res, next) => feature ? next() : res.status(403).json({ ok: false })
  };
  registerPetProfiles(app, { express, service: f.service, access, config: () => ({ enabledLibraries: { family: true }, familySublibraries: { pets: true } }) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port;
  const original = photo(path.join(f.photoRoot, 'one.jpg'));
  let response = await fetch(url + '/api/pets/photo-sources'); assert.equal((await response.json()).files.length, 0);
  photos = true; response = await fetch(url + '/api/pets/photo-sources'); assert.equal((await response.json()).files.length, 1);
  role = 'child'; assert.equal((await fetch(url + '/api/pets/photo-sources')).status, 403);
  role = 'owner'; photos = false;
  response = await fetch(url + '/api/pets/photo-moves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), paths: [original], petIds: [f.bella.id] }) }); assert.equal(response.status, 403);
  session = false; assert.equal((await fetch(url + '/api/pets/photo-groups')).status, 401);
  session = true; feature = false; assert.equal((await fetch(url + '/api/pets/photo-groups')).status, 403);
  feature = true; allowed = false; assert.equal((await fetch(url + '/api/pets')).status, 403);
});

test('lightweight probe validates saved sessions, rejects revoked cookies and returns no private account data', async t => {
  const f = fixture(t), app = express(); app.use(express.json());
  registerNextVersionRoutes({ app, express, dataDir: f.dir, readSetupConfig: () => ({ adminAccount: { username: 'owner' } }), writeSetupConfig: () => {} });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port;
  let response = await fetch(url + '/api/auth/connection'), data = await response.json();
  assert.equal(data.ok, true); assert.deepEqual(Object.keys(data.user), ['id']); assert.equal(data.subscription, undefined); assert.match(response.headers.get('cache-control'), /no-store/);
  response = await fetch(url + '/api/accounts/complete-owner-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'fixture-password-318' }) });
  assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url + '/api/auth/connection')).status, 401);
  response = await fetch(url + '/api/auth/connection', { headers: { cookie } }); assert.equal(response.status, 200);
  const sessions = path.join(f.dir, 'next-version', 'sessions.json'); fs.writeFileSync(sessions, JSON.stringify([]));
  assert.equal((await fetch(url + '/api/auth/connection', { headers: { cookie } })).status, 401);
});


test('scanner rebuilds the same linked originals and excludes combined profile containers', async t => {
  const f = fixture(t), source = photo(path.join(f.root, 'Shared Photos', 'Bella + Cookie', 'Event', 'one.jpg'));
  const { scanLibrary } = require('./scanners/scan-media.cjs');
  const records = await scanLibrary('pets', f.root);
  assert.equal(Object.keys(records).length, 2);
  assert.equal(records[f.bella.id].files[0].sourcePath, source);
  assert.equal(records[f.cookie.id].files[0].sourcePath, source);
});
