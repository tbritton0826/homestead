const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { applyArtwork, registerMediaArtwork } = require('../src/server/media-artwork.cjs');
const { buildEntities, evaluateCandidate, createLibraryAutoMatch } = require('../src/server/library-auto-match.cjs');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const source = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
async function run() {
  const { chooseOwnedArtist, mergeRequestSnapshot, requestContentKey, readableEbooks, transferRows } = await import('../src/utils/media-polish.js');
  assert.equal(chooseOwnedArtist({ artist: 'Same Name' }, [{ id: 'wrong', name: 'Someone Else' }]), null);
  assert.equal(chooseOwnedArtist({ artist: 'Same Name' }, [{ id: 'a', name: 'Same Name' }, { id: 'b', name: 'Same Name' }]), null);
  assert.equal(chooseOwnedArtist({ artist: 'AC_DC' }, [{ id: 'a', name: 'AC/DC' }]).id, 'a');
  assert.equal(chooseOwnedArtist({ artist: 'Same Name', metadataMatch: { provider: 'musicbrainz', providerId: 'locked', title: 'Confirmed Artist' } }, [{ id: 'a', name: 'Same Name' }]).id, 'locked');
  const old = { movies: [{ id: 'm', library: 'movies', title: 'Movie', status: 'downloading', percent: 10, checkedAt: 'before' }], books: [{ id: 'b' }] };
  const tick = [{ ...old.movies[0], checkedAt: 'after' }];
  assert.equal(mergeRequestSnapshot(old, tick, ['movies', 'books']), old, 'heartbeat must preserve root state identity');
  const changed = mergeRequestSnapshot(old, [{ ...tick[0], percent: 11 }], ['movies', 'books']);
  assert.notEqual(changed, old); assert.equal(changed.books, old.books); assert.equal(changed.movies[0].percent, 11);
  assert.equal(transferRows([{ status: 'available' }, { status: 'requested' }, { status: 'downloading' }, { status: 'needs-attention' }]).length, 2);
  assert.equal(readableEbooks({ ebookFiles: [{ name: 'book.epub' }, { name: 'book.pdf' }, { name: 'book.mobi' }] }).length, 2);
  const multidisc = buildEntities('music', { libraries: { music: { a: { id: 'a', name: 'Artist', files: [{ type: 'audio', path: '/media/music/Artist/Album/Disc 2/01 Song.flac', name: '01 Song.flac' }] } } } });
  assert.equal(multidisc[1].title, 'Album'); assert.equal(multidisc[2].album, 'Album');
  const studio = { kind: 'recording', title: 'Song', artists: ['Artist'], album: 'Album', identifiers: {}, duration: 200 };
  assert(!evaluateCandidate(studio, { providerId: 'live', title: 'Song (Live)', mediaType: 'recording', artists: ['Artist'] }).compatible);
  const pinned = applyArtwork({ providerId: 'new', poster: 'provider.jpg', matchLocked: true }, { gridPoster: 'chosen.jpg', detailPoster: 'detail.jpg' });
  assert.equal(pinned.providerId, 'new'); assert.equal(pinned.poster, 'chosen.jpg'); assert.equal(pinned.detailPoster, 'detail.jpg'); assert(pinned.matchLocked);

  // Run actual artwork routes: server-side identity, role/library guard, persistence and isolation.
  const routes = new Map(), admin = () => {}, index = { libraries: { books: { a: { id: 'castle', name: 'High Heat', poster: '/media/books/castle/cover.jpg', files: [] }, b: { id: 'child', name: 'High Heat' } }, movies: { m: { id: 'movie' } } } };
  let matches = { 'books:child': { localId: 'child', providerId: '/works/OL1W', provider: 'openlibrary' }, 'books:high-heat': { aliasOf: 'books:child' } };
  registerMediaArtwork({ app: { get(route, guard, handler) { assert.equal(guard, admin); routes.set(route, handler); }, post(route, guard, handler) { assert.equal(guard, admin); routes.set(route, handler); } }, access: { requireAdmin: admin, canAccessLibrary: (req) => !req.denied }, readIndex: () => index, readMatches: () => structuredClone(matches), writeMatches: (value) => { matches = value; }, findMatch: () => matches['books:child'], seerr: { json: async () => ({}) }, mediaRoot: '/media' });
  async function route(url, body, extra = {}) {
    let result, status = 200;
    await routes.get(url)({ body, query: body, ...extra }, { status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, result };
  }
  let response = await route('/api/media/artwork/options', { library: 'books', localId: 'castle' });
  assert.equal(response.status, 200); assert(response.result.warnings[0].includes('Fix Match'), 'same-title alias cannot select another author’s work');
  response = await route('/api/media/artwork/select', { library: 'books', localId: 'castle', slot: 'gridPoster', url: 'https://covers.openlibrary.org/b/id/123-L.jpg' });
  assert.equal(response.status, 200); assert.equal(matches['books:castle'].providerId, undefined, 'artwork does not invent a metadata match');
  assert.equal(matches['books:child'].providerId, '/works/OL1W');
  assert.equal((await route('/api/media/artwork/select', { library: 'books', localId: 'castle', url: 'http://127.0.0.1/secret' })).status, 400);
  assert.equal((await route('/api/media/artwork/select', { library: 'books', localId: 'castle', url: '/api/file?path=%2Fetc%2Fpasswd' })).status, 400);
  assert.equal((await route('/api/media/artwork/select', { library: 'books', localId: 'castle', url: 'https://covers.openlibrary.org/b/id/1-L.jpg' }, { denied: true })).status, 403);
  assert.equal((await route('/api/media/artwork/select', { library: 'books', localId: 'missing', url: 'https://covers.openlibrary.org/b/id/1-L.jpg' })).status, 404);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-polish-'));
  try {
    let saved = { 'music:a': { localId: 'a', poster: 'chosen.jpg', artworkOverrides: { gridPoster: 'chosen.jpg' } } };
    const service = createLibraryAutoMatch({ stateFile: path.join(temporary, 'matches.json'), readIndex: () => ({ libraries: { music: { a: { id: 'a', name: 'Artist', files: [] } } } }), readMatches: () => saved, writeMatches: (next) => { saved = next; }, searchMusic: async () => [{ provider: 'musicbrainz', providerId: 'a-mbid', mediaType: 'artist', title: 'Artist' }] });
    await service.run('music'); assert.equal(saved['music:a'].providerId, 'a-mbid', 'artwork-only records must not block metadata matching'); assert.equal(saved['music:a'].poster, 'chosen.jpg');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }

  const { transformWithOxc } = await import('vite');
  // Render real Transfers and verify actual badges, errors and unknown progress.
  const pillSource = fs.readFileSync(path.join(root, 'src/components/RequestRows.jsx'), 'utf8').replace(/^import .*;$/gm, '').replace(/export default /g, '').replace(/export /g, '');
  const queueSource = fs.readFileSync(path.join(root, 'src/components/TransferQueue.jsx'), 'utf8').replace(/^import .*;$/gm, '').replace('export default ', '');
  const transformed = await transformWithOxc(pillSource + '\n' + queueSource, 'queue.jsx', { jsx: { runtime: 'classic' } });
  const Queue = vm.runInNewContext(transformed.code + '; TransferQueue', { React, ...React, transferRows });
  const html = renderToStaticMarkup(React.createElement(Queue, { snapshot: { rows: [{ id: 'a', library: 'books', title: 'High Heat', status: 'needs-attention', message: 'Wrong author' }, { id: 'b', library: 'music', title: 'A Song', status: 'downloading', percent: 42 }, { id: 'c', library: 'music', title: 'Waiting', status: 'requested' }], warnings: [] } }));
  assert(html.includes('Needs Attention')); assert(html.includes('42%')); assert(html.includes('Wrong author')); assert(html.includes('Progress not reported')); assert(!html.includes('Waiting'));

  // Execute Media Home’s actual derivation with hook caching across re-renders.
  let cursor = 0, reads = 0; const memos = [];
  const libraryIndex = { libraries: { movies: Object.fromEntries(Array.from({ length: 400 }, (_, i) => ['m' + i, { id: 'm' + i, name: 'Movie ' + i, files: [] }])) } };
  const serialized = JSON.stringify(Object.fromEntries(Object.keys(libraryIndex.libraries.movies).map((id) => ['movies:' + id, { title: id, poster: 'https://example.test/poster.jpg' }])));
  const memo = (fn, deps) => { const i = cursor++; if (!memos[i] || deps.some((dep, n) => dep !== memos[i].deps[n])) memos[i] = { value: fn(), deps }; return memos[i].value; };
  const mediaCode = await transformWithOxc(source('function MediaPage(', 'async function markTubeArchivistPlaylistWanted'), 'media.jsx', { jsx: { runtime: 'classic' } });
  const Empty = () => null;
  const Media = vm.runInNewContext(mediaCode.code + '; MediaPage', { React, useEffect() {}, useState: (value) => [value, () => {}], useMemo: memo, loadHomesteadMetadataMatches: () => { reads++; return JSON.parse(serialized); }, getMetadataLocalId: (item) => item.id, getHomesteadMetadataMatchFromIndex: (all, library, item) => all[library + ':' + (item.id || item)], MediaSectionTabs: Empty, MobileMediaDirectory: Empty, RecentRequestsWidget: Empty, RecentWatchlistWidget: Empty, TrendingMoviesWidget: Empty, UpcomingMoviesWidget: Empty, TvDiscoverWidget: Empty, MediaToolsPage: Empty });
  for (let i = 0; i < 10; i++) { cursor = 0; Media({ mediaIndex: libraryIndex, metadataMatchesVersion: 1, requests: { movies: tick } }); }
  assert.equal(reads, 1, '400 movies × 10 renders must parse matches once, not 4000 times');
  cursor = 0; Media({ mediaIndex: libraryIndex, metadataMatchesVersion: 2 }); assert.equal(reads, 2, 'metadata changes invalidate the cache');
  console.log('Media Home fixture: 400 movies / 10 renders → 1 match-cache parse; metadata change → 1 fresh parse.');

  const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
  const acquisitionSource = server.slice(server.indexOf('async function refreshAcquisitionJobs()'), server.indexOf('app.get("/api/acquisition/jobs"'));
  let jobs = [{ id: 'album', provider: 'lidarr', library: 'music', lidarrAlbumId: 9, status: 'requested' }], queue = [], queueFailure = false;
  const refreshJobs = vm.runInNewContext(acquisitionSource + '; refreshAcquisitionJobs', {
    acquisitionRefreshRunning: false, readAcquisitionJobs: () => jobs,
    lidarrFetch: async (route) => { if (route.includes('/queue')) { if (queueFailure) throw new Error('offline'); return { records: queue }; } return { statistics: { trackFileCount: 0 } }; },
    upsertAcquisitionJob: (job) => { jobs = [job]; }, requestLifecycle: require('../src/server/request-lifecycle.cjs'), runAcquisitionScan() {},
  });
  await refreshJobs(); assert.equal(jobs[0].status, 'requested', 'monitoring alone is not a download'); assert.equal(jobs[0].percent, null);
  queue = [{ albumId: 9, progress: .25, timeleft: '00:04:00' }]; await refreshJobs(); assert.equal(jobs[0].status, 'downloading'); assert.equal(jobs[0].percent, 25);
  queueFailure = true; await refreshJobs(); assert.equal(jobs[0].lastPollError, 'offline', 'offline queue must not look healthy');

  const readerSource = source('function BookReader(', 'function cleanMusicTrackTitle(');
  const readerCode = await transformWithOxc(readerSource, 'reader.jsx', { jsx: { runtime: 'classic' } });
  const effects = [], order = [];
  const mockBook = { ready: Promise.resolve(), locations: { generate() { order.push('index'); return new Promise(() => {}); } }, renderTo() { return { display: async () => { order.push('display'); }, on() {}, destroy() {} }; }, destroy() {} };
  const Reader = vm.runInNewContext(readerCode.code + '; BookReader', { React, useRef: () => ({ current: {} }), useState: () => ['', () => {}], useEffect: (fn) => effects.push(fn), getPlayableMediaUrl: () => '/api/file?path=book.epub', getWatchProgress: () => ({}), ePub: () => mockBook, saveWatchProgress() {}, window: { addEventListener() {}, removeEventListener() {} } });
  const readerHtml = renderToStaticMarkup(Reader({ compact: true, file: { path: 'book.epub', name: 'book.epub' }, book: { id: 'book', title: 'Book' }, onClose() {} }));
  assert(readerHtml.includes('book-reader-inline')); assert(!readerHtml.includes('book-reader-overlay')); assert(readerHtml.includes('Turn pages as you listen'));
  const cleanup = effects[0](); await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(order, ['display', 'index'], 'reader must not wait for all locations before opening'); cleanup();
  assert(app.includes('readAlongBook: { id: book.id')); assert(app.includes('queuedTrack.chapterTitle'));
  assert(app.includes('disabled={selectedDiscoveredArtist.localOnly}'));
  const home = source('function HomePage(', 'function cleanDashboardMediaTitle');
  assert(home.indexOf('Your Recent Activity') > home.indexOf('Continue Watching</h3>')); assert(home.indexOf('Your Recent Activity') < home.indexOf('Continue Reading</h3>'));
  assert(!source('function DownloadsPage(', 'function RequestsPage(').includes('/api/setup-config'));
  console.log('Read Along, Home cache/layout, conservative music selection, disc folders, Fix Match/artwork identity and Downloads: PASSED');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
