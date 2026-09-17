const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
function source(name, text = app) {
  const start = text.indexOf(`function ${name}(`), end = text.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return text.slice(start, end);
}
const artworkCode = ['getTmdbImageUrl', 'getLocalApiFileUrl', 'normalizeGlobalSearchArtworkUrl', 'getGlobalSearchArtworkCandidates', 'buildOwnedSearchArtwork', 'resolveGlobalSearchArtwork'].map((name) => source(name)).join('\n');
const artworkContext = {
  getHomesteadMetadataMatchFromIndex: (index, library, item) => index[`${library}:${item.id}`] || null,
};
const artwork = vm.runInNewContext(`${artworkCode}; ({ buildOwnedSearchArtwork, getGlobalSearchArtworkCandidates })`, artworkContext);
const kingKong = { id: 'king-kong', name: 'King Kong (2005)', poster: '/media/movies/King Kong/poster.jpg' };
const saved = { 'movies:king-kong': { title: 'King Kong', year: '2005', poster: 'https://example.com/king-kong.jpg' } };
const owned = artwork.buildOwnedSearchArtwork(kingKong, 'movies', saved);
assert.equal(owned.title, 'King Kong');
assert.equal(owned.poster, saved['movies:king-kong'].poster);
assert(owned.posterCandidates.includes('/api/file?path=%2Fmedia%2Fmovies%2FKing%20Kong%2Fposter.jpg'));
assert.equal(artwork.buildOwnedSearchArtwork(kingKong, 'movies', {}).poster, '/api/file?path=%2Fmedia%2Fmovies%2FKing%20Kong%2Fposter.jpg');
for (const library of ['tv', 'books', 'music', 'youtube']) {
  assert.equal(artwork.buildOwnedSearchArtwork({ id: 'x', name: 'Test', metadata: { cover: '/custom-root/cover.jpg' } }, library, {}).poster, '/api/file?path=%2Fcustom-root%2Fcover.jpg');
}
assert.equal(artwork.getGlobalSearchArtworkCandidates({ poster: '/placeholder-poster.jpg', poster_path: '/real.jpg' })[0], 'https://image.tmdb.org/t/p/w185/real.jpg');
assert.equal(artwork.getGlobalSearchArtworkCandidates({ poster: { sourcePath: '/custom/poster.png' } })[0], '/api/file?path=%2Fcustom%2Fposter.png');
assert.equal(artwork.getGlobalSearchArtworkCandidates({ poster: '/api/file?path=%2Fposter.jpg' })[0], '/api/file?path=%2Fposter.jpg');

// Server upload and lookup identity must isolate all albums and users, and
// preserve legacy unscoped URLs. Similar/path-like IDs cannot collide.
const identity = vm.runInNewContext(`${source('appearanceBackgroundIdentity', server)}\n${source('appearanceBackgroundStem', server)}; ({appearanceBackgroundIdentity, appearanceBackgroundStem})`, {
  crypto, homesteadAccess: { accessContext: (req) => ({ user: req.user }) },
});
const identify = (scope, userId = 'owner', target = 'library') => identity.appearanceBackgroundIdentity({ query: { library: 'photos', scope, target }, user: { id: userId }, get: () => '' });
const stem = identity.appearanceBackgroundStem;
const library = identify(''), anime = identify('album:Anime'), holidays = identify('album:Holidays');
assert.equal(stem(library), 'photos-library');
assert.notEqual(stem(anime), stem(library)); assert.notEqual(stem(anime), stem(holidays));
assert.notEqual(stem(identify('album:a/b')), stem(identify('album:a-b')));
assert(!stem(identify('album:../../bad')).includes('..'));
assert.notEqual(identify('album:Anime', 'other').userId, anime.userId);
for (const target of ['library', 'banner', 'sidebar', 'poster']) assert(stem(identify('album:Anime', 'owner', target)).endsWith(`-${target}`));
assert(server.includes('const destination = path.join(userDir, `${appearanceBackgroundStem(identity)}${extension}`)'));
assert(server.includes('const previous = path.join(userDir, `${appearanceBackgroundStem(identity)}${existingExtension}`)'));
assert(server.includes('scope=${encodeURIComponent(identity.scope)}'));

async function run() {
  const { resolvePhotoAlbumAppearance: resolve, updatePhotoAlbumAppearance: update, resetPhotoAlbumAppearance: reset } = await import('../src/utils/photo-appearance.js');
  const original = { backgroundImage: 'library-bg', sidebarBackgroundImage: 'library-side', bannerImage: 'library-banner', posterWidth: 190, albumCovers: { Holidays: 'holiday-poster' }, albumAppearance: { Holidays: { backgroundImage: 'holiday-bg' } } };
  let base = structuredClone(original);
  base = update(base, 'Anime', (values) => ({ ...values, backgroundImage: 'anime-bg', bannerImage: 'anime-banner', sidebarBackgroundImage: 'anime-side', albumPoster: 'anime-poster' }));
  assert.equal(base.backgroundImage, 'library-bg'); assert.equal(base.sidebarBackgroundImage, 'library-side'); assert.equal(base.bannerImage, 'library-banner');
  assert.equal(resolve(base, 'Anime').backgroundImage, 'anime-bg'); assert.equal(resolve(base, 'Holidays').backgroundImage, 'holiday-bg');
  assert.equal(base.albumCovers.Anime, 'anime-poster'); assert.equal(base.albumCovers.Holidays, 'holiday-poster');
  assert.deepEqual(original.albumAppearance, { Holidays: { backgroundImage: 'holiday-bg' } }, 'source was not mutated');
  assert.equal(resolve(JSON.parse(JSON.stringify(base)), 'Anime').bannerImage, 'anime-banner', 'scope survives reload');
  base = update(base, 'Anime', (values) => ({ ...values, backgroundImage: '' }));
  assert.equal(resolve(base, 'Anime').backgroundImage, '', 'clear overrides inheritance');
  assert.equal(base.backgroundImage, 'library-bg');
  base = update(base, '', (values) => ({ ...values, posterWidth: 220 }));
  assert.equal(resolve(base, 'Anime').posterWidth, 220, 'unedited fields continue inheriting');
  base = reset(base, 'Anime');
  assert.equal(resolve(base, 'Anime').backgroundImage, 'library-bg'); assert.equal(resolve(base, 'Holidays').backgroundImage, 'holiday-bg');
  assert.equal(base.albumCovers.Anime, 'anime-poster', 'reset appearance does not delete album poster');

  const { transformWithOxc } = await import('vite');
  let state;
  const imageCode = await transformWithOxc(`${artworkCode}\n${source('GlobalSearchArtwork')}`, 'artwork.jsx', { jsx: { runtime: 'classic' } });
  const image = vm.runInNewContext(`${imageCode.code}; GlobalSearchArtwork`, { ...artworkContext, React, useState: (initial) => [state || initial, (next) => { state = next; }] });
  const brokenFirst = { posterCandidates: ['https://example.com/broken.jpg', 'https://example.com/good.jpg'] };
  let node = image({ item: brokenFirst }); assert.equal(node.props.children.props.src, brokenFirst.posterCandidates[0]);
  node.props.children.props.onError(); node = image({ item: brokenFirst }); assert.equal(node.props.children.props.src, brokenFirst.posterCandidates[1]);
  node.props.children.props.onError(); node = image({ item: brokenFirst, fallbackIcon: 'Movie' }); assert.equal(node.props.children, 'Movie');
  node = image({ item: { poster: 'https://example.com/refreshed.jpg' } }); assert.equal(node.props.children.props.src, 'https://example.com/refreshed.jpg', 'changed source recovers after image failure');

  const photosText = fs.readFileSync(path.join(root, 'src/components/PhotosLibraryPage.jsx'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', '');
  const photosCode = await transformWithOxc(photosText, 'photos.jsx', { jsx: { runtime: 'classic' } });
  const Photos = vm.runInNewContext(`${photosCode.code}; PhotosLibraryPage`, { React, useState: React.useState, useMemo: React.useMemo, useEffect: React.useEffect, photoUrl: (value) => typeof value === 'string' ? value : value?.path || '' });
  const index = { libraries: { photos: { anime: { id: 'Anime', name: 'Anime', files: [{ type: 'image', path: '/anime.jpg' }] } } } };
  for (const albumId of ['', 'Anime']) {
    const html = renderToStaticMarkup(React.createElement(Photos, { mediaIndex: index, albumId, appearance: resolve(base, albumId) }));
    assert(!html.includes('Background Photo')); assert(!html.includes('Sidebar Photo')); assert(!html.includes('Choose Album Poster'));
    if (albumId) assert(html.includes('<h2>Anime</h2>'));
    else { assert(!html.includes('photos-library-hero-content')); assert(!html.includes('<h2>Photo Albums</h2>')); }
  }
  const series = source('YouTubeSeriesDetail');
  assert(series.includes('youtube-series-header-controls')); assert(series.includes('app-ribbon-appearance-button'));
  assert(!series.includes('<YouTubeSeriesPosterUpload')); assert(!series.includes('<YouTubeSeriesBannerUpload'));
  const menu = source('YouTubeSeriesAppearanceEditor'); assert(menu.includes('<YouTubeSeriesPosterUpload')); assert(menu.includes('<YouTubeSeriesBannerUpload'));
  assert(app.includes('onChange={changeScopedAppearance}')); assert(app.includes('appearance={effectiveMediaAppearance}'));
  assert(app.includes('name: "Photo Albums"'));
  console.log('Owned search posters, image fallback/recovery, album persistence/reset/isolation, scoped uploads, and appearance/menu layout: PASSED');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
