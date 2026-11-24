const crypto = require('node:crypto');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const text = value => String(value || '').slice(0, 500);

function localVideoFiles(show) {
  const result = new Set(), seen = new Set();
  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') {
      if (seen.has(value)) return;
      seen.add(value);
      const file = value.sourcePath || value.filePath || value.path;
      if (typeof file === 'string') walk(file);
      for (const field of ['files', 'episodes', 'seasons', 'versions', 'localVersions']) {
        if (value[field] && typeof value[field] === 'object') Object.values(value[field]).forEach(walk);
      }
    } else if (typeof value === 'string' && /\.(mp4|mkv|avi|mov|webm|m4v|ts|m2ts|wmv)$/i.test(value) &&
      !/(?:^|[\\/ _.-])(trailer|sample)(?:[\\/ _.-]|$)/i.test(value)) result.add(value);
  }
  walk(show);
  return [...result];
}

function episodeNumbers(file) {
  const match = String(file).match(/(?:^|[^a-z0-9])s(\d{1,3})e(\d{1,3})((?:e\d{1,3}|-e?\d{1,3})*)/i);
  if (match) {
    const season = Number(match[1]), first = Number(match[2]), suffix = match[3];
    const last = suffix.startsWith('-') ? Number(suffix.replace(/^-e?/i, '')) : first;
    const numbers = suffix.startsWith('-') && last >= first && last - first < 100
      ? Array.from({ length: last - first + 1 }, (_, n) => first + n)
      : [first, ...Array.from(suffix.matchAll(/e(\d+)/gi), m => Number(m[1]))];
    return numbers.map(n => `${season}:${n}`);
  }
  const alternate = String(file).match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})(?:[^\d]|$)/i);
  return alternate ? [`${Number(alternate[1])}:${Number(alternate[2])}`] : [];
}

// One service per process. Cache provider reads, never account permissions or
// local file evidence. An interactive search is always an explicit user action.
function createTVEpisodeService({ getConfig, fetchImpl = fetch, isFile, lookupTVDB = async () => null, now = Date.now }) {
  const cache = new Map(), pending = new Map(), searches = new Map(), submissions = new Map();
  function config() {
    const value = getConfig();
    if (!value?.baseUrl || !value?.apiKey || value.enabled === false) throw fail('Configure Sonarr in server Settings to search episodes.', 503);
    const url = new URL(value.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('Review the Sonarr server address in Settings.', 503);
    return { ...value, baseUrl: value.baseUrl.replace(/\/+$/, '') };
  }
  async function json(route, { method = 'GET', body, ttl = 0, timeout = 12000 } = {}) {
    const c = config(), key = `${c.baseUrl}|${c.apiKey}|${route}`;
    if (method === 'GET' && ttl) {
      const saved = cache.get(key);
      if (saved && now() - saved.at < ttl) return saved.data;
      if (pending.has(key)) return pending.get(key);
    }
    const load = (async () => {
      let response;
      try {
        response = await fetchImpl(`${c.baseUrl}/api/v3/${route}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(timeout),
          headers: { Accept: 'application/json', 'X-Api-Key': c.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch { throw fail('Sonarr did not respond. Local episodes remain available; retry this action.', 503); }
      if (!response.ok) throw fail(`Sonarr returned HTTP ${response.status}. Check its connection and configuration.`, 502);
      let data;
      try { data = await response.json(); } catch { throw fail('Sonarr returned an unreadable response.', 502); }
      if (method === 'GET' && ttl) {
        cache.set(key, { data, at: now() });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      return data;
    })();
    if (method === 'GET' && ttl) pending.set(key, load);
    try { return await load; } finally { if (pending.get(key) === load) pending.delete(key); }
  }
  async function local(show) {
    const rows = [];
    // Chunk filesystem probes so a large show does not monopolize the disk.
    const files = localVideoFiles(show);
    for (let i = 0; i < files.length; i += 16) {
      const chunk = await Promise.all(files.slice(i, i + 16).map(async file => ({ file, exists: await isFile(file) })));
      rows.push(...chunk.filter(row => row.exists).flatMap(row => episodeNumbers(row.file).map(key => ({ key, path: row.file }))));
    }
    return rows;
  }
  async function provider(show, match, fresh = false) {
    const series = await json('series', { ttl: 60000 });
    const identity = { ...show.metadata, ...show, ...match };
    let tvdb = integer(identity.tvdbId || (identity.provider === 'tvdb' ? identity.providerId : ''));
    const tmdb = integer(identity.tmdbId || (identity.provider === 'tmdb' ? identity.providerId : ''));
    if (!tvdb && tmdb && !(Array.isArray(series) && series.some(row => Number(row.tmdbId) === tmdb))) {
      try { tvdb = integer(await lookupTVDB(tmdb)); } catch { /* No title-only fallback. */ }
    }
    // A title/series folder name never authorizes a Sonarr download.
    if (!tvdb && !tmdb) throw fail('Match this show to its TVDB or TMDB identity before searching Sonarr.', 409);
    const candidates = (Array.isArray(series) ? series : []).filter(row =>
      (!tvdb || Number(row.tvdbId) === tvdb) && (!tmdb || (tvdb && !row.tmdbId) || Number(row.tmdbId) === tmdb));
    if (candidates.length !== 1) throw fail(candidates.length ? 'More than one Sonarr series matches. Review the series mapping.' : 'This matched show is not in Sonarr. Add or match it in Sonarr first.', 409);
    const selected = candidates[0];
    const episodes = await json(`episode?seriesId=${selected.id}&includeImages=true`, { ttl: fresh ? 0 : 30000 });
    return { series: selected, episodes: Array.isArray(episodes) ? episodes : [] };
  }
  async function list({ show, match, useSonarr, canSearch, showId, fresh = false, includeReceipt = true }) {
    const files = await local(show), owned = new Map();
    for (const file of files) if (!owned.has(file.key)) owned.set(file.key, file.path);
    let source = { episodes: [] }, warning = '', queue = [], queueKnown = false;
    if (useSonarr) {
      try {
        source = await provider(show, match, fresh);
        try {
          const result = await json(`queue?page=1&pageSize=1000&seriesId=${source.series.id}&includeEpisode=true`, { ttl: fresh ? 0 : 5000 });
          queue = (result.records || []).filter(row => Number(row.seriesId ?? row.series?.id) === Number(source.series.id));
          queueKnown = Array.isArray(result.records) && Number(result.totalRecords || 0) <= result.records.length &&
            queue.every(row => integer(row.episodeId ?? row.episode?.id) > 0);
          if (!queueKnown) warning = 'Sonarr queue could not be mapped completely. Review downloads in Sonarr before searching.';
        } catch { warning = 'Download status could not refresh. Local availability is still verified.'; }
      } catch (error) { warning = error.message; }
    } else { warning = 'Local episodes only. Sonarr metadata and search require an enabled integration and an eligible plan.'; }
    const rows = new Map();
    const receiptPrefix = source.series && includeReceipt ? scope({ showId, actor: '' }) : null;
    for (const row of source.episodes) {
      const s = integer(row.seasonNumber), e = integer(row.episodeNumber);
      if (s === null || e === null) continue;
      const key = `${s}:${e}`, file = owned.get(key), queued = queue.find(q => Number(q.episodeId ?? q.episode?.id) === Number(row.id));
      const date = row.airDateUtc || row.airDate, timestamp = date ? Date.parse(date) : NaN;
      const receipt = receiptPrefix ? submissions.get(`${receiptPrefix}:${row.id}`) : null;
      const receiptState = receipt && now() - receipt.at < 10 * 60000 ? receipt.status : null;
      const state = file ? 'available' : queued ? (/import/i.test(queued.trackedDownloadState || '') ? 'importing' : 'downloading')
        : receiptState ? receiptState
        : row.hasFile ? 'not-indexed' : Number.isFinite(timestamp) ? (timestamp > now() ? 'upcoming' : 'missing') : 'unknown';
      const image = (row.images || []).find(image => image.coverType === 'screenshot') || row.images?.[0];
      const artwork = /^https:\/\//i.test(image?.remoteUrl || image?.url || '') ? (image.remoteUrl || image.url) : null;
      rows.set(key, { id: key, episodeId: row.id, season: s, number: e, title: text(row.title) || `Episode ${e}`, airDate: date || null,
        artwork, status: state, filePath: file || null, canSearch: Boolean(canSearch && queueKnown && state === 'missing') });
    }
    for (const [key, file] of owned) if (!rows.has(key)) {
      const [season, number] = key.split(':').map(Number);
      rows.set(key, { id: key, season, number, title: `Episode ${number}`, status: 'available', filePath: file, canSearch: false });
    }
    return { ok: true, episodes: [...rows.values()].sort((a, b) => a.season - b.season || a.number - b.number), warning,
      canSearch: Boolean(canSearch && source.series), source: source.series ? 'sonarr' : 'local' };
  }
  async function missing(context, episodeId) {
    const id = integer(episodeId);
    if (!id) throw fail('Choose a valid episode.');
    const snapshot = await list({ ...context, useSonarr: true, canSearch: true, fresh: true, includeReceipt: false });
    const episode = snapshot.episodes.find(row => Number(row.episodeId) === id);
    if (!episode) throw fail('This episode is not mapped to this local show.', 404);
    if (!episode.canSearch) throw fail('This episode is available, upcoming, already downloading, or its current status cannot be verified. Refresh first.', 409);
    return episode;
  }
  function scope(context) {
    const c = config();
    return crypto.createHash('sha256').update(`${c.baseUrl}|${c.apiKey}|${context.actor}|${context.showId}`).digest('hex');
  }
  async function search(context, episodeId) {
    await missing(context, episodeId);
    const key = `${scope(context)}:${episodeId}`;
    const existing = searches.get(key);
    if (existing && now() - existing.at < 15000) return existing.result;
    const releases = await json(`release?episodeId=${integer(episodeId)}`, { ttl: 15000, timeout: 45000 });
    const token = crypto.randomBytes(24).toString('hex');
    const rows = (Array.isArray(releases) ? releases : []).slice(0, 300).map((row, n) => ({
      id: String(n), title: text(row.title), quality: text(row.quality?.quality?.name), size: Number(row.size) || 0,
      indexer: text(row.indexer), seeders: Number.isFinite(row.seeders) ? row.seeders : null,
      rejections: (row.rejections || []).map(text), canDownload: row.downloadAllowed === true && !(row.rejections || []).length,
    }));
    const result = { ok: true, searchToken: token, releases: rows };
    searches.set(key, { at: now(), token, result, releases: Array.isArray(releases) ? releases.slice(0, 300) : [] });
    if (searches.size > 200) searches.delete(searches.keys().next().value);
    return result;
  }
  async function grab(context, { episodeId, searchToken, releaseId }) {
    const key = `${scope(context)}:${integer(episodeId)}`, saved = searches.get(key);
    if (!saved || saved.token !== searchToken || now() - saved.at > 10 * 60000) throw fail('Search results expired. Search this episode again.', 409);
    const index = integer(releaseId), release = index === null ? null : saved.releases[index];
    if (!release || !saved.result.releases[index].canDownload) throw fail('Choose an accepted release from these search results.', 409);
    const dedupe = `${scope({ ...context, actor: '' })}:${integer(episodeId)}`;
    const previous = submissions.get(dedupe);
    if (previous && now() - previous.at < 10 * 60000) return previous.promise;
    // Set before awaiting: concurrent taps and ambiguous provider failures may
    // never replay a download. Restart status comes from Sonarr's queue/files.
    const receipt = { at: now(), status: 'requesting' };
    const submit = (async () => {
      try {
        await missing(context, episodeId);
        await json('release', { method: 'POST', body: { guid: release.guid, indexerId: release.indexerId, episodeId: integer(episodeId) }, timeout: 30000 });
        receipt.status = 'requested';
        cache.clear();
        return { ok: true, status: 'requested', message: 'Release sent to Sonarr. Waiting for download/import confirmation.' };
      } catch (error) { receipt.status = 'needs-attention'; throw error; }
    })();
    receipt.promise = submit;
    submissions.set(dedupe, receipt);
    if (submissions.size > 500) submissions.delete(submissions.keys().next().value);
    return submit;
  }
  return { list, search, grab };
}

function registerTVEpisodes(app, { service, access, resolveShow, useSonarr, requestConfigured = () => false }) {
  function context(req, values) {
    if (!access.canAccessLibrary(req, 'tv')) throw fail('TV library access denied.', 403);
    const actor = access.accessContext(req).user;
    const showId = String(values.showId || '').replace(/^tv:/, '');
    if (!showId || showId.length > 500) throw fail('Choose a local TV show.');
    const { show, match } = resolveShow(req, showId);
    const allowed = useSonarr();
    return { showId, show, match, actor: actor?.id || 'local-owner', useSonarr: allowed,
      canRequest: allowed && requestConfigured(),
      canSearch: allowed && ['owner', 'admin'].includes(actor?.role) };
  }
  function handler(action) {
    return async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const values = req.method === 'GET' ? req.query : req.body || {}, c = context(req, values);
        if (action !== 'list' && !c.canSearch) throw fail('Episode searches require an owner/administrator and an enabled Sonarr integration on an eligible plan.', 403);
        if (action !== 'list') {
          const origin = req.headers.origin;
          // Native clients have no Origin. Browser writes must be same-origin.
          if (origin && origin !== `${req.protocol}://${req.get('host')}`) throw fail('Cross-origin episode actions are not allowed.', 403);
        }
        const result = action === 'list' ? await service.list(c) : action === 'search' ? await service.search(c, values.episodeId) : await service.grab(c, values);
        if (action === 'grab') access.recordAudit?.('tv.episode.requested', req, { showId: c.showId, episodeId: values.episodeId });
        res.json(action === 'list' ? { ...result, canRequest: c.canRequest } : result);
      } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Episode action could not complete. Refresh status before retrying.' }); }
    };
  }
  app.get('/api/tv/episodes', access.requireSession, handler('list'));
  app.post('/api/tv/episodes/search', access.requireSession, handler('search'));
  app.post('/api/tv/episodes/grab', access.requireSession, handler('grab'));
}
module.exports = { createTVEpisodeService, registerTVEpisodes, episodeNumbers };
