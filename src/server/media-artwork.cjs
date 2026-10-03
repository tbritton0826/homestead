const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fields = { gridPoster: 'poster', detailPoster: 'detailPoster', banner: 'backdrop', logo: 'logo', albumCover: 'poster', authorImage: 'authorImage' };
const fileUrl = (value) => !value ? '' : /^(https?:\/\/|\/api\/|\/assets\/|\/placeholder)/.test(value) ? value : `/api/file?path=${encodeURIComponent(value)}`;
function applyArtwork(record, overrides = record.artworkOverrides || {}) {
  const next = { ...record, artworkOverrides: overrides };
  for (const [slot, value] of Object.entries(overrides)) if (fields[slot] && value) next[fields[slot]] = value;
  return next;
}
function registerMediaArtwork({ app, access, readIndex, readMatches, writeMatches, findMatch, seerr, sharp, mediaRoot }) {
  const cache = new Map();
  function lookup(matches, library, item) {
    if (!['books', 'music'].includes(library)) return findMatch(matches, library, item);
    const ids = [item.id, item.localId, item.path, item.sourcePath].filter(Boolean).map(String);
    for (const id of ids) {
      let match = matches[`${library}:${id}`]; const visited = new Set();
      while (match?.aliasOf && !visited.has(match.aliasOf)) { visited.add(match.aliasOf); match = matches[match.aliasOf]; }
      if (match && !match.aliasOf && ids.includes(String(match.localId))) return match;
    }
    return null;
  }
  async function json(url) {
    if (cache.has(url) && Date.now() - cache.get(url).at < 300000) return cache.get(url).data;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Homestead/0.6.7 (artwork picker)', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Artwork provider returned ${response.status}`);
    const data = await response.json();
    cache.set(url, { data, at: Date.now() }); if (cache.size > 100) cache.delete(cache.keys().next().value);
    return data;
  }
  function resolve(req, library, localId) {
    if (!['movies', 'tv', 'books', 'music', 'youtube'].includes(library) || !access.canAccessLibrary(req, library)) throw Object.assign(new Error('Library access denied'), { status: 403 });
    const item = Object.values(readIndex()?.libraries?.[library] || {}).find((row) => [row.id, row.localId, row.path, row.sourcePath].filter(Boolean).map(String).includes(String(localId)));
    if (!item) throw Object.assign(new Error('This local item is no longer indexed. Scan the library first.'), { status: 404 });
    return { item, match: lookup(readMatches(), library, item) || {}, id: String(item.id || localId) };
  }
  app.get('/api/media/artwork/options', access.requireAdmin, async (req, res) => {
    try {
      const library = String(req.query.library), slot = String(req.query.slot || 'gridPoster');
      if (!fields[slot]) return res.status(400).json({ ok: false, message: 'Unsupported artwork slot' });
      const { item, match } = resolve(req, library, req.query.localId);
      const options = [], warnings = [];
      const add = (url, label) => { if (url && !options.some((option) => option.url === fileUrl(url))) options.push({ url: fileUrl(url), label }); };
      add(match[fields[slot]] || (slot === 'detailPoster' ? match.poster : ''), 'Current selection');
      add(item[fields[slot]] || (slot === 'banner' ? item.banner : item.poster || item.cover), 'Local artwork');
      for (const file of (item.files || []).filter((file) => /\.(jpg|jpeg|png|webp|avif)$/i.test(file.name || file.path || '')).slice(0, 60)) add(file.sourcePath || file.path, file.name || 'Local image');
      try {
        if (library === 'books' && ['gridPoster', 'detailPoster'].includes(slot)) {
          const workId = match.identifiers?.openLibraryId || (match.provider === 'openlibrary' ? match.providerId : '');
          if (/^\/works\/OL\d+W$/.test(workId)) {
            const editions = await json(`https://openlibrary.org${workId}/editions.json?limit=80`);
            for (const edition of editions.entries || []) for (const cover of edition.covers || []) if (Number(cover) > 0) add(`https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`, [edition.title, edition.publish_date, ...(edition.publishers || [])].filter(Boolean).join(' · '));
          } else warnings.push('Fix Match to an Open Library work to browse its edition covers. Local choices and uploads are still available.');
        }
        if (['movies', 'tv'].includes(library)) {
          const tmdbId = match.tmdbId || item.metadata?.tmdbId || item.tmdbId || (match.provider === 'tmdb' ? match.providerId : '');
          if (/^\d+$/.test(String(tmdbId))) {
            const type = library === 'tv' ? 'tv' : 'movie';
            let data;
            if (process.env.TMDB_API_KEY) data = await json(`https://api.themoviedb.org/3/${type}/${tmdbId}/images?api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}`);
            else { const details = await seerr.json(`${type}/${tmdbId}`, 300000); data = details.images || {}; add(slot === 'banner' ? details.backdropPath && `https://image.tmdb.org/t/p/original${details.backdropPath}` : details.posterPath && `https://image.tmdb.org/t/p/w500${details.posterPath}`, 'TMDB'); }
            const group = slot === 'banner' ? 'backdrops' : slot === 'logo' ? 'logos' : 'posters';
            for (const image of data[group] || []) add(`https://image.tmdb.org/t/p/${group === 'posters' ? 'w500' : 'original'}${image.file_path || image.filePath}`, `TMDB · ${image.iso_639_1 || 'No language'} · ${image.width || ''}×${image.height || ''}`);
            if (!(data[group] || []).length) warnings.push('This provider supplied no alternate images. Upload artwork, or configure TMDB_API_KEY for the full movie/TV artwork gallery.');
          } else warnings.push('Fix Match first to load artwork for the correct movie or show.');
        }
      } catch (error) { warnings.push(error.message); }
      res.json({ ok: true, options, warnings });
    } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.message }); }
  });
  app.post('/api/media/artwork/select', access.requireAdmin, async (req, res) => {
    try {
      const { library, localId, slot = 'gridPoster', imageData } = req.body || {};
      if (!fields[slot]) return res.status(400).json({ ok: false, message: 'Unsupported artwork slot' });
      const { item, match, id } = resolve(req, library, localId);
      let url = String(req.body.url || '');
      if (imageData) {
        if (!sharp || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) throw new Error('Choose a JPEG, PNG, or WebP image.');
        const bytes = Buffer.from(imageData.split(',')[1], 'base64');
        if (bytes.length > 12000000) throw new Error('Image must be smaller than 12 MB.');
        const source = item.folderPath || item.sourcePath || item.path || item.files?.[0]?.sourcePath || item.files?.[0]?.path;
        if (!source) throw new Error('No local folder was found for this item.');
        const realRoot = fs.realpathSync(mediaRoot);
        const realSource = fs.realpathSync(source);
        const dir = fs.statSync(realSource).isDirectory() ? realSource : path.dirname(realSource);
        if (dir === realRoot || !dir.startsWith(realRoot + path.sep)) throw new Error('Artwork folder is outside the media library.');
        const destination = path.join(dir, `homestead-${slot}-${crypto.randomUUID()}.jpg`);
        const image = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        fs.writeFileSync(destination, image, { flag: 'wx' }); url = fileUrl(destination);
      } else {
        const parsed = new URL(url, 'http://homestead.local');
        if (url.startsWith('/api/file?')) {
          const requested = parsed.searchParams.get('path');
          const allowed = [item.poster, item.cover, item.banner, ...Object.values(fields).map((field) => match[field]), ...Object.values(match.artworkOverrides || {}), ...(item.files || []).map((file) => file.sourcePath || file.path)].filter(Boolean);
          if (!allowed.includes(requested) && !allowed.includes(url)) throw new Error('Choose an indexed image for this item.');
        } else if (parsed.protocol !== 'https:' || !['image.tmdb.org', 'covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com', 'coverartarchive.org'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Choose provider artwork or upload your own image.');
      }
      // Re-read after image processing to preserve concurrent metadata edits.
      const matches = readMatches(), latest = lookup(matches, library, item) || match;
      const key = `${library}:${latest.localId || id}`;
      matches[key] = applyArtwork({ ...latest, localId: latest.localId || id, libraryType: library, updatedAt: new Date().toISOString() }, { ...(latest.artworkOverrides || {}), [slot]: url });
      writeMatches(matches);
      res.json({ ok: true, library, localId: id, slot, publicUrl: url, match: matches[key], message: 'Artwork saved. Metadata identity and media files are unchanged.' });
    } catch (error) { res.status(error.status || 400).json({ ok: false, message: error.message }); }
  });
}
module.exports = { applyArtwork, registerMediaArtwork };
