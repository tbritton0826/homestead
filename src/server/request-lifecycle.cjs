// Provider states and local file evidence are deliberately separate. A completed
// download is not proof that an import (or a Homestead scan) has succeeded.
const LIBRARIES = ['movies', 'tv', 'books', 'music', 'youtube'];
const labels = { discovery: 'Available to Request', requested: 'Requested', pending: 'Pending Approval', downloading: 'Downloading', importing: 'Importing', scanning: 'Scanning', available: 'Available', partial: 'Partially Available', 'needs-attention': 'Needs Attention', declined: 'Declined' };
function videoFiles(item) {
  const result = [], visited = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    const file = value.sourcePath || value.path || '';
    if (/\.(mp4|mkv|avi|mov|webm|m4v|ts)$/i.test(file) && !/(?:^|[\/ _.-])(trailer|sample)(?:[\/ _.-]|$)/i.test(value.name || file)) result.push(file);
    for (const field of ['files', 'episodes', 'seasons', 'versions', 'localVersions']) {
      const children = value[field];
      if (children && typeof children === 'object') (Array.isArray(children) ? children : Object.values(children)).forEach(walk);
    }
  }
  walk(item);
  return [...new Set(result)];
}
function findOwned(request, items, getMatch = () => null, isFile = () => false) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const candidates = items.filter((item) => {
    const metadata = getMatch(item) || item.metadataMatch || item.metadata || {};
    const id = metadata.tmdbId || item.tmdbId || (metadata.source === 'tmdb' ? metadata.providerId : '');
    if (id && request.tmdbId) return String(id) === String(request.tmdbId);
    if (!request.tmdbId && (request.sourceId || request.id) === item.id) return true;
    const year = String(metadata.year || item.year || (item.name || '').match(/\((\d{4})\)/)?.[1] || '').slice(0, 4);
    return Boolean(request.year && year && String(request.year).slice(0, 4) === year && normalize(request.title) === normalize(metadata.title || item.title || item.name));
  });
  if (candidates.length !== 1) return null; // Remakes/ambiguous records need a match.
  const files = videoFiles(candidates[0]).filter(isFile);
  return files.length ? { id: candidates[0].id, fileCount: files.length, title: candidates[0].name || candidates[0].title } : null;
}
function progressOf(entry = {}) {
  const raw = entry.progress ?? entry.percentComplete ?? entry.percentage;
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(Number(raw))) {
    const n = Number(raw);
    return Math.max(0, Math.min(100, entry.progress !== undefined && n <= 1 ? n * 100 : n));
  }
  const size = Number(entry.size ?? entry.totalSize), left = entry.sizeleft ?? entry.sizeLeft ?? entry.remainingSize;
  return size > 0 && left != null ? Math.max(0, Math.min(100, (size - Number(left)) / size * 100)) : null;
}
function lifecycle({ library, mediaInfo = {}, requestStatus, downloads = [], owned = null, scan = {} }) {
  const entries = Array.isArray(downloads) ? downloads : [];
  const failed = entries.find((entry) => /failed|error|warning|importblocked/i.test(`${entry.status || ''} ${entry.trackedDownloadStatus || ''} ${entry.trackedDownloadState || ''}`));
  const active = entries.find((entry) => !/completed|imported/i.test(entry.status || '')) || entries[0];
  const percent = active ? progressOf(active) : null;
  const imported = Number(mediaInfo.status) === 5;
  let status = 'discovery', message = 'Ready to request.';
  // For TV, one local episode must not imply that every requested season exists.
  if (owned && (library !== 'tv' || imported)) { status = 'available'; message = 'Verified playable files in Homestead.'; }
  else if (failed) { status = 'needs-attention'; message = failed.errorMessage || failed.statusMessages?.flatMap((row) => row.messages || []).join(' ') || 'Download or import needs attention in the provider queue.'; }
  else if (scan.error) { status = 'needs-attention'; message = scan.error; }
  else if (imported) { status = 'scanning'; message = scan.running ? 'Import complete. Refreshing this library…' : 'Provider reports available; waiting for playable files in the configured Homestead library. Check folder mappings if this persists.'; }
  else if (active) { status = percent === 100 || /completed|import/i.test(active.status || '') ? 'importing' : 'downloading'; message = status === 'importing' ? 'Download complete. Waiting for the provider to import it.' : 'Downloading through your media stack.'; }
  else if (owned || Number(mediaInfo.status) === 4) { status = 'partial'; message = 'Some episodes are available; remaining requested episodes are not confirmed.'; }
  else if (Number(requestStatus) === 3) { status = 'declined'; message = 'The request was declined.'; }
  else if (Number(requestStatus) === 1) { status = 'pending'; message = 'Waiting for request approval.'; }
  else if (requestStatus || [2, 3].includes(Number(mediaInfo.status))) { status = 'requested'; message = 'Request accepted. Waiting for a matching release or download client.'; }
  const downloadSpeed = Number(active?.downloadSpeed ?? active?.downloadRate ?? 0) || null;
  return { status, label: labels[status], message, percent, downloadSpeed, eta: active?.estimatedCompletionTime || active?.timeleft || active?.timeLeft || '', owned, imported, checkedAt: new Date().toISOString() };
}
function requestKey(row) {
  return `${row.library}:${row.tmdbId ? `tmdb:${row.tmdbId}` : row.foreignBookId || row.foreignAlbumId || row.foreignArtistId || row.providerId || row.sourceId || row.id}`;
}
function mergeRequests(rows) {
  const merged = new Map();
  for (const row of rows) {
    if (!LIBRARIES.includes(row.library)) continue;
    const key = requestKey(row), previous = merged.get(key);
    merged.set(key, { ...previous, ...row, id: key, createdAt: row.createdAt || row.requestedAt || previous?.createdAt || '' });
  }
  return [...merged.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function createSeerrReader(getConfig, fetchImpl = fetch) {
  const cache = new Map(), inflight = new Map();
  const warming = new Set(), queue = [], failures = new Map();
  let workers = 0;
  const cacheKey = (route) => { const { baseUrl, apiKey } = getConfig(); return `${baseUrl}|${apiKey}|${route}`; };
  function peek(route, ttl = 3600000) {
    const value = cache.get(cacheKey(route));
    return value && Date.now() - value.at < ttl ? value.data : null;
  }
  function warm(route) {
    const key = cacheKey(route);
    if (peek(route) || warming.has(key) || Date.now() - (failures.get(key) || 0) < 60000) return;
    warming.add(key); queue.push({ route, key }); drain();
  }
  function drain() {
    while (workers < 6 && queue.length) {
      const { route, key } = queue.shift(); workers++;
      json(route, 3600000).catch(() => { failures.set(key, Date.now()); if (failures.size > 2500) failures.delete(failures.keys().next().value); })
        .finally(() => { workers--; warming.delete(key); drain(); });
    }
  }
  async function json(route, ttl = 8000) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) throw new Error('Seerr is not configured.');
    const key = `${baseUrl}|${apiKey}|${route}`, cached = cache.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.data;
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/v1/${route}`, { headers: { 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Seerr returned ${response.status}`);
      cache.set(key, { data, at: Date.now() });
      if (cache.size > 2500) cache.delete(cache.keys().next().value);
      return data;
    })();
    inflight.set(key, pending);
    try { return await pending; } finally { inflight.delete(key); }
  }
  async function requests() {
    const rows = [], seen = new Set();
    let total = Infinity;
    for (let skip = 0; skip < total; skip += 100) {
      const data = await json(`request?take=100&skip=${skip}&sort=added`, 10000);
      const page = data.results || [];
      total = Number(data.pageInfo?.results ?? data.pageInfo?.totalResults ?? Infinity);
      let added = 0;
      for (const row of page) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); added++; }
      if (!added || page.length < 100) break;
    }
    return rows;
  }
  return { json, requests, peek, warm };
}
module.exports = { LIBRARIES, labels, videoFiles, findOwned, progressOf, lifecycle, mergeRequests, createSeerrReader };
