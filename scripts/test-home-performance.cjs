const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { sendIndexJson } = require('../src/server/json-response.cjs');
const { createSeerrReader } = require('../src/server/request-lifecycle.cjs');
const helpers = import('../src/utils/home-media.js');

test('Startup and first status refresh share the index; failures can retry', async () => {
  const { createSharedIndexLoader } = await helpers;
  let calls = 0;
  const load = createSharedIndexLoader(async () => ({ version: ++calls }));
  const a = load(), b = load();
  assert.equal(a, b);
  assert.deepEqual(await a, { version: 1 });
  assert.equal(await load(), await a);
  assert.deepEqual(await load(true), { version: 2 });
  let retries = 0;
  const flaky = createSharedIndexLoader(async () => ++retries === 1 ? null : { ok: true });
  assert.equal(await flaky(), null);
  assert.deepEqual(await flaky(), { ok: true });
});

test('Home resolves only displayed music tracks and retains artwork/companion data', async () => {
  const { createHomeMusicLookup } = await helpers;
  const files = Array.from({ length: 10000 }, (_, i) => ({ type: 'audio', path: `/music/${i}.mp3`, title: `Track ${i}` }));
  files.push({ type: 'image', path: '/music/cover.jpg' });
  let enriched = 0;
  const find = createHomeMusicLookup([{ name: 'Artist', files }], (file, artist, siblings) => {
    if (siblings.length) enriched++;
    return { title: file.title, artist: artist.name, path: file.path, cover: siblings.find((f) => f.type === 'image')?.path };
  });
  assert.equal(enriched, 0, 'Do not enrich the whole collection at startup');
  assert.equal(find({ path: '/music/9999.mp3' }).cover, '/music/cover.jpg');
  assert.equal(find({ path: '/music/9999.mp3' }).title, 'Track 9999');
  assert.equal(enriched, 1, 'Repeated renders must reuse matched track enrichment');
  assert.equal(find({ title: 'TRACK 8', artist: 'artist' }).path, '/music/8.mp3');
  assert.equal(enriched, 2);
  assert.equal(find({}), null);
  assert.equal(find({ title: 'not present' }), null);
});

test('Recent YouTube retains ordering and supports array/object video collections', async () => {
  const { recentYouTubeEntries } = await helpers;
  const creators = [{ id: 'a', name: 'A', videos: [{ id: 1 }, { id: 2 }] }, { id: 'b', name: 'B', videos: { x: { id: 3 }, y: { id: 4 } } }];
  assert.deepEqual(recentYouTubeEntries(creators, 3).map((v) => v.id), [4, 3, 2]);
  assert.equal(recentYouTubeEntries(creators)[0].creatorName, 'B');
  assert.deepEqual(recentYouTubeEntries([]), []);
});

test('Profile requests stay bounded and preserve input order', async () => {
  const { mapWithConcurrency } = await helpers;
  let active = 0, maximum = 0;
  const output = await mapWithConcurrency([1, 2, 3, 4, 5, 6], async (id) => {
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return id * 2;
  }, 2);
  assert.equal(maximum, 2);
  assert.deepEqual(output, [2, 4, 6, 8, 10, 12]);
  await assert.rejects(mapWithConcurrency([1], async () => { throw new Error('failed'); }), /failed/);
});

test('Index transport preserves authorized content and honors gzip negotiation', async (t) => {
  const app = express();
  const data = { libraries: { movies: Array.from({ length: 300 }, (_, id) => ({ id, name: 'Test movie', files: [] })) } };
  app.get('/index', (req, res) => sendIndexJson(req, res, data));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/index`;
  const zipped = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(zipped.headers.get('content-encoding'), 'gzip');
  assert.match(zipped.headers.get('cache-control'), /private, no-store/);
  assert.match(zipped.headers.get('vary'), /Accept-Encoding/);
  assert.deepEqual(await zipped.json(), data);
  const plain = await fetch(url, { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.deepEqual(await plain.json(), data);
});

test('Concurrent Seerr discovery requests share a fetch and config changes invalidate cache', async () => {
  let calls = 0;
  let config = { baseUrl: 'http://seerr.test', apiKey: 'test-one' };
  const reader = createSeerrReader(() => config, async (_url, options) => {
    assert(options.signal, 'Upstream fetch must have a timeout signal');
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: true, json: async () => ({ results: [{ id: calls }] }) };
  });
  const [a, b] = await Promise.all([reader.json('discover/movies', 300000), reader.json('discover/movies', 300000)]);
  assert.deepEqual(a, b);
  await reader.json('discover/movies', 300000);
  assert.equal(calls, 1);
  config = { ...config, apiKey: 'test-two' };
  await reader.json('discover/movies', 300000);
  assert.equal(calls, 2);
});

test('Failed Seerr responses are retried, not cached as successful discovery', async () => {
  let calls = 0;
  const reader = createSeerrReader(() => ({ baseUrl: 'http://seerr.test', apiKey: 'test' }), async () => ({
    ok: ++calls > 1, status: 503, json: async () => ({ message: 'upstream unavailable', results: [] }),
  }));
  await assert.rejects(reader.json('discover/tv', 300000), /upstream unavailable/);
  await reader.json('discover/tv', 300000);
  assert.equal(calls, 2);
});
