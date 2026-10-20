const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const { createPhotoLibrary, separatePhotoLibraries, photoRoots, registerPhotoLibrary } = require('../src/server/photo-library.cjs');
const { createImagePreviewer } = require('../src/server/image-preview.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-v315-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { enabledLibraries: { photos: true }, folderMappings: { photos: directory } };
  return { directory, config, service: createPhotoLibrary({ config: () => config }) };
}
const image = () => sharp({ create: { width: 2200, height: 1400, channels: 3, background: '#abcdef' } }).png().toBuffer();
test('photo upload persists original bytes and repeated replies/retries never duplicate or overwrite a photo', async t => {
  const f = fixture(t), album = f.service.create('Holiday'), request = crypto.randomUUID(), data = await image();
  const one = await f.service.upload(album.id, request, 'front.png', data);
  const again = await f.service.upload(album.id, request, 'front.png', data);
  assert.equal(one.path, again.path); assert.deepEqual(fs.readFileSync(one.path), data);
  assert.equal(f.service.list().find(row => row.id === album.id).files.length, 1);
  await assert.rejects(f.service.upload(album.id, request, 'front.png', Buffer.from('different')), error => error.status === 409);
  await assert.rejects(f.service.upload(album.id, crypto.randomUUID(), 'fake.jpg', Buffer.from('not an image')));
  for (const name of ['../outside', '.hidden', '', 'bad/name']) assert.throws(() => f.service.create(name));
  await assert.rejects(f.service.upload('0'.repeat(32), crypto.randomUUID(), 'x.png', data), error => error.status === 404);
});
test('implicit public photo alias is excluded from Adult while explicit separate mappings remain unchanged', t => {
  const f = fixture(t), normal = { sourcePath: path.join(f.directory, 'Holiday') }, adult = { sourcePath: path.join(f.directory, 'private', 'photos', 'Set') };
  f.config.folderMappings.adult = path.join(f.directory, 'private');
  const index = { libraries: { photos: { normal }, adultPhotos: { normal, adult } }, adultPhotos: { normal, adult } };
  const result = separatePhotoLibraries(index, f.config);
  assert.deepEqual(Object.keys(result.libraries.adultPhotos), ['adult']);
  assert.deepEqual(Object.keys(result.adultPhotos), ['adult']);
  assert.deepEqual(Object.keys(result.libraries.photos), ['normal']);
  assert.equal(Object.keys(index.libraries.adultPhotos).length, 2);
  f.config.folderMappings.adultPhotos = path.join(f.directory, 'intentional');
  assert.equal(separatePhotoLibraries(index, f.config), index);
  assert.deepEqual(photoRoots(f.config), [f.directory]);
});
test('photo destinations reject symlink escape and missing mounts without writing elsewhere', async t => {
  const f = fixture(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-photo-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  try { fs.symlinkSync(outside, path.join(f.directory, 'outside'), 'junction'); }
  catch (error) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; return t.skip('Host cannot create a test link'); }
  assert(!f.service.list().some(row => row.name === 'outside'));
  assert.equal(fs.readdirSync(outside).length, 0);
  f.config.folderMappings.photos = path.join(f.directory, 'missing');
  assert.throws(() => f.service.create('Album'), error => error.status === 503);
});
test('selected artwork gets bounded orientation-aware previews, concurrent reuse and source-change invalidation', async t => {
  const f = fixture(t), original = path.join(f.directory, 'selected.png'); fs.writeFileSync(original, await image());
  const preview = createImagePreviewer(path.join(f.directory, 'cache'));
  const paths = await Promise.all([preview(original, { width: 640 }), preview(original, { width: 640 })]);
  assert.equal(paths[0], paths[1]); const meta = await sharp(paths[0]).metadata();
  assert(meta.width <= 640 && meta.height <= 640); assert.equal(meta.format, 'jpeg');
  fs.writeFileSync(original, await sharp({ create: { width: 80, height: 60, channels: 3, background: '#123456' } }).png().toBuffer());
  assert.notEqual(await preview(original, { width: 640 }), paths[0]);
});
test('Photos routes require assigned library, write access and feature; receipts persist through a real HTTP upload', async t => {
  const f = fixture(t), app = express(); app.use(express.json());
  registerPhotoLibrary(app, { express, service: f.service, config: () => f.config,
    feature: (req, res, next) => req.get('x-feature') === 'off' ? res.sendStatus(402) : next(),
    access: req => ({ user: req.get('x-user') === 'none' ? null : { role: req.get('x-role') || 'owner', allowedLibraries: req.get('x-denied') ? [] : ['photos'], readOnly: req.get('x-readonly') === 'yes' } }),
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/photos/native`;
  assert.equal((await fetch(base, { headers: { 'x-user': 'none' } })).status, 403);
  assert.equal((await fetch(base, { headers: { 'x-role': 'member', 'x-denied': 'yes' } })).status, 403);
  assert.equal((await fetch(base, { headers: { 'x-feature': 'off' } })).status, 402);
  const create = headers => fetch(base + '/albums', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ name: 'New Album' }) });
  assert.equal((await create({ 'x-readonly': 'yes' })).status, 403);
  assert.equal((await create({ 'x-role': 'member' })).status, 403);
  const { album } = await (await create({})).json(), requestId = crypto.randomUUID();
  const upload = () => fetch(base + '/albums/' + album.id + '/media?' + new URLSearchParams({ requestId, name: 'x.png' }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: imageBytes });
  const imageBytes = await image();
  assert.equal((await (await upload()).json()).requestId, requestId);
  assert.equal((await (await upload()).json()).albumId, album.id);
  assert.equal((await (await fetch(base)).json()).albums.find(row => row.id === album.id).files.length, 1);
});
