const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
function source(name, text = app) {
  const start = text.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const end = text.indexOf('\n}', start) + 2;
  assert(end > start, name);
  return text.slice(start, end);
}

// Execute the actual header initialization in its source order. Before this
// fix, selecting media throws ReferenceError while every other library works.
const start = app.indexOf('const countCollection =');
const end = app.indexOf('  const filtered = people.filter(', start);
const stats = app.slice(start, end);
for (const enabled of [true, false]) {
  const result = vm.runInNewContext(`${stats}; activeStats`, {
    mediaIndex: { libraries: { movies: { a: {} }, tv: { b: {} } } }, activePlugin: null, pluginHostSummary: {},
    setupConfig: { enabledLibraries: { movies: enabled, tvshows: enabled } }, activeLibrary: 'media',
  });
  assert.equal(JSON.stringify(result), JSON.stringify(enabled ? ['1 Movies', '1 TV Shows'] : []));
}
assert.equal(vm.runInNewContext(`${stats}; activeStats.length`, { mediaIndex: null, setupConfig: null, activeLibrary: 'media', activePlugin: null, pluginHostSummary: {} }), 0);

const getStatus = vm.runInNewContext(`${source('getSeerrPreviewStatus')}; getSeerrPreviewStatus`);
const movie = { id: 17, mediaType: 'movie', title: 'Test Movie' };
assert.equal(getStatus(movie, {}), 'discovery');
assert.equal(getStatus(movie, { movies: [{ tmdbId: 17 }] }), 'requested');
assert.equal(getStatus(movie, { tv: [{ tmdbId: 17 }] }), 'discovery', 'IDs in different media types are not the same title');
assert.equal(getStatus(movie, { movies: ['tmdb-17'] }), 'requested');
assert.equal(getStatus(movie, { movies: [{ tmdbId: 17, status: 'failed' }] }), 'failed');
for (const [remote, label] of [[2, 'requested'], [3, 'processing'], [4, 'partial'], [5, 'available']]) {
  assert.equal(getStatus({ ...movie, mediaInfo: { status: remote } }, {}), label);
}
assert.equal(getStatus({ ...movie, mediaInfo: { status: 5 } }, { movies: [{ tmdbId: 17 }] }), 'available');
assert.equal(getStatus({ ...movie, mediaInfo: { requests: [{ status: 1 }] } }, {}), 'requested');
assert.equal(getStatus({ ...movie, mediaInfo: { downloadStatus: [{ status: 'downloading' }] } }, {}), 'downloading');

// Request history merges atomically per user after Seerr accepts a request.
let saved = { movies: [{ id: 'tmdb-17', tmdbId: 17, requestedByUserId: 'other' }], tv: [], books: [{ title: 'Keep me' }] };
let diskFails = false;
const save = vm.runInNewContext(`${source('persistSeerrSearchRequest', server)}; persistSeerrSearchRequest`, {
  homesteadAccess: { accessContext: (req) => ({ user: req.user }) },
  readRequests: () => structuredClone(saved), dataDir: '/test', requestsPath: '/test/requests.json',
  fs: { mkdirSync() {}, writeFileSync(_path, json) { if (diskFails) throw new Error('test disk failure'); saved = JSON.parse(json); } },
  console: { warn() {} },
});
const req = { user: { id: 'owner', role: 'owner' }, body: { fromSearch: true, tmdbId: 17, title: 'Test Movie' } };
assert.equal(save(req, 'movie').request.title, 'Test Movie');
assert.equal(saved.movies.length, 2);
save(req, 'movie');
assert.equal(saved.movies.length, 2, 'repeat cannot duplicate own request');
save(req, 'tv');
assert.equal(saved.tv.length, 1);
assert.equal(saved.books[0].title, 'Keep me');
diskFails = true;
assert(save({ ...req, body: { ...req.body, tmdbId: 18 } }, 'movie').warning, 'history failure must not imply Seerr rejected it');

async function testClientRequest() {
  let requests = { movies: [], tv: [] };
  let posts = 0;
  let fail = false;
  const alerts = [];
  const context = {
    requests, getSeerrPreviewStatus: getStatus, seerrRequestInFlight: { current: false },
    setSeerrRequestBusy() {}, getNormalizedTmdbCardImage: () => '',
    setRequests(update) { requests = update(requests); context.requests = requests; },
    alert: (message) => alerts.push(message),
    fetch: async (url, init) => {
      posts++;
      assert.equal(url, '/api/integrations/seerr/request/movie');
      assert.equal(JSON.parse(init.body).fromSearch, true);
      return { ok: !fail, json: async () => ({ ok: !fail, message: 'Provider unavailable' }) };
    },
  };
  const request = vm.runInNewContext(`async ${source('requestSearchSeerr')}; requestSearchSeerr`, context);
  await Promise.all([request(movie), request(movie)]);
  assert.equal(posts, 1, 'double-click starts one request');
  assert.equal(requests.movies[0].tmdbId, 17);
  await request(movie);
  assert.equal(posts, 1, 'accepted request is disabled in both views');
  await request({ id: 22, mediaType: 'person' });
  assert.equal(posts, 1, 'person IDs cannot accidentally request a movie');
  fail = true;
  await request({ ...movie, id: 18 });
  assert.equal(requests.movies.length, 1, 'failed provider call must not mark requested');
  assert.equal(context.seerrRequestInFlight.current, false, 'failure releases button for retry');
  assert.equal(alerts.length, 1);
}

async function testRenderedControls() {
  const { transformWithOxc } = await import('vite');
  const badge = fs.readFileSync(path.join(root, 'src/components/MediaStatusBadge.jsx'), 'utf8').replace('export default ', '');
  const code = [badge, ...['getSeerrPreviewStatus', 'getSearchResultYear', 'SearchRequestButton', 'SeerrSearchSection', 'AcquisitionSearchSection'].map((name) => source(name))].join('\n');
  const transformed = await transformWithOxc(code, 'search-fixture.jsx', { jsx: { runtime: 'classic' } });
  const components = vm.runInNewContext(`${transformed.code}; ({ SearchRequestButton, SeerrSearchSection, AcquisitionSearchSection })`, {
    React, GlobalSearchArtwork: () => React.createElement('span', { className: 'artwork' }),
  });
  const { SearchRequestButton, SeerrSearchSection, AcquisitionSearchSection } = components;
  for (const status of ['requested', 'downloading', 'available', 'owned', 'partial', 'needs-attention', 'importing', 'scanning']) {
    assert.equal(SearchRequestButton({ status }).props.disabled, true, status);
  }
  const button = SearchRequestButton({ status: 'discovery', title: 'A Book' });
  assert.equal(button.props.disabled, false);
  assert.equal(button.props['aria-label'], 'Request A Book');
  assert.equal(SearchRequestButton({ busy: true }).props.disabled, true);
  let requested = 0, stopped = 0;
  SearchRequestButton({ onRequest: () => requested++ }).props.onClick({ stopPropagation: () => stopped++ });
  assert.equal(requested, 1); assert.equal(stopped, 1);
  for (const mediaType of ['movie', 'tv']) {
    for (const full of [false, true]) {
      const html = renderToStaticMarkup(React.createElement(SeerrSearchSection, { full, results: [{ ...movie, mediaType }], requests: {}, onRequest() {} }));
      assert(html.includes('Available to Request')); assert(html.includes('+ Request'));
      assert.equal((html.match(/<button/g) || []).length, 2, 'title and request are sibling controls');
      assert(!/<button[^>]*>[^]*?<button[^>]*>[^]*?<\/button>[^]*?<\/button>/.test(html), 'no nested buttons');
      const requestedHtml = renderToStaticMarkup(React.createElement(SeerrSearchSection, { full, results: [{ ...movie, mediaType }], requests: { [mediaType === 'tv' ? 'tv' : 'movies']: [{ tmdbId: 17 }] }, onRequest() {} }));
      assert(requestedHtml.includes('✓ Requested')); assert(!requestedHtml.includes('+ Request'));
    }
  }
  for (const library of ['books', 'music']) {
    const html = renderToStaticMarkup(React.createElement(AcquisitionSearchSection, { results: [{ library, type: library === 'books' ? 'book' : 'album', title: 'Example', status: 'discovery' }], onRequest() {} }));
    assert(html.includes('search-request-button')); assert(html.includes('Available to Request'));
  }
}
async function testAcquisitionRequest() {
  const item = { library: 'music', provider: 'musicbrainz', providerId: 'album-1', title: 'Example', status: 'discovery' };
  let results = [item], fullPage = { acquisitionResults: [item] }, posts = 0;
  const context = {
    acquisitionRequestInFlight: { current: false }, setAcquisitionRequestBusy() {},
    setAcquisitionResults(update) { results = update(results); },
    setSearchResultsPage(update) { fullPage = update(fullPage); },
    alert(message) { throw new Error(message); },
    fetch: async (url) => { posts++; assert.equal(url, '/api/acquisition/request'); return { ok: true, json: async () => ({ ok: true, job: { status: 'requested' } }) }; },
  };
  const request = vm.runInNewContext(`async ${source('requestAcquisition')}; requestAcquisition`, context);
  await Promise.all([request(item), request(item)]);
  assert.equal(posts, 1);
  assert.equal(results[0].status, 'requested');
  assert.equal(fullPage.acquisitionResults[0].status, 'requested');
  await request(results[0]);
  assert.equal(posts, 1);
}
assert.equal((app.match(/<SeerrSearchSection (?:full )?results=/g) || []).length, 4);
assert.equal((app.match(/onRequestSeerr=\{requestSearchSeerr\}/g) || []).length, 2);
Promise.all([testClientRequest(), testAcquisitionRequest(), testRenderedControls()])
  .then(() => console.log('Media Home runtime initialization, request status/identity, persistence, duplicate/error handling, rendered search controls: PASSED'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
