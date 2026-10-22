const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const home = import('../src/utils/server-home.js');

const index = { libraries: {
  movies: { m: { id: 'm', name: 'Space Film', genres: ['Adventure'], addedAt: '2026-10-20', poster: 'movie.jpg' }, r: { id: 'r', name: 'Related Film', genres: ['Adventure'] } },
  tv: { t: { id: 't', name: 'Series', files: [{ type: 'image', name: 'poster.jpg' }, { type: 'video', name: 'Series_S02E03.mkv', path: '/tv/Series_S02E03.mkv', addedAt: '2026-10-21' }] } },
  books: { b: { id: 'b', name: 'Book', files: [{ path: '/books/audio.mp3', type: 'audio' }] } },
  photos: { p: { id: 'p', name: 'Album', addedAt: '2026-10-19' } },
  music: { a: { id: 'a', name: 'Artist', files: [{ path: '/music/track.mp3', type: 'audio' }] } },
  adult: { secret: { id: 'secret', name: 'PRIVATE TITLE', addedAt: '2099-01-01' } },
} };
const enabled = { movies: true, tvshows: true, books: true, music: true, photos: true, youtube: true, adult: true };
const creators = [{ id: 'c', name: 'Creator', videos: { v: { id: 'v', title: 'Video', path: '/youtube/video.mp4', addedAt: '2026-10-18' } } }];

test('Recently Added sorts actual additions across libraries and annotates TV episodes without artwork files', async () => {
  const { homeCatalog, homeRecentlyAdded, homeEpisodePill } = await home;
  const recent = homeRecentlyAdded(homeCatalog(index, creators, enabled));
  assert.equal(recent[0].targetId, 't'); assert.equal(recent[0].episodePill, 'S02 E03');
  assert(recent.some((item) => item.type === 'photo'));
  assert(!JSON.stringify(recent).includes('PRIVATE TITLE'));
  assert(!recent.some((item) => item.name === 'poster.jpg'));
  assert.equal(homeEpisodePill({ seasonNumber: 0, episodeNumber: 1 }), 'S00 E01');
  assert.equal(homeEpisodePill({ name: 'no episode data.mkv' }), '');
  assert.deepEqual(homeCatalog(index, creators, {}), []);
  assert(!homeCatalog(index, creators, { movies: true }).some((item) => item.type !== 'movie'));
  const severalVideos = [{ ...creators[0], videos: [creators[0].videos.v, { id: 'v2', path: '/youtube/second.mp4', title: 'Second video', addedAt: '2026-10-22' }] }];
  assert.equal(homeRecentlyAdded(homeCatalog(index, severalVideos, enabled)).filter((item) => item.type === 'youtube').length, 2);
});

test('One resume list excludes unopened, finished, unavailable, disabled and private media; newest duplicate wins', async () => {
  const { homeCatalog, homeProgress } = await home;
  const progress = {
    first: { type: 'movie', id: 'm', currentTime: 20, duration: 100, updatedAt: '2026-10-19' },
    newer: { type: 'movie', id: 'm', currentTime: 40, duration: 100, updatedAt: '2026-10-20' },
    finished: { type: 'movie', id: 'r', currentTime: 100, duration: 100 },
    tv: { type: 'tv', showId: 't', path: '/tv/Series_S02E03.mkv', currentTime: 5, duration: 100 },
    book: { type: 'book', id: 'b', percentage: 0.2, location: 'cfi', updatedAt: '2026-10-21' },
    music: { type: 'music', path: '/music/track.mp3', artist: 'Artist', currentTime: 10, duration: 100 },
    audio: { type: 'audiobook', bookId: 'b', path: '/books/audio.mp3', currentTime: 5, duration: 100 },
    yt: { type: 'youtube', id: 'v', currentTime: 2, duration: 100 },
    empty: { type: 'movie', id: 'm', currentTime: 0, duration: 100 },
    private: { type: 'adult', title: 'PRIVATE TITLE', currentTime: 10 },
    orphan: { type: 'movie', id: 'removed', title: 'PRIVATE TITLE', currentTime: 10 },
  };
  const resume = homeProgress(homeCatalog(index, creators, enabled), progress);
  assert.equal(resume.filter((item) => item.type === 'movie').length, 1);
  assert.equal(resume.find((item) => item.type === 'movie').progress, 40);
  assert.equal(resume[0].type, 'book');
  assert(resume.some((item) => item.type === 'music')); assert(resume.some((item) => item.type === 'youtube')); assert(resume.some((item) => item.type === 'audiobook'));
  assert(!JSON.stringify(resume).includes('PRIVATE TITLE'));
  assert.equal(homeProgress(homeCatalog(index, creators, {}), progress).length, 0);
  const orders = [{ type: 'watch-order', collectionId: 'saved', queueIndex: 1, episodeCount: 5 }];
  assert.equal(homeProgress([], {}, orders, []).length, 0);
  assert.equal(homeProgress(homeCatalog(index, creators, enabled), {}, orders, ['saved'])[0].progress, 20);
  const episodes = homeCatalog({ libraries: { tv: { t: { id: 't', name: 'Series', files: [{ type: 'video', name: 'S01E01.mkv', path: '/tv/first.mkv' }, { type: 'video', name: 'S01E02.mkv', path: '/tv/second.mkv' }] } } } }, [], { tvshows: true });
  assert.equal(homeProgress(episodes, { t: { type: 'tv', showId: 't', title: 'Series', path: '/tv/second.mkv', currentTime: 2, duration: 100 } })[0].episodePill, 'S01 E02');
});

test('Related titles use owned public metadata, including recently completed viewing, without network queries', async () => {
  const { homeCatalog, homeRelated } = await home;
  const related = homeRelated(homeCatalog(index, creators, enabled), { m: { type: 'movie', currentTime: 100, duration: 100, updatedAt: '2026-10-21' } });
  assert.equal(related.title, 'Space Film'); assert.deepEqual(related.items.map((item) => item.targetId), ['r']);
  assert.equal(homeRelated(homeCatalog(index, creators, {}), { m: { type: 'movie', currentTime: 10 } }).items.length, 0);
});

test('Scanner preserves first-added times for existing files while newly imported episodes get their own timestamp', () => {
  const scanner = fs.readFileSync(path.join(__dirname, '../scripts/scanners/scan-media.cjs'), 'utf8');
  const start = scanner.indexOf('function preserveItemTimestamps('), end = scanner.indexOf('\nfunction getScanSummary', start);
  const preserve = vm.runInNewContext(scanner.slice(start, end) + '; preserveItemTimestamps');
  const old = { t: { addedAt: '2026-01-01', files: [{ path: 'C:\\TV\\one.mkv', addedAt: '2026-01-01' }] } };
  const scan = { t: { files: [{ path: 'C:/TV/one.mkv' }, { path: 'C:/TV/two.mkv' }] } };
  const first = preserve(old, scan, '2026-10-21');
  assert.equal(first.t.addedAt, '2026-01-01'); assert.equal(first.t.files[0].addedAt, '2026-01-01'); assert.equal(first.t.files[1].addedAt, '2026-10-21');
  const second = preserve(first, scan, '2026-10-22'); assert.equal(second.t.files[1].addedAt, '2026-10-21');
});

test('Actual Home feed renders one activity ribbon, one resume section and one Recently Added section', async () => {
  const { transformWithOxc } = await import('vite');
  const source = fs.readFileSync(path.join(__dirname, '../src/components/ServerHomeFeed.jsx'), 'utf8').replace('export default ', '');
  const compiled = await transformWithOxc(source, 'feed.jsx', { jsx: { runtime: 'classic' } });
  const Feed = vm.runInNewContext(compiled.code + '; ServerHomeFeed', { React });
  const item = { feedKey: 'm', title: 'A title' };
  const html = renderToStaticMarkup(React.createElement(Feed, { recent: [item], resume: [item], related: { title: 'Another', items: [item] }, activity: [{ label: 'Requests', value: '0 tracked' }], onOpen() {}, renderCard: (row) => React.createElement('button', null, row.title) }));
  assert.equal((html.match(/aria-label="Recent activity"/g) || []).length, 1);
  assert.equal((html.match(/<h3>Continue Watching<\/h3>/g) || []).length, 1);
  assert.equal((html.match(/<h3>Recently Added<\/h3>/g) || []).length, 1);
  assert(!html.includes('Continue Reading')); assert(!html.includes('Continue Listening'));
});
