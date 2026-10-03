// Persistence contains explicit overrides; effective values are resolved by the UI.
const DEVICE_FIELDS = new Set(['posterWidth', 'posterHeight', 'posterScale', 'posterImageScale', 'posterAspectRatio', 'gridGap', 'gridColumns', 'detailPosterWidth', 'detailPosterHeight', 'detailPosterScale', 'detailPosterOffsetX', 'detailPosterOffsetY', 'cardWidth', 'cardHeight', 'cardScale', 'rowHeight', 'columnWidth', 'contentWidth', 'sidebarWidth']);
export function appearanceScope(library, page = '', mode = 'library', albumId = '') {
  if (albumId) return { bucket: 'pages', scopeId: library + ':album:' + albumId };
  if (mode === 'global') return { bucket: 'userDefaults', scopeId: '' };
  if (mode === 'page' && page) return { bucket: 'pages', scopeId: library + ':' + page };
  return String(library).startsWith('plugin:') ? { bucket: 'plugins', scopeId: library.slice(7) } : { bucket: 'libraries', scopeId: library };
}
export function appearanceScopeKey(scope) { return scope.bucket + ':' + scope.scopeId; }
export function getScopedAppearanceOverrides(config, scope, deviceId) {
  const read = (source) => scope.bucket === 'userDefaults' ? source?.userDefaults || {} : source?.[scope.bucket]?.[scope.scopeId] || {};
  return { ...read(config), ...read(config.devices?.[deviceId]) };
}
export function withScopedAppearanceOverrides(config, scope, values, deviceId) {
  const shared = {}, device = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    (DEVICE_FIELDS.has(key) ? device : shared)[key] = value;
  }
  const put = (source, value) => {
    if (scope.bucket === 'userDefaults') return { ...source, userDefaults: value };
    const bucket = { ...source?.[scope.bucket] };
    if (Object.keys(value).length) bucket[scope.scopeId] = value;
    else delete bucket[scope.scopeId];
    return { ...source, [scope.bucket]: bucket };
  };
  const next = put(config, shared);
  return { ...next, devices: { ...config.devices, [deviceId]: put(config.devices?.[deviceId] || {}, device) } };
}
export function explicitAppearanceChanges(current, update) {
  const next = typeof update === 'function' ? update(current) : update;
  return Object.fromEntries(Object.entries(next || {}).filter(([key, value]) =>
    !['albumAppearance', 'albumCovers', '__proto__', 'constructor', 'prototype'].includes(key) && JSON.stringify(value) !== JSON.stringify(current[key])));
}
export function normalizeLegacyAppearance(values, defaults) {
  return Object.fromEntries(Object.entries(values || {}).filter(([key, value]) =>
    !['__proto__', 'constructor', 'prototype'].includes(key) && JSON.stringify(value) !== JSON.stringify(defaults[key])));
}
export function appearanceCacheKey(userId, deviceId, scope) {
  return 'homestead-appearance-overrides-v2:' + encodeURIComponent(userId) + ':' + encodeURIComponent(deviceId) + ':' + appearanceScopeKey(scope);
}
export function cacheAppearanceScope(storage, userId, deviceId, scope, values) {
  storage.setItem(appearanceCacheKey(userId, deviceId, scope), JSON.stringify(values));
}
export function clearAppearanceScopeCache(storage, userId, deviceId, scope) {
  storage.removeItem(appearanceCacheKey(userId, deviceId, scope));
}
export function loadAppearanceCache(storage, userId, deviceId, emptyConfig) {
  let config = emptyConfig;
  const prefix = appearanceCacheKey(userId, deviceId, { bucket: '', scopeId: '' }).slice(0, -1);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const suffix = key.slice(prefix.length), separator = suffix.indexOf(':');
      const scope = { bucket: suffix.slice(0, separator), scopeId: suffix.slice(separator + 1) };
      const values = JSON.parse(storage.getItem(key));
      if (['userDefaults', 'libraries', 'pages', 'plugins'].includes(scope.bucket) && values && typeof values === 'object' && !Array.isArray(values)) config = withScopedAppearanceOverrides(config, scope, values, deviceId);
    } catch (error) { console.warn('Could not read appearance cache', key, error); }
  }
  return config;
}
export function appearanceDialogVariables(values) {
  return { '--media-overlay-color': values.overlayColor || '#0b1020', '--media-overlay-opacity': values.overlayOpacity ?? .96, '--media-overlay-blur': (values.overlayBlur ?? 14) + 'px', '--media-panel-color': values.panelColor || '#151922', '--media-panel-opacity': values.panelOpacity ?? .82, '--media-panel-blur': (values.panelBlur ?? 10) + 'px' };
}
// Queue only appearance writes. Reset follows any PATCH already sent, so a
// cancelled response cannot repopulate UI state or arrive after the DELETE.
export function createAppearanceSaveQueue({ delay = 240, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = new Map();
  const entryFor = (key) => {
    if (!entries.has(key)) entries.set(key, { revision: 0, timer: null, pending: null, running: Promise.resolve() });
    return entries.get(key);
  };
  const run = (entry) => {
    if (!entry.pending) return entry.running;
    const task = entry.pending, revision = entry.revision;
    clearTimer(entry.timer); entry.timer = null; entry.pending = null;
    const current = () => entry.revision === revision;
    entry.running = entry.running.catch(() => {}).then(() => current() ? task(current) : undefined);
    return entry.running;
  };
  const cancel = (key) => {
    const entry = entryFor(key);
    clearTimer(entry.timer); entry.timer = null; entry.pending = null; entry.revision++;
    return entry;
  };
  return {
    schedule(key, task) {
      const entry = cancel(key); entry.pending = task;
      entry.timer = setTimer(() => { run(entry).catch(() => {}); }, delay);
    },
    flush(key) { return run(entryFor(key)); },
    cancel,
    cancelAll() { for (const key of entries.keys()) cancel(key); },
    reset(key, task) {
      const entry = cancel(key), revision = entry.revision;
      entry.running = entry.running.catch(() => {}).then(() => task(() => entry.revision === revision));
      return entry.running;
    },
  };
}
