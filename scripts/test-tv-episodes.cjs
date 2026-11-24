const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTVEpisodeService, registerTVEpisodes, episodeNumbers } = require('../src/server/tv-episodes.cjs');

function fixture(options = {}) {
  let time = Date.parse('2026-11-24T12:00:00Z');
  const files = new Set(['/tv/Show/S01E01.mkv', '/tv/Show/S00E01-E02.mkv']);
  const state = { series: [{ id: 10, tvdbId: 100, tmdbId: 200 }], queue: [], posts: [], calls: [],
    episodes: [1, 2, 3, 4, 5, 6].map(number => ({ id: number, seasonNumber: 1, episodeNumber: number,
      title: `Episode ${number}`, airDateUtc: number === 3 ? '2027-01-01T00:00:00Z' : number === 6 ? null : '2026-01-01T00:00:00Z',
      hasFile: number === 4, images: [{ coverType: 'screenshot', remoteUrl: 'https://artworks.thetvdb.com/one.jpg' }] })),
    releases: [{ guid: 'accepted', indexerId: 1, title: 'Show.S01E02.1080p', quality: { quality: { name: 'WEB 1080p' } }, size: 1024, indexer: 'Fixture', downloadAllowed: true, rejections: [] },
      { guid: 'rejected', indexerId: 1, title: 'Wrong release', downloadAllowed: false, rejections: ['Wrong episode'] }],
  };
  state.queue = [{ id: 50, seriesId: 10, episodeId: 5, status: 'downloading' }];
  const context = { actor: 'owner', showId: 'show', show: { id: 'show', files: Object.fromEntries([...files].map(path => [path, { path }])) }, match: { tmdbId: 200, tvdbId: 100 }, useSonarr: true, canSearch: true };
  const service = createTVEpisodeService({
    getConfig: () => ({ baseUrl: 'http://sonarr.test:8989', apiKey: 'fixture-secret' }),
    now: () => time, isFile: async file => files.has(file),
    lookupTVDB: options.lookupTVDB,
    fetchImpl: async (url, request) => {
      state.calls.push({ url, request });
      if (options.delay) await options.delay(url);
      if (options.fail?.(url, request)) throw new Error('private upstream message with fixture-secret');
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers['X-Api-Key'], 'fixture-secret');
      let data;
      if (request.method === 'POST') { state.posts.push(JSON.parse(request.body)); data = {}; }
      else if (url.endsWith('/series')) data = state.series;
      else if (url.includes('/episode?')) data = state.episodes;
      else if (url.includes('/queue?')) data = { records: state.queue, totalRecords: state.queue.length };
      else if (url.includes('/release?')) data = state.releases;
      else throw new Error(`Unexpected fixture URL ${url}`);
      return { ok: true, json: async () => data };
    },
  });
  return { context, service, state, files, advance: ms => { time += ms; } };
}

test('complete episodes combine exact local evidence, missing, upcoming, queue and unmapped Sonarr files', async () => {
  const f = fixture(), result = await f.service.list(f.context);
  assert.equal(result.episodes.length, 8); // Two locally numbered specials.
  assert.deepEqual(result.episodes.filter(e => e.season === 1).map(e => e.status), ['available', 'missing', 'upcoming', 'not-indexed', 'downloading', 'unknown']);
  assert.equal(result.episodes.find(e => e.id === '1:2').canSearch, true);
  assert.equal(result.episodes.find(e => e.id === '1:4').canSearch, false);
  assert.match(result.episodes.find(e => e.id === '1:2').artwork, /thetvdb/);
  assert.equal(f.state.posts.length, 0);
});

test('metadata reads are shared and cached, but local availability is always rechecked', async () => {
  const f = fixture();
  await Promise.all([f.service.list(f.context), f.service.list(f.context)]);
  assert.equal(f.state.calls.filter(c => c.url.endsWith('/series')).length, 1);
  assert.equal(f.state.calls.filter(c => c.url.includes('/episode?')).length, 1);
  f.files.delete('/tv/Show/S01E01.mkv');
  const result = await f.service.list(f.context);
  assert.equal(result.episodes.find(e => e.id === '1:1').status, 'missing');
});

test('provider outage or ineligible plan keeps local files without leaking credentials', async () => {
  const f = fixture({ fail: () => true });
  const result = await f.service.list(f.context);
  assert.equal(result.source, 'local');
  assert.equal(result.episodes.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|private upstream/);
  const free = fixture();
  await free.service.list({ ...free.context, useSonarr: false });
  assert.equal(free.state.calls.length, 0);
});

test('stable provider IDs are required, ambiguous or contradictory shows never search by title', async () => {
  for (const mutate of [f => { f.context.match = {}; }, f => { f.state.series.push({ id: 11, tvdbId: 100, tmdbId: 200 }); }, f => { f.context.match = { tvdbId: 100, tmdbId: 999 }; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.service.search(f.context, 2));
    assert.equal(f.state.calls.some(c => c.url.includes('/release')), false);
  }
});

test('TMDB mapping can use an explicit external TVDB identity for Sonarr versions without TMDB fields', async () => {
  const f = fixture({ lookupTVDB: async id => { assert.equal(id, 200); return 100; } });
  f.context.match = { tmdbId: 200 }; delete f.state.series[0].tmdbId;
  assert.equal((await f.service.list(f.context)).source, 'sonarr');
});

test('interactive results do not grab; only the selected accepted cached release can be submitted', async () => {
  const f = fixture(), result = await f.service.search(f.context, 2);
  assert.equal(f.state.posts.length, 0);
  assert.equal(result.releases[1].canDownload, false);
  await assert.rejects(f.service.grab(f.context, { episodeId: 2, searchToken: result.searchToken, releaseId: '1' }));
  await assert.rejects(f.service.grab(f.context, { episodeId: 2, searchToken: 'forged', releaseId: '0' }));
  const receipt = await f.service.grab(f.context, { episodeId: 2, searchToken: result.searchToken, releaseId: '0' });
  assert.equal(receipt.status, 'requested');
  assert.deepEqual(f.state.posts, [{ guid: 'accepted', indexerId: 1, episodeId: 2 }]);
});

test('search/selection is account-bound, episode-bound and expires', async () => {
  const f = fixture(), result = await f.service.search(f.context, 2);
  const body = { episodeId: 2, searchToken: result.searchToken, releaseId: '0' };
  await assert.rejects(f.service.grab({ ...f.context, actor: 'another-admin' }, body));
  await assert.rejects(f.service.grab(f.context, { ...body, episodeId: 1 }));
  f.advance(600001);
  await assert.rejects(f.service.grab(f.context, body));
  assert.equal(f.state.posts.length, 0);
});

test('concurrent selections and ambiguous provider failures never replay a write', async () => {
  for (const broken of [false, true]) {
    const f = fixture({ fail: (_url, req) => broken && req.method === 'POST' });
    const result = await f.service.search(f.context, 2), body = { episodeId: 2, searchToken: result.searchToken, releaseId: '0' };
    await Promise.allSettled([f.service.grab(f.context, body), f.service.grab(f.context, body)]);
    await f.service.grab(f.context, body).catch(() => {});
    assert.equal(f.state.calls.filter(c => c.request.method === 'POST').length, 1);
  }
});

test('fresh queue/file checks prevent downloads that became available after searching', async () => {
  for (const queued of [false, true]) {
    const f = fixture(), result = await f.service.search(f.context, 2);
    if (queued) f.state.queue.push({ seriesId: 10, episodeId: 2, status: 'downloading' });
    else { f.files.add('/tv/Show/S01E02.mkv'); f.context.show.files.new = { path: '/tv/Show/S01E02.mkv' }; }
    await assert.rejects(f.service.grab(f.context, { episodeId: 2, searchToken: result.searchToken, releaseId: '0' }));
    assert.equal(f.state.posts.length, 0);
  }
});

test('unavailable queue status never authorizes search; multi-episode and alternate numbering are explicit', async () => {
  const f = fixture({ fail: url => url.includes('/queue?') });
  assert.equal((await f.service.list(f.context)).episodes.every(e => !e.canSearch), true);
  assert.deepEqual(episodeNumbers('/show/S02E01E03.mkv'), ['2:1', '2:3']);
  assert.deepEqual(episodeNumbers('/show/2x04.mkv'), ['2:4']);
  assert.deepEqual(episodeNumbers('/show/S00E01-E03.mkv'), ['0:1', '0:2', '0:3']);
});

async function httpFixture(t, options = {}) {
  const f = fixture(options), app = express();
  app.use(express.json());
  let role = 'owner', allowed = true, plan = true, signedIn = true;
  registerTVEpisodes(app, { service: f.service, useSonarr: () => plan,
    resolveShow(_req, id) { assert.equal(id, 'show'); return f.context; },
    access: { requireSession: (_req, res, next) => signedIn ? next() : res.sendStatus(401),
      canAccessLibrary: () => allowed, accessContext: () => ({ user: { id: 'owner', role } }) },
  });
  app.get('/api/auth/connection', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = {}, origin) => fetch(base + '/api/tv/episodes/search', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ showId: 'tv:show', episodeId: 2, ...body }) });
  return { ...f, base, post, set(values) { ({ role = role, allowed = allowed, plan = plan, signedIn = signedIn } = values); } };
}

test('HTTP routes enforce session, TV permission, paid integration, admin role and same-origin browser actions', async t => {
  const f = await httpFixture(t);
  f.set({ signedIn: false }); assert.equal((await f.post()).status, 401);
  f.set({ signedIn: true, allowed: false }); assert.equal((await f.post()).status, 403);
  f.set({ allowed: true, plan: false }); assert.equal((await f.post()).status, 403);
  f.set({ plan: true, role: 'member' }); assert.equal((await f.post()).status, 403);
  f.set({ role: 'owner' }); assert.equal((await f.post({}, 'https://attacker.invalid')).status, 403);
  const result = await f.post({}, f.base);
  assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(f.state.posts.length, 0);
});

test('a slow Sonarr request does not prevent a separate health request from completing', async t => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const f = await httpFixture(t, { delay: async url => { if (url.endsWith('/series')) await wait; } });
  const list = fetch(f.base + '/api/tv/episodes?showId=tv:show');
  try {
    const health = await fetch(f.base + '/api/auth/connection', { signal: AbortSignal.timeout(2000) });
    assert.equal(health.status, 200);
  } finally { release(); }
  assert.equal((await list).status, 200);
});
