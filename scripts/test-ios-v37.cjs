const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const express = require('express');
const { createPetProfiles, registerPetProfiles } = require('../src/server/pet-profiles.cjs');
const { createComfyBridge, registerComfyBridge, validateConfiguration } = require('../src/server/comfy-bridge.cjs');
const { relatedBookRecords } = require('../src/server/book-local-files.cjs');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-v37-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const graph = { '6': { class_type: 'CLIPTextEncode', inputs: { text: 'original', clip: ['4', 1] } }, '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'generated-test-model.safetensors' } } };
const configuration = () => ({ url: 'http://comfyui:8188', promptNode: '6', workflow: structuredClone(graph) });
test('book formats join sibling audio only inside the filtered book directory or explicit work identity', () => {
  const book = { id: 'book', title: 'City of Bones', folderPath: '/books/Author/City of Bones', files: [{ path: '/books/Author/City of Bones/book.epub' }] };
  const audio = { id: 'audio', title: 'audiobook', folderPath: '/books/Author/City of Bones/audiobook', files: Array.from({ length: 15 }, (_, i) => ({ path: `/books/Author/City of Bones/audiobook/Part${i + 1}.mp3` })) };
  const other = { ...audio, id: 'other', folderPath: '/books/Other/City of Bones/audiobook' };
  assert.deepEqual(relatedBookRecords({ libraries: { books: { book }, audiobooks: { audio, other } } }, 'book'), [book, audio]);
  assert.deepEqual(relatedBookRecords({ books: { book } }, 'unknown'), []);
  assert.deepEqual(relatedBookRecords({ books: { book: { ...book, workId: 'one' } }, audiobooks: { audio: { ...audio, workId: 'two' } } }, 'book').map(row => row.id), ['book']);
  const loose = { ...book, folderPath: '/books/Author' };
  assert.deepEqual(relatedBookRecords({ books: { book: loose, second: { ...loose, id: 'second', title: 'Other title' } } }, 'book'), [loose]);
});
test('pet profile creation uses scanner-compatible metadata and preserves only pet fields', t => {
  const root = temp(t), service = createPetProfiles({ roots: () => [root] });
  assert.deepEqual(service.list(), []);
  assert.throws(() => service.create({ name: ' ' }));
  const pet = service.create({ name: 'Milo', species: 'Cat', biography: 'unapproved', braSize: 'forbidden' });
  assert.equal(pet.metadata.name, 'Milo'); assert.equal(pet.metadata.species, 'Cat'); assert.equal(pet.metadata.braSize, undefined);
  const saved = JSON.parse(fs.readFileSync(path.join(root, pet.id, 'metadata.json')));
  assert.equal(saved.metadata.name, 'Milo'); assert.equal(service.list()[0].id, pet.id);
  const input = { name: 'Repeat-safe pet', species: 'Dog', requestId: crypto.randomUUID() };
  assert.equal(service.create(input).id, service.create(input).id);
  assert.equal(service.list().length, 2);
  assert.throws(() => service.create({ ...input, name: 'Changed after timeout' }), error => error.status === 409);
});
test('pet folders and uploads preserve original bytes, destinations, metadata and retry identities', t => {
  const root = temp(t), service = createPetProfiles({ roots: () => [root] }), pet = service.create({ name: 'Milo' });
  assert.deepEqual(service.folders(pet.id, 'photos').folders, []);
  assert.equal(fs.existsSync(path.join(root, pet.id, 'photos')), false);
  service.folders(pet.id, 'photos', '', 'Summer');
  assert.equal(service.folders(pet.id, 'photos').folders[0].path, 'Summer');
  const input = { kind: 'photos', folder: 'Summer', name: 'original.heic', requestId: crypto.randomUUID() }, bytes = Buffer.from([0, 255, 3, 128]);
  const receipt = service.upload(pet.id, input, bytes);
  assert.deepEqual(fs.readFileSync(receipt.path), bytes);
  assert.deepEqual(service.upload(pet.id, input, bytes), receipt);
  assert.throws(() => service.upload(pet.id, input, Buffer.from('different')), error => error.status === 409);
  assert.throws(() => service.upload(pet.id, { ...input, folder: '../escape' }, bytes));
  assert.throws(() => service.upload(pet.id, { ...input, folder: 'Missing' }, bytes));
  assert.throws(() => service.upload(pet.id, { ...input, kind: 'documents', name: 'script.html' }, bytes));
  service.upload(pet.id, { kind: 'poster', name: 'cover.jpg', requestId: crypto.randomUUID() }, bytes);
  const fresh = service.record(pet.id);
  assert.equal(fresh.metadata.species, ''); assert.ok(fresh.poster); assert.equal(fresh.files.length, 1);
  assert.equal(fresh.files[0].path, receipt.path);
});
test('pet directory and metadata symlinks cannot escape configured roots', t => {
  const root = temp(t), outside = temp(t), service = createPetProfiles({ roots: () => [root] });
  const pet = service.create({ name: 'Milo' });
  fs.symlinkSync(outside, path.join(root, pet.id, 'photos'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => service.folders(pet.id, 'photos'), error => error.status === 403);
  assert.throws(() => service.upload(pet.id, { kind: 'photos', name: 'a.jpg', requestId: crypto.randomUUID() }, Buffer.from('x')), error => error.status === 403);
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => service.record('linked'), error => error.status === 403);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('ComfyUI setup rejects browser-format graphs, credentials, arbitrary paths and missing prompt inputs', () => {
  for (const url of ['file:///tmp', 'http://user:secret@host', 'http://host/path', 'http://host?secret=x', 'http://169.254.169.254']) assert.throws(() => validateConfiguration({ ...configuration(), url }));
  assert.throws(() => validateConfiguration({ ...configuration(), workflow: { nodes: [] } }));
  assert.throws(() => validateConfiguration({ ...configuration(), promptNode: 'missing' }));
  assert.deepEqual(validateConfiguration(configuration()), configuration());
});
test('ComfyUI submits once, keeps workflow settings, isolates jobs and restores them after restart', async t => {
  const directory = temp(t); let submissions = 0, submitted;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/prompt')) { submissions++; submitted = JSON.parse(options.body); return Response.json({ prompt_id: 'generated-prompt' }); }
    if (url.includes('/history/')) return Response.json({ 'generated-prompt': { status: { completed: true }, outputs: { '9': { images: [{ filename: 'image.png', subfolder: 'test', type: 'output' }, { filename: '../private.png', type: 'output' }] } } } });
    return new Response(Buffer.from([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
  };
  const service = createComfyBridge({ directory, fetchImpl }); service.save(configuration());
  const requestId = crypto.randomUUID(), input = { requestId, prompt: 'generated fixture prompt' };
  await Promise.all([service.generate('owner', input), service.generate('owner', input)]);
  assert.equal(submissions, 1); assert.equal(submitted.prompt['6'].inputs.text, input.prompt);
  assert.equal(submitted.prompt['4'].inputs.ckpt_name, graph['4'].inputs.ckpt_name);
  assert.equal(service.config().workflow['6'].inputs.text, 'original');
  await assert.rejects(service.status(requestId, 'other'), error => error.status === 404);
  const restored = createComfyBridge({ directory, fetchImpl });
  const status = await restored.status(requestId, 'owner'); assert.equal(status.state, 'complete'); assert.equal(status.imageCount, 1);
  assert.equal((await restored.image(requestId, 'owner', 0)).mime, 'image/png');
  await restored.generate('owner', input); assert.equal(submissions, 1);
});
test('ComfyUI interrupted POST stays uncertain and is not silently replayed', async t => {
  let calls = 0;
  const service = createComfyBridge({ directory: temp(t), fetchImpl: async () => { calls++; throw new Error('generated network failure'); } });
  service.save(configuration()); const input = { requestId: crypto.randomUUID(), prompt: 'fixture' };
  await assert.rejects(service.generate('owner', input), error => error.status === 502);
  assert.equal((await service.generate('owner', input)).state, 'uncertain'); assert.equal(calls, 1);
  assert.equal(service.forget(input.requestId, 'owner').ok, true);
});
test('ComfyUI connection can be saved and tested before choosing a workflow, with generation disabled', async t => {
  const calls = [];
  const service = createComfyBridge({ directory: temp(t), fetchImpl: async url => { calls.push(url); return Response.json({ system: {} }); } });
  service.save({ url: 'http://comfyui:8188', promptNode: '', workflow: null });
  assert.equal((await service.test()).ok, true);
  await assert.rejects(service.generate('owner', { requestId: crypto.randomUUID(), prompt: 'fixture' }), error => error.status === 409);
  assert.deepEqual(calls, ['http://comfyui:8188/system_stats']);
  assert.throws(() => validateConfiguration(null));
});
test('an unreadable image job store preserves its bytes and cannot break Homestead startup or replay jobs', async t => {
  const directory = temp(t), file = path.join(directory, 'comfy-jobs.json');
  fs.writeFileSync(file, 'generated corrupt fixture');
  const service = createComfyBridge({ directory, fetchImpl: () => { throw new Error('Must not contact provider'); } });
  await assert.rejects(service.generate('owner', { requestId: crypto.randomUUID(), prompt: 'fixture' }), error => error.status === 503);
  assert.equal(fs.readFileSync(file, 'utf8'), 'generated corrupt fixture');
});
async function start(t, app) {
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('pet and ComfyUI routes enforce sessions, entitlements, library access and write roles', async t => {
  const root = temp(t), app = express(); app.use(express.json());
  const access = {
    requireSession: (req, res, next) => req.get('x-role') ? next() : res.sendStatus(401),
    requireFeature: () => (req, res, next) => req.get('x-feature') === 'off' ? res.sendStatus(402) : next(),
    accessContext: req => ({ user: { id: req.get('x-role'), role: req.get('x-role') } }),
    canAccessLibrary: req => req.get('x-library') !== 'off',
    requireOwner: (req, res, next) => req.get('x-role') === 'owner' ? next() : res.sendStatus(403)
  };
  registerPetProfiles(app, { express, service: createPetProfiles({ roots: () => [root] }), access, config: () => ({ enabledLibraries: { family: true } }) });
  registerComfyBridge(app, { service: createComfyBridge({ directory: path.join(root, 'state') }), access, pluginEnabled: () => true });
  const base = await start(t, app), headers = { 'x-role': 'owner', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/pets')).status, 401);
  assert.equal((await fetch(base + '/api/pets', { headers: { ...headers, 'x-feature': 'off' } })).status, 402);
  assert.equal((await fetch(base + '/api/pets', { headers: { ...headers, 'x-library': 'off' } })).status, 403);
  assert.equal((await fetch(base + '/api/pets', { method: 'POST', headers: { ...headers, 'x-role': 'child' }, body: '{"name":"test"}' })).status, 403);
  const response = await fetch(base + '/api/pets', { method: 'POST', headers, body: '{"name":"Milo"}' });
  const id = (await response.json()).record.id;
  const upload = await fetch(base + `/api/pets/${id}/media?kind=photos&name=a.heic&requestId=${crypto.randomUUID()}`, { method: 'POST', headers: { 'x-role': 'owner', 'Content-Type': 'application/octet-stream' }, body: Buffer.from([0, 255, 128]) });
  assert.equal(upload.status, 200);
  assert.equal((await fetch(base + '/api/ai/comfy/config', { headers: { 'x-role': 'child' } })).status, 403);
  assert.equal((await fetch(base + '/api/ai/comfy/config', { headers: { ...headers, 'x-feature': 'off' } })).status, 402);
  assert.equal((await fetch(base + '/api/ai/comfy/config', { method: 'PUT', headers: { ...headers, 'x-role': 'admin' }, body: JSON.stringify(configuration()) })).status, 403);
});
