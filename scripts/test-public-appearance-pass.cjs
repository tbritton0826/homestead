const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8').replace(/\r\n/g, '\n');
function source(name, text = app) {
  const start = text.indexOf('function ' + name + '('), end = text.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, name);
  return text.slice(start, end);
}
function arrow(name) {
  const start = app.indexOf('  const ' + name + ' = '), end = app.indexOf('\n  };', start) + 5;
  assert(start >= 0 && end > start, name);
  return app.slice(start, end);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
class Storage {
  constructor() { this.items = new Map(); }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function run() {
  const helpers = await import('../src/utils/appearance-state.js');
  const { appearanceScope, appearanceScopeKey, getScopedAppearanceOverrides: overrides, withScopedAppearanceOverrides: put, explicitAppearanceChanges, appearanceCacheKey, cacheAppearanceScope, clearAppearanceScopeCache, loadAppearanceCache, createAppearanceSaveQueue } = helpers;
  const constants = app.slice(app.indexOf('const MEDIA_LIBRARY_APPEARANCE_DEFAULTS ='), app.indexOf('const MOVIE_DETAIL_APPEARANCE_DEFAULTS ='));
  const emptyBlock = app.slice(app.indexOf('const EMPTY_USER_APPEARANCE_CONFIG ='), app.indexOf('function getAppearanceDeviceId()'));
  const functions = vm.runInNewContext(constants + emptyBlock + source('resolveUserAppearance') + '\n({resolveUserAppearance, getMediaLibraryAppearanceDefaults, MEDIA_LIBRARY_APPEARANCE_DEFAULTS, EMPTY_USER_APPEARANCE_CONFIG})', helpers);
  const empty = () => plain(functions.EMPTY_USER_APPEARANCE_CONFIG);
  const resolve = (config, library = 'movies', page = '') => plain(functions.resolveUserAppearance(config, library, page, { panelColor: 'deleted-cache' }, 'device'));
  const global = appearanceScope('movies', '', 'global'), library = appearanceScope('movies'), page = appearanceScope('movies', 'detail:1', 'page'), album = appearanceScope('photos', '', 'library', 'Anime / Summer');
  let config = put(empty(), global, { panelColor: '#111111', posterWidth: 210 }, 'device');
  config = put(config, library, { panelOpacity: .6 }, 'device');
  config = put(config, page, { panelColor: '#ff0000' }, 'device');
  assert.deepEqual(explicitAppearanceChanges(resolve(config, 'movies', 'detail:1'), (values) => ({ ...values, panelBlur: 3 })), { panelBlur: 3 }, 'only the edited value is explicit');
  assert.deepEqual(overrides(config, page, 'device'), { panelColor: '#ff0000' });
  config = put(config, global, { panelColor: '#222222', posterWidth: 240 }, 'device');
  assert.equal(resolve(config, 'movies', 'detail:1').posterWidth, 240, 'device global geometry inherits into a page');
  assert.equal(resolve(config, 'movies', 'detail:1').panelColor, '#ff0000', 'explicit child survives parent change');
  assert.equal(resolve(config).panelColor, '#222222', 'page color never becomes library color');
  config = put(config, page, {}, 'device');
  assert.equal(resolve(config, 'movies', 'detail:1').panelColor, '#222222', 'reset inherits instead of reading legacy cache');
  const storage = new Storage();
  cacheAppearanceScope(storage, 'account-a', 'device', page, { panelColor: '#ff0000' });
  cacheAppearanceScope(storage, 'account-a', 'device', library, { panelBlur: 3 });
  assert.deepEqual(overrides(loadAppearanceCache(storage, 'account-a', 'device', empty()), library, 'device'), { panelBlur: 3 });
  assert.deepEqual(overrides(loadAppearanceCache(storage, 'account-b', 'device', empty()), page, 'device'), {}, 'account caches are isolated');
  clearAppearanceScopeCache(storage, 'account-a', 'device', page);
  assert.equal(storage.getItem(appearanceCacheKey('account-a', 'device', page)), null);
  assert.equal(storage.getItem(appearanceCacheKey('account-a', 'device', library)), '{"panelBlur":3}', 'reset removes only its scope');

  // Execute the actual API handlers against an in-memory configuration.
  const routes = {};
  let serverConfig = empty();
  const apiStart = server.indexOf('app.patch("/api/appearance/config"'), apiEnd = server.indexOf('function appearanceBackgroundIdentity(', apiStart);
  const api = { app: { patch: (url, ...handlers) => { routes.PATCH = handlers.at(-1); }, delete: (url, ...handlers) => { routes.DELETE = handlers.at(-1); } }, homesteadAccess: { requireSession: () => {} }, readAppearanceConfig: () => plain(serverConfig), writeAppearanceConfig: (req, next) => { serverConfig = plain(next); }, appearanceUserId: () => 'account-a' };
  const fields = server.slice(server.indexOf('const APPEARANCE_DEVICE_FIELDS ='), server.indexOf('function splitAppearanceValues('));
  vm.runInNewContext(source('safeAppearanceScopeId', server) + source('appearanceDeviceId', server) + fields + source('splitAppearanceValues', server) + server.slice(apiStart, apiEnd), api);
  function backend(method, scope, values = {}, replace = true) {
    let status = 200, body;
    const req = { body: { ...scope, values, replace, deviceId: 'device' }, query: { ...scope, deviceId: 'device' }, get: () => 'device' };
    const res = { status(value) { status = value; return res; }, json(value) { body = plain(value); return res; } };
    routes[method](req, res);
    return { ok: status < 400, json: async () => body };
  }
  backend('PATCH', library, { panelColor: '#111111', panelBlur: 4, posterWidth: 230 });
  backend('PATCH', library, { panelColor: '#222222' });
  assert.deepEqual(overrides(serverConfig, library, 'device'), { panelColor: '#222222' }, 'replace removes old shared and device overrides');
  backend('PATCH', library, { panelBlur: 7 }, false);
  assert.deepEqual(overrides(serverConfig, library, 'device'), { panelColor: '#222222', panelBlur: 7 }, 'older merge callers remain compatible');
  backend('PATCH', album, { bannerImage: '/album-banner.jpg', posterWidth: 250 });
  assert.equal(overrides(serverConfig, album, 'device').posterWidth, 250);
  assert.equal(serverConfig.pages[album.scopeId].bannerImage, '/album-banner.jpg', 'albums use the same server-backed page path');
  assert.notEqual(appearanceScope('photos', '', 'library', 'Anime / Summer').scopeId, appearanceScope('photos', '', 'library', 'Anime - Summer').scopeId);
  backend('DELETE', album);
  assert.deepEqual(overrides(serverConfig, album, 'device'), {});
  assert.equal(backend('PATCH', { bucket: 'libraries', scopeId: '__proto__' }, { panelBlur: 4 }).ok, false);

  function harness(scope = page, initial = empty()) {
    serverConfig = plain(initial);
    const localStorage = new Storage(), timers = new Map(), log = [], requests = [], statuses = {};
    let nextTimer = 0, holdPatch = null, failPatch = false, failDelete = false;
    const queue = createAppearanceSaveQueue({ setTimer: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimer: (id) => timers.delete(id) });
    const context = { ...helpers, localStorage, activeLibrary: scope.scopeId.startsWith('photos:') ? 'photos' : 'movies', sessionUser: { role: 'owner' }, accountAppearanceStorageKey: (library, user) => 'homestead-media-library-appearance:' + user + ':' + library, appearanceUserId: 'account-a', appearanceDeviceId: 'device', appearanceAccountRef: { current: 'account-a' }, appearanceConfigRef: { current: plain(initial) }, appearanceSaveQueue: { current: queue }, userAppearanceReady: true, appearanceResetScope: '', editingAppearanceScope: scope, editingAppearanceKey: appearanceScopeKey(scope), appearanceStudioValues: resolve(initial, scope.bucket === 'pages' && scope.scopeId.startsWith('photos:') ? 'photos' : 'movies', scope === page ? 'detail:1' : ''), appearanceStatuses: statuses, console: { error: (...args) => log.push(args), warn: (...args) => log.push(args) }, readStoredProfileAppearance: (key) => JSON.parse(localStorage.getItem(key) || 'null'), setAppearanceStatus: (key, message) => { statuses[key] = message; }, setAppearanceResetScope: (key) => { context.appearanceResetScope = key; }, updateAppearanceConfig: (value) => { context.appearanceConfigRef.current = value; }, setMediaAppearanceOpen: (value) => { context.open = value; }, encodeURIComponent,
      fetch: async (url, options) => {
        const method = options.method;
        requests.push(method);
        if (method === 'PATCH' && holdPatch) await holdPatch.promise;
        if ((method === 'PATCH' && failPatch) || (method === 'DELETE' && failDelete)) return { ok: false, json: async () => ({ ok: false, message: 'offline' }) };
        if (method === 'PATCH') { const body = JSON.parse(options.body); return backend(method, body, body.values, body.replace); }
        const query = Object.fromEntries(new URL(url, 'http://test').searchParams);
        return backend(method, query);
      },
    };
    const actions = vm.runInNewContext(['persistAppearanceScope', 'changeScopedAppearance', 'resetScopedAppearance', 'closeAppearanceStudio'].map(arrow).join('\n') + '\n({changeScopedAppearance, resetScopedAppearance, closeAppearanceStudio})', context);
    return { ...actions, context, localStorage, timers, queue, requests, log, statuses, hold(value) { holdPatch = value; }, failSave(value) { failPatch = value; }, failReset(value) { failDelete = value; }, server: () => plain(serverConfig), scopeValues: () => plain(overrides(context.appearanceConfigRef.current, scope, 'device')) };
  }
  // All resettable server scopes remove cache, explicit state, and server overrides.
  for (const scope of [global, library, page, album]) {
    const initial = put(put(empty(), global, { panelColor: '#111111' }, 'device'), scope, { panelColor: '#ff0000' }, 'device');
    const h = harness(scope, initial);
    cacheAppearanceScope(h.localStorage, 'account-a', 'device', scope, { panelColor: '#ff0000' });
    h.localStorage.setItem('homestead-media-library-appearance:account-a:' + h.context.activeLibrary, '{"panelColor":"#ff0000"}');
    const reset = h.resetScopedAppearance();
    assert.equal(h.localStorage.getItem('homestead-media-library-appearance:account-a:' + h.context.activeLibrary), null, 'obsolete cache cannot migrate a deleted override');
    assert.deepEqual(h.scopeValues(), {}, 'reset updates the UI immediately');
    await reset;
    assert.deepEqual(overrides(h.server(), scope, 'device'), {});
    assert.equal(h.localStorage.getItem(appearanceCacheKey('account-a', 'device', scope)), null);
    assert.notEqual(resolve(h.context.appearanceConfigRef.current, 'movies', 'detail:1').panelColor, '#ff0000');
  }
  let h = harness(page);
  h.changeScopedAppearance((values) => ({ ...values, panelColor: '#ff0000' }));
  assert.equal(h.localStorage.length, 0, 'unconfirmed preview is not cached as saved');
  await h.queue.flush(appearanceScopeKey(page));
  assert.deepEqual(overrides(h.server(), page, 'device'), { panelColor: '#ff0000' });
  assert.deepEqual(overrides(h.server(), library, 'device'), {});
  assert.deepEqual(JSON.parse(h.localStorage.getItem(appearanceCacheKey('account-a', 'device', page))), { panelColor: '#ff0000' });
  h = harness(page);
  h.changeScopedAppearance((values) => ({ ...values, panelColor: '#ff0000' }));
  const previouslyScheduled = [...h.timers.values()][0];
  await h.resetScopedAppearance();
  previouslyScheduled(); await h.queue.flush(appearanceScopeKey(page));
  assert.deepEqual(h.requests, ['DELETE'], 'even a captured obsolete timer cannot send a PATCH');
  h = harness(page);
  const gate = deferred(); h.hold(gate);
  h.changeScopedAppearance((values) => ({ ...values, panelColor: '#ff0000' }));
  const save = h.queue.flush(appearanceScopeKey(page));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(h.requests, ['PATCH']);
  const reset = h.resetScopedAppearance();
  assert.deepEqual(h.scopeValues(), {});
  await Promise.resolve(); assert.deepEqual(h.requests, ['PATCH'], 'DELETE waits for the PATCH already sent');
  gate.resolve(); await Promise.all([save, reset]);
  assert.deepEqual(h.requests, ['PATCH', 'DELETE']);
  assert.deepEqual(overrides(h.server(), page, 'device'), {});
  assert.deepEqual(h.scopeValues(), {});
  assert.equal(h.localStorage.length, 0, 'stale PATCH response cannot recache deleted values');
  const independentQueue = createAppearanceSaveQueue({ setTimer: () => 1, clearTimer: () => {} });
  let unrelatedSaved = false;
  independentQueue.schedule(appearanceScopeKey(library), async () => { unrelatedSaved = true; });
  independentQueue.schedule(appearanceScopeKey(page), async () => { throw new Error('cancelled page save ran'); });
  await independentQueue.reset(appearanceScopeKey(page), async () => {});
  await independentQueue.flush(appearanceScopeKey(library));
  assert(unrelatedSaved, 'Reset cancels only the selected scope');
  h = harness(album);
  h.changeScopedAppearance((values) => ({ ...values, albumPoster: '/new-poster.jpg' }));
  await h.queue.flush(appearanceScopeKey(album));
  assert.equal(overrides(h.server(), album, 'device').albumPoster, '/new-poster.jpg');
  h = harness(page); h.failSave(true);
  h.changeScopedAppearance((values) => ({ ...values, panelBlur: 9 }));
  await assert.rejects(h.queue.flush(appearanceScopeKey(page)), /offline/);
  assert.deepEqual(h.scopeValues(), { panelBlur: 9 }, 'failure retains usable preview');
  assert.equal(h.localStorage.length, 0);
  assert.match(h.statuses[appearanceScopeKey(page)], /^Not saved:/); assert(h.log.length);
  h.failSave(false); await h.closeAppearanceStudio();
  assert.equal(overrides(h.server(), page, 'device').panelBlur, 9, 'Done retries failed saves');
  h = harness(page, put(empty(), page, { panelBlur: 9 }, 'device')); h.failReset(true);
  cacheAppearanceScope(h.localStorage, 'account-a', 'device', page, { panelBlur: 9 });
  await h.resetScopedAppearance();
  assert.deepEqual(h.scopeValues(), { panelBlur: 9 });
  assert.match(h.statuses[appearanceScopeKey(page)], /^Reset failed:/);
  assert.deepEqual(JSON.parse(h.localStorage.getItem(appearanceCacheKey('account-a', 'device', page))), { panelBlur: 9 });

  // Real migration loop, not a second implementation of its behavior.
  const legacyStorage = new Storage();
  const legacy = { ...plain(functions.MEDIA_LIBRARY_APPEARANCE_DEFAULTS), panelColor: '#123456', albumAppearance: { Anime: { bannerImage: '/anime.jpg' } }, albumCovers: { Anime: '/poster.jpg' } };
  legacyStorage.setItem('homestead-media-library-appearance:account-a:photos', JSON.stringify(legacy));
  const migrationStart = app.indexOf('        const libraries = new Set('), migrationEnd = app.indexOf('        updateAppearanceConfig(config);', migrationStart);
  const migrated = vm.runInNewContext('let config = initial; const migrations = [];\n' + app.slice(migrationStart, migrationEnd) + '\n({config, migrations})', { ...helpers, ...functions, initial: empty(), PUBLIC_MEDIA_APPEARANCE_LIBRARIES: new Set(['photos']), appearanceUserId: 'account-a', appearanceDeviceId: 'device', activeLibrary: 'photos', sessionUser: { role: 'member' }, localStorage: legacyStorage, readStoredProfileAppearance: (key) => JSON.parse(legacyStorage.getItem(key) || 'null'), accountAppearanceStorageKey: (lib, user) => 'homestead-media-library-appearance:' + user + ':' + lib });
  assert.deepEqual(plain(overrides(migrated.config, appearanceScope('photos'), 'device')), { panelColor: '#123456' });
  assert.deepEqual(plain(overrides(migrated.config, appearanceScope('photos', '', 'library', 'Anime'), 'device')), { bannerImage: '/anime.jpg', albumPoster: '/poster.jpg' });
  assert.equal(migrated.migrations[0][0].bucket, 'pages', 'album migrates before parent nested maps are removed');

  const profileConstants = app.slice(app.indexOf('const PROFILE_APPEARANCE_DEFAULTS ='), app.indexOf('function normalizeProfileAppearancePreferences('));
  const profileNames = ['normalizeProfileAppearancePreferences', 'readStoredProfileAppearance', 'profileDefaultAppearanceStorageKey', 'readDefaultProfileAppearanceOverrides', 'readDefaultProfileAppearancePreferences', 'getProfileAppearanceIdentity', 'getProfileAppearanceStorageKey', 'readProfileAppearanceOverrides', 'readProfileAppearancePreferences'];
  const profileStorage = new Storage();
  const profile = vm.runInNewContext(profileConstants + profileNames.map((name) => source(name)).join('\n') + '\n({getProfileAppearanceStorageKey, profileDefaultAppearanceStorageKey, readProfileAppearancePreferences, readProfileAppearanceOverrides})', { ...helpers, localStorage: profileStorage, window: { matchMedia: () => ({ matches: false }) }, console });
  const person = { id: 'same-profile', library: 'personal' };
  const keyA = profile.getProfileAppearanceStorageKey(person, 'account-a'), keyB = profile.getProfileAppearanceStorageKey(person, 'account-b');
  assert.notEqual(keyA, keyB);
  profileStorage.setItem(keyA, '{"panelBlur":3}');
  profileStorage.setItem(profile.profileDefaultAppearanceStorageKey('account-a'), '{"panelColor":"#123456"}');
  assert.equal(profile.readProfileAppearancePreferences(person, 'account-a').panelColor, '#123456');
  assert.notEqual(profile.readProfileAppearancePreferences(person, 'account-b').panelColor, '#123456');
  profileStorage.setItem(profile.profileDefaultAppearanceStorageKey('account-a'), '{"panelColor":"#654321"}');
  assert.equal(profile.readProfileAppearancePreferences(person, 'account-a').panelColor, '#654321', 'profile inherits changed account defaults');
  assert.equal(profile.readProfileAppearancePreferences(person, 'account-a').panelBlur, 3);
  const resetStart = app.indexOf('          onReset={() => {', app.indexOf('<ProfileAppearanceStudio'));
  const resetEnd = app.indexOf('\n          }}', resetStart);
  let profileState;
  vm.runInNewContext(app.slice(resetStart + '          onReset={() => {'.length, resetEnd), { localStorage: profileStorage, profileAppearanceStorageKey: keyA, setProfileAppearanceState: (value) => { profileState = value; }, setProfileMediaActionStatus: () => {}, console });
  assert.equal(profileStorage.getItem(keyA), null); assert.deepEqual(plain(profileState.values), {});
  assert.equal(profile.readProfileAppearancePreferences(person, 'account-a').panelBlur, 16, 'profile reset inherits instead of copying defaults');

  const defaultResetStart = app.indexOf('          onResetDefault={() => {', app.indexOf('<ProfileAppearanceStudio'));
  const defaultResetEnd = app.indexOf('\n          }}', defaultResetStart);
  vm.runInNewContext(app.slice(defaultResetStart + '          onResetDefault={() => {'.length, defaultResetEnd), { localStorage: profileStorage, accountUserId: 'account-a', profileDefaultAppearanceStorageKey: profile.profileDefaultAppearanceStorageKey, setProfileMediaActionStatus: () => {}, console });
  assert.equal(profileStorage.getItem(profile.profileDefaultAppearanceStorageKey('account-a')), null);
  assert.equal(profile.readProfileAppearancePreferences(person, 'account-a').panelColor, '#0b1220', 'account default reset removes overrides');
  const effectStart = app.indexOf('    if (profileAppearanceState.key !== profileAppearanceStorageKey)');
  const effectEnd = app.indexOf('  }, [profileAppearanceState, profileAppearanceStorageKey]);', effectStart);
  vm.runInNewContext('(function () {' + app.slice(effectStart, effectEnd) + '})()', { localStorage: profileStorage, profileAppearanceStorageKey: keyA, profileAppearanceState: { key: keyA, values: { panelBlur: 3 } }, setProfileMediaActionStatus: () => {}, console });
  assert.deepEqual(JSON.parse(profileStorage.getItem(keyA)), { panelBlur: 3 }, 'profile persistence excludes resolved defaults');
  const legacyPerson = { id: 'legacy', library: 'personal' };
  profileStorage.setItem('homestead-profile-appearance-profile-v1:personal:legacy', '{"panelBlur":9}');
  assert.equal(profile.readProfileAppearancePreferences(legacyPerson, 'member', false).panelBlur, 16, 'members never import another account\'s legacy keys');
  assert.equal(profile.readProfileAppearancePreferences(legacyPerson, 'owner-account', true).panelBlur, 9, 'owner-only migration preserves existing customization');
  assert.equal(profileStorage.getItem('homestead-profile-appearance-profile-v1:personal:legacy'), null);

  const { transformWithOxc } = await import('vite');
  await transformWithOxc(app, 'App.jsx', { jsx: { runtime: 'classic' } });
  const studioCode = await transformWithOxc(source('MediaLibraryAppearanceStudio'), 'studio.jsx', { jsx: { runtime: 'classic' } });
  const studio = vm.runInNewContext(studioCode.code + '\nMediaLibraryAppearanceStudio', { ...helpers, React, document: { body: {} }, createPortal: (node) => node, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: (initial) => ({ current: initial }), useEffect: () => {}, useCallback: (fn) => fn, getAppearanceLibraryLabel: (lib) => lib, titleFromId: (value) => value, PhotoLibraryPicker: () => null, LibraryAutoMatchPanel: () => null });
  const dialog = studio({ library: 'movies', values: { ...plain(functions.MEDIA_LIBRARY_APPEARANCE_DEFAULTS), overlayColor: '#123456', overlayOpacity: .5, overlayBlur: 7 }, onChange: () => {}, onClose: () => {}, onReset: () => {}, status: 'Not saved: offline' });
  assert(dialog.props.className.includes('public-media-custom-appearance'));
  assert.equal(dialog.props.style['--media-overlay-color'], '#123456');
  assert.equal(dialog.props.style['--media-overlay-opacity'], .5); assert.equal(dialog.props.style['--media-overlay-blur'], '7px');
  const markup = renderToStaticMarkup(dialog);
  assert(markup.includes('--media-overlay-blur:7px')); assert(markup.includes('Not saved: offline'));
  assert(app.includes('"X-Homestead-Appearance-Scope": uploadScope'), 'uploaded backgrounds carry scope identity');
  console.log('Public appearance reset, inheritance, explicit persistence, queue races, failures/retry, profile accounts, legacy albums, API compatibility, dialog rendering, and JSX transform: PASSED');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
