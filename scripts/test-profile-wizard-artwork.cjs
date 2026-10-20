const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { selectedProfileArtwork, applyImportedArtwork } = require('../src/server/profile-import-artwork.cjs');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const scanner = fs.readFileSync(path.join(root, 'scripts/scanners/scan-media.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
function source(name, text = server) {
  const start = text.indexOf('function ' + name + '(');
  const end = name === 'scanEntityFolder' ? text.indexOf('\nasync function scanPhotoCollectionFolder', start) : text.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return (text.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '') + text.slice(start, end);
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-selected-art-'));
  t.after(() => { assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'poster.jpg'), 'provider default');
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({ poster: 'https://provider.example/default.jpg', metadata: { name: 'Fixture Profile', notes: 'Keep this', posterCutout: 'old-cutout.png', artworkPreferences: { useCutouts: { poster: true, banner: true } } } }));
  const context = {
    fs, path, Buffer, console, require: createRequire(path.join(root, 'server.cjs')),
    sanitizeAdultImportSegment: value => value, extensionFromContentType: () => '.png',
    isAllowedAdultImportMedia: () => true, ADULT_IMPORT_TYPE_FOLDERS: { photo: 'photos', poster: '', banner: '', headshot: '', trailer: '' },
    ADULT_IMPORT_VIDEO_EXTS: new Set(['.mp4']), ADULT_IMPORT_MAX_VIDEO_BYTES: 1024 * 1024, ADULT_IMPORT_MAX_IMAGE_BYTES: 1024 * 1024,
  };
  vm.createContext(context);
  vm.runInContext(['readJsonIfExists', 'appendAdultImportRecord', 'inferAdultUploadMediaType', 'saveAdultUploadedMediaToProfile'].map(name => source(name)).join('\n'), context);
  return { directory, context, read: () => JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8')) };
}
test('wizard device poster import persists the chosen slot without deleting the provider or gallery originals', t => {
  const f = fixture(t);
  const record = f.context.saveAdultUploadedMediaToProfile({ file: { originalName: 'chosen.png', contentType: 'image/png', buffer: Buffer.from('selected bytes') }, profileDir: f.directory, importType: 'poster', sourceName: 'fixture' });
  f.context.appendAdultImportRecord(f.directory, record);
  const document = f.read();
  assert.equal(document.poster, 'poster.png'); assert.equal(document.metadata.poster, 'poster.png');
  assert.equal(document.metadata.selectedPoster, 'poster.png'); assert.equal(document.metadata.posterCutout, '');
  assert.equal(document.metadata.artworkPreferences.useCutouts.poster, false); assert.equal(document.metadata.artworkPreferences.useCutouts.banner, true); assert.equal(document.metadata.notes, 'Keep this');
  assert.equal(fs.readFileSync(path.join(f.directory, 'poster.jpg'), 'utf8'), 'provider default');
  assert.equal(fs.readFileSync(selectedProfileArtwork(f.directory, document).file, 'utf8'), 'selected bytes');
});
test('actual URL import and upload use the same persisted artwork selection', async t => {
  const f = fixture(t);
  f.context.URL = URL;
  f.context.fetch = async () => ({ ok: true, headers: { get: () => 'image/webp' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer });
  f.context.extensionFromContentType = () => '.webp';
  vm.runInContext(source('downloadAdultImportMediaToProfile'), f.context);
  const record = await f.context.downloadAdultImportMediaToProfile({ mediaUrl: 'https://fixture.example/chosen.webp', profileDir: f.directory, importType: 'poster', sourceName: 'fixture', sourceSlug: 'fixture' });
  f.context.appendAdultImportRecord(f.directory, record);
  assert.equal(f.read().metadata.poster, 'poster.webp');
  assert.equal(selectedProfileArtwork(f.directory, f.read()).relative, 'poster.webp');
});
test('legacy wizard import history repairs live and scanner choices; later explicit artwork still wins', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'poster.png'), 'legacy selection');
  const document = f.read();
  document.metadata.imports = [{ type: 'poster', relativeDestination: 'poster.png', savedAt: '2026-10-20T10:00:00Z' }];
  fs.writeFileSync(path.join(f.directory, 'metadata.json'), JSON.stringify(document));
  Object.assign(f.context, { resolveProfilePosterCandidate: () => 'provider default', discoverProfilePoster: () => 'old fallback' });
  vm.runInContext(source('chooseProfilePoster'), f.context);
  const live = f.context.chooseProfilePoster(f.directory, document.poster);
  assert.equal(new URL(live, 'http://fixture').searchParams.get('path'), path.join(f.directory, 'poster.png'));
  const scanContext = { fs, path, exists: fs.existsSync, require: createRequire(path.join(root, 'scripts/scanners/scan-media.cjs')),
    readJsonIfExists: file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null, walkFiles: async () => [], toPublicPath: value => value };
  vm.createContext(scanContext); vm.runInContext(source('scanEntityFolder', scanner), scanContext);
  const scanned = await scanContext.scanEntityFolder('celebrities', 'fixture', f.directory);
  assert.equal(scanned.poster, live, 'cold scan and live metadata must agree');
  fs.writeFileSync(path.join(f.directory, 'poster.webp'), 'later selection');
  document.metadata.artworkHistory = [{ action: 'poster', relativeDestination: 'poster.webp', updatedAt: '2026-10-20T11:00:00Z' }];
  assert.equal(selectedProfileArtwork(f.directory, document).relative, 'poster.webp');
});
test('revision changes with replacement bytes; missing or escaping slot references never win', t => {
  const f = fixture(t);
  const document = applyImportedArtwork(f.read(), { type: 'poster', relativeDestination: 'poster.png', savedAt: '2026-10-20T10:00:00Z' });
  assert.equal(selectedProfileArtwork(f.directory, document), null);
  fs.writeFileSync(path.join(f.directory, 'poster.png'), 'first');
  const first = selectedProfileArtwork(f.directory, document);
  fs.writeFileSync(path.join(f.directory, 'poster.png'), 'second, larger');
  assert.notEqual(selectedProfileArtwork(f.directory, document).revision, first.revision);
  const unsafe = { metadata: { imports: [{ type: 'poster', relativeDestination: '../poster.png' }, { type: 'poster', relativeDestination: '/poster.png' }] } };
  assert.equal(selectedProfileArtwork(f.directory, unsafe), null);
  const unchanged = { metadata: { notes: 'Keep' } };
  assert.equal(applyImportedArtwork(unchanged, { type: 'photo', relativeDestination: 'photos/one.png' }), unchanged);
});
test('current profile poster takes precedence over stale candidate and headshot lists', () => {
  const context = { getProfileImageFolderCandidates: () => [], normalizePosterCandidate: value => value };
  vm.createContext(context); vm.runInContext(source('getProfilePosterCandidates', app), context);
  const choices = context.getProfilePosterCandidates({ poster: '/api/file?path=selected&v=2', posterCandidates: ['https://fixture/default.jpg'], headshot: 'https://fixture/headshot.jpg' });
  assert.equal(choices[0], '/api/file?path=selected&v=2');
  assert(choices.includes('https://fixture/default.jpg'));
});
