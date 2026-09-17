const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { lifecycle, findOwned, progressOf, mergeRequests, createSeerrReader } = require('../src/server/request-lifecycle.cjs');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
function source(name, text = app) {
  const start = text.indexOf(`function ${name}(`), end = text.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return text.slice(start, end);
}
const movie = { library: 'movies', tmdbId: 399566, title: 'Godzilla vs. Kong', year: '2021' };
const folder = { id: 'kong-2021', name: 'Godzilla vs. Kong (2021)', files: [{ path: '/media/movies/kong/movie.mkv' }] };
const owned = findOwned(movie, [folder], () => ({ tmdbId: 399566 }), () => true);
assert.equal(owned.id, folder.id);
assert.equal(findOwned(movie, [folder], () => ({ tmdbId: 1234 }), () => true), null, 'conflicting IDs must never be title-matched');
assert.equal(findOwned(movie, [folder], () => null, () => false), null, 'missing files are not available');
assert.equal(findOwned(movie, [folder], () => null, () => true).id, folder.id, 'exact title + year works before auto match');
assert.equal(findOwned(movie, [folder, { ...folder, id: 'other' }], () => null, () => true), null, 'ambiguous matches need review');
assert.equal(findOwned(movie, [{ ...folder, files: [{ path: '/media/kong/trailer.mp4' }] }], () => null, () => true), null);
assert.equal(findOwned(movie, [{ ...folder, files: [] }], () => null, () => true), null);
assert.equal(lifecycle({ library: 'movies', mediaInfo: { status: 3 }, owned }).status, 'available', 'playable local movie wins over stale Processing');
assert.equal(lifecycle({ library: 'movies', mediaInfo: { status: 5 } }).status, 'scanning', 'provider availability is not local availability');
assert.equal(lifecycle({ library: 'movies', downloads: [{ status: 'completed', progress: 1 }] }).status, 'importing');
assert.equal(lifecycle({ library: 'movies', downloads: [{ status: 'downloading', size: 100, sizeleft: 25 }] }).percent, 75);
assert.equal(lifecycle({ library: 'movies', downloads: [{ status: 'warning', trackedDownloadState: 'importBlocked' }] }).status, 'needs-attention');
assert.equal(lifecycle({ library: 'movies', mediaInfo: { status: 5 }, scan: { error: 'Permission denied' } }).status, 'needs-attention');
assert.equal(lifecycle({ library: 'tv', mediaInfo: { status: 3 }, owned }).status, 'partial', 'one TV episode is not an entire request');
assert.equal(lifecycle({ library: 'tv', mediaInfo: { status: 5 }, owned }).status, 'available');
assert.equal(lifecycle({ library: 'movies', requestStatus: 3 }).status, 'declined', 'Seerr request status 3 is not media Processing');
assert.equal(lifecycle({ library: 'movies', requestStatus: 1 }).status, 'pending');
assert.equal(progressOf({}), null); assert.equal(progressOf({ percentage: 1 }), 1); assert.equal(progressOf({ progress: 0.5 }), 50);
const merged = mergeRequests([{ ...movie, id: 'local' }, { ...movie, id: 'remote', status: 'available' }, { library: 'tv', tmdbId: movie.tmdbId }]);
assert.equal(merged.length, 2); assert.equal(merged.find((row) => row.library === 'movies').status, 'available');

// Run real collection construction and payload normalization, not just markers.
const presets = JSON.parse(fs.readFileSync(path.join(root, 'src/data/shared-collection-presets.json')));
const collectionNames = ['normalizeSharedCollectionText', 'normalizeSharedSmartMatchText', 'normalizeTimelineMatchText', 'getSharedItemCollections', 'getSharedCollectionYear', 'makeSharedCollectionItem', 'sharedSmartTermMatchesTitle', 'sharedSmartExactTitleMatch', 'sharedSmartPhraseTitleMatch', 'sharedSmartSeedMatchesItem', 'sharedSmartTermMatchesItem', 'sortSharedMediaItems', 'buildSharedMediaCollections'];
collectionNames.push('stripSharedTitleYearSuffix', 'getSharedCollectionDateSortValue', 'getSharedCollectionDateValue');
const collectionContext = { SHARED_SMART_COLLECTION_SEEDS: presets };
const build = vm.runInNewContext(`${collectionNames.map((name) => source(name)).join('\n')}; buildSharedMediaCollections`, collectionContext);
const movies = [{ id: 'iron-man', title: 'Iron Man', year: '2008' }, { id: 'furious-7', title: 'Furious 7' }];
const generated = build(movies, [], [], [], []).find((row) => row.id === 'mcu');
assert.equal(generated.items.length, 1);
const edited = { ...generated, generatedCollectionId: 'mcu', source: 'custom', items: [...generated.items, { library: 'movies', sourceId: 'furious-7', title: 'Furious 7' }], poster: 'saved-art.jpg', banner: 'saved-banner.jpg' };
const after = build(movies, [], [edited], [], []);
assert.equal(after.filter((row) => row.id === 'mcu').length, 1, 'no duplicate original + custom collection');
assert.equal(after.find((row) => row.id === 'mcu').items.length, 2);
assert.equal(after.find((row) => row.id === 'mcu').poster, 'saved-art.jpg');
assert.equal(build(movies, [], [{ ...edited, items: [] }], [], []).find((row) => row.id === 'mcu').items.length, 0, 'removed members do not reappear through smart matching');
const normalize = vm.runInNewContext(['sanitizeCustomCollectionId', 'normalizeCustomCollectionItem', 'normalizeCustomCollectionPayload'].map((name) => source(name, server)).join('\n') + '; normalizeCustomCollectionPayload');
assert.equal(normalize(edited).generatedCollectionId, 'mcu');
assert.equal(normalize(edited).items[1].sourceId, 'furious-7');
assert.equal(normalize({ name: 'Renamed' }, normalize(edited)).generatedCollectionId, 'mcu');
assert(!app.includes('const SHARED_SMART_COLLECTION_SEEDS = ['));
assert(app.includes('Add / Remove Movies, TV & Books'));
assert(app.includes('setCustomCollectionEditor(collection); setSelectedSharedCollectionId("");'));

const preview = vm.runInNewContext(`${source('getSeerrPreviewStatus')}; getSeerrPreviewStatus`);
assert.equal(preview({ id: 399566, mediaInfo: { status: 3 } }, { movies: [{ tmdbId: 399566, status: 'available', checkedAt: 'now' }] }), 'available');
assert.equal(preview({ id: 399566, mediaInfo: { status: 5 } }, { movies: [{ tmdbId: 399566, status: 'scanning', checkedAt: 'now' }] }), 'scanning');
const trailers = vm.runInNewContext(`${source('getTrailerCandidateFromDetails')}\n${source('buildYouTubeTrailerSource')}\n${source('buildTrailerSource')}; ({getTrailerCandidateFromDetails, buildTrailerSource})`, { URL, URLSearchParams });
const trailer = { name: 'Official Trailer', site: 'YouTube', key: 'Abc12345_-Z', type: 'Trailer' };
assert.equal(trailers.getTrailerCandidateFromDetails({ item: { relatedVideos: [trailer] } }, {}, {}).key, trailer.key);
assert(trailers.buildTrailerSource(trailer).src.includes('/embed/Abc12345_-Z'));
assert.equal(trailers.buildTrailerSource({ url: 'javascript:alert(1)' }), null);
const detail = app.slice(app.indexOf('function SeerrMediaDetail('), app.indexOf('function normalizeMembershipSourceId('));
assert(!detail.includes('Watchlist')); assert(!detail.includes('Collection support coming later'));
assert(detail.includes('ratings.imdb')); assert(detail.includes('openCollection')); assert(detail.includes('setInterval(refresh, 5000)'));
assert(!detail.includes('setInterval(loadMediaDetails')); assert(detail.includes('fromSearch: true'));
assert(source('MovieDetail').includes('watchlist')); assert(source('TVShowDetail').includes('watchlist'));

async function run() {
  const displayFormat = await import("../src/utils/display-format.js");
  // Execute the real snapshot route against fake providers and account contexts.
  const routeStart = server.indexOf('app.get("/api/requests/status"');
  const routeEnd = server.indexOf('\napp.get("/api/integrations/seerr/media/:mediaType/:tmdbId/status"', routeStart);
  let snapshotHandler;
  const requestRows = { movies: [{ tmdbId: 1, title: 'Mine', requestedByUserId: 'member' }, { tmdbId: 2, title: 'Private', requestedByUserId: 'other' }], music: [{ id: 'song', title: 'Music private', requestedByUserId: 'other' }] };
  const routeContext = {
    app: { get(_route, _guard, handler) { snapshotHandler = handler; } },
    homesteadAccess: { requireSession() {}, accessContext: (req) => ({ user: req.user }), canAccessLibrary: (req, library) => req.user.role === 'owner' || library === 'movies' },
    requestLifecycle: require('../src/server/request-lifecycle.cjs'), readRequests: () => requestRows, readAcquisitionJobs: () => [{ id: 'book', title: 'Private book', library: 'books' }],
    getSeerrConfig: () => ({ baseUrl: 'http://provider', apiKey: 'test' }),
    seerrReader: { requests: async () => [{ id: 10, type: 'movie', media: { tmdbId: 1 } }, { id: 11, type: 'movie', media: { tmdbId: 2 } }, { id: 12, type: 'tv', media: { tmdbId: 3 } }], peek: (url) => ({ title: url }), warm() {} },
    reconcileSeerrRequest: (_req, row) => ({ ...row, status: 'requested' }), fs: { statSync: () => ({ mtimeMs: 123 }) }, path, dataDir: '/test',
  };
  vm.runInNewContext(server.slice(routeStart, routeEnd), routeContext);
  let payload;
  await snapshotHandler({ user: { id: 'member', role: 'member' } }, { setHeader() {}, json(data) { payload = data; } });
  assert.equal(payload.rows.length, 1); assert.equal(payload.rows[0].tmdbId, 1);
  assert.equal(JSON.stringify(payload.allowedLibraries), '["movies"]');
  assert.equal(payload.counts.movies, 1); assert.equal(payload.counts.books, undefined, 'restricted libraries must not leak counts');
  await snapshotHandler({ user: { id: 'owner', role: 'owner' } }, { setHeader() {}, json(data) { payload = data; } });
  assert.equal(payload.counts.movies, 2); assert.equal(payload.counts.tv, 1); assert.equal(payload.counts.books, 1);
  routeContext.seerrReader.requests = async () => { throw new Error('Provider offline'); };
  await snapshotHandler({ user: { id: 'member', role: 'member' } }, { setHeader() {}, json(data) { payload = data; } });
  assert.equal(payload.rows.length, 1); assert.equal(payload.warnings[0], 'Provider offline', 'an outage must keep local requests');

  let calls = 0;
  const reader = createSeerrReader(() => ({ baseUrl: 'http://provider', apiKey: 'test' }), async (url) => {
    calls++;
    const skip = Number(new URL(url).searchParams.get('skip') || 0);
    return { ok: true, json: async () => ({ pageInfo: { results: 170 }, results: Array.from({ length: skip === 0 ? 100 : 70 }, (_, i) => ({ id: i + skip })) }) };
  });
  assert.equal((await reader.requests()).length, 170, 'all request pages, not the first 20');
  assert.equal(calls, 2);
  await Promise.all([reader.requests(), reader.requests()]); assert.equal(calls, 2, 'shared polling is cached');
  await reader.json('request?take=100&skip=0&sort=added', 0); assert.equal(calls, 3, 'fresh lifecycle reads cannot inherit long metadata TTLs');
  const { transformWithOxc } = await import('vite');
  const text = fs.readFileSync(path.join(root, 'src/components/RequestRows.jsx'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
  const code = await transformWithOxc(text, 'rows.jsx', { jsx: { runtime: 'classic' } });
  const components = vm.runInNewContext(`${code.code}; ({RequestRows, REQUEST_TYPES, RequestStatePill})`, { React, useRef: React.useRef, ...displayFormat });
  const rows = components.REQUEST_TYPES.map(([library], i) => ({ id: `${library}:${i}`, library, title: `Test ${library}`, status: 'available', createdAt: '2026-08-31' }));
  const html = renderToStaticMarkup(React.createElement(components.RequestRows, { snapshot: { rows }, onSelect() {} }));
  assert.equal((html.match(/class="request-media-section"/g) || []).length, 5);
  assert.equal((html.match(/class="request-poster-scroller"/g) || []).length, 5);
  assert.equal((html.match(/request-state-pill state-available/g) || []).length, 5);
  const hidden = renderToStaticMarkup(React.createElement(components.RequestRows, { snapshot: { rows, allowedLibraries: ['movies'] }, onSelect() {} }));
  assert(!hidden.includes('TV requests'));
  const start = app.indexOf('const countCollection ='), end = app.indexOf('  const filtered = people.filter(', start);
  const stats = vm.runInNewContext(`${app.slice(start, end)}; activeStats`, { mediaIndex: null, setupConfig: {}, activeLibrary: 'requests', activePlugin: null, pluginHostSummary: {}, requests: {}, requestSnapshot: { counts: { movies: 4, tv: 5, books: 6, music: 7, youtube: 8 } }, REQUEST_TYPES: components.REQUEST_TYPES });
  assert.equal(JSON.stringify(stats), JSON.stringify(['4 Movies Requests', '5 TV Requests', '6 Books Requests', '7 Music Requests', '8 YouTube Requests']));
  const metadata = await import('../scripts/metadata/providers.js');
  const fixture = { item: { id: 399566, title: 'Godzilla vs. Kong', releaseDate: '2021-03-24', originalLanguage: 'en', runtime: 113, certification: 'PG-13', voteAverage: 7.5 }, mediaInfo: { status: 3 }, collection: { id: 535313, name: 'Monsterverse Collection' }, ratings: { imdb: { rating: 6.3 }, rt: { criticsScore: 76 } } };
  let hookIndex = 0;
  const hookStates = [fixture, false, '', null, { status: 'available', owned, message: 'Verified playable files in Homestead.' }, '', false, '', false, null, '', 'requested'];
  const detailCode = await transformWithOxc(detail, 'details.jsx', { jsx: { runtime: 'classic' } });
  const Detail = vm.runInNewContext(`${detailCode.code}; SeerrMediaDetail`, {
    React, useEffect() {}, useState: (initial) => [hookIndex < hookStates.length ? hookStates[hookIndex++] : initial, () => {}], useRef: (current) => ({ current }),
    ...metadata, ...displayFormat, getNormalizedTmdbCardImage: () => '', getTmdbImageUrl: () => '', getOfficialMediaExtras: () => [], ...trailers,
    RequestStatePill: components.RequestStatePill, MediaStatusBadge: () => null,
  });
  const detailHtml = renderToStaticMarkup(React.createElement(Detail, { item: { id: 399566, mediaType: 'movie' }, requests: { movies: [{ tmdbId: 399566 }] } }));
  assert(detailHtml.includes('Monsterverse Collection')); assert(detailHtml.includes('6.3/10')); assert(detailHtml.includes('76%'));
  assert(detailHtml.includes('113 minutes')); assert(detailHtml.includes('PG-13')); assert(detailHtml.includes('Open in Library'));
  assert(!detailHtml.includes('Watchlist')); assert(!detailHtml.includes('Collection support coming later'));
  console.log('Request lifecycle, all-page polling/cache, matching safety, collection conversion/persistence, trailers, request cards and all five header stats: PASSED');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
