const rows = (value) => Object.values(value || {});
const text = (value) => String(value || '').trim();
const name = (item) => text(item.title || item.name || item.filename);
const normalize = (value) => text(value).toLowerCase();
export const homeLibrary = { movie: ['movies', 'Movies'], tv: ['tvshows', 'TV'], book: ['books', 'Books'], audiobook: ['books', 'Audiobooks'], music: ['music', 'Music'], youtube: ['youtube', 'YouTube'], photo: ['photos', 'Photos'], 'watch-order': ['movies', 'Watch order'] };
export function homeTimestamp(item) {
  for (const value of [item.addedAt, item.importedAt, item.createdAt, item.modifiedAt, item.updatedAt]) {
    const stamp = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(stamp)) return stamp;
  }
  return 0;
}
export function homeEpisodePill(item) {
  const parsed = text(item.name || item.title || item.path || item.sourcePath).match(/(?:^|[^a-z0-9])S(\d{1,3})[ ._-]*E(\d{1,4})\b/i);
  const season = item.seasonNumber ?? item.season ?? item.parsed?.season ?? parsed?.[1];
  const episode = item.episodeNumber ?? item.episode ?? item.parsed?.episode ?? parsed?.[2];
  if (season === '' || season == null || episode === '' || episode == null || !Number.isFinite(Number(season)) || !Number.isFinite(Number(episode))) return '';
  return `S${String(Number(season)).padStart(2, '0')} E${String(Number(episode)).padStart(2, '0')}`;
}
const filePath = (item) => text(item.sourcePath || item.path || item.filePath || item.publicPath);
const video = (file) => file.type === 'video' || /\.(?:mp4|mkv|m4v|avi|mov|webm|ts)$/i.test(filePath(file) || file.name);
const annotate = (item, type, parent = item) => ({ ...item, type, targetId: parent.id || parent.name, entity: parent, libraryLabel: homeLibrary[type][1], episodePill: type === 'tv' ? homeEpisodePill(item) : '', feedKey: `${type}:${parent.id || parent.name}:${['tv', 'youtube'].includes(type) ? filePath(item) || item.id || name(item) : ''}` });

export function homeCatalog(index = {}, youtubeCreators = [], enabled = {}) {
  const libraries = index.libraries || {};
  const catalog = [];
  for (const [key, type] of [['movies', 'movie'], ['books', 'book'], ['music', 'music'], ['photos', 'photo']]) {
    if (enabled[homeLibrary[type][0]] !== true) continue;
    for (const item of rows(libraries[key])) catalog.push(annotate(item, type));
  }
  if (enabled.tvshows === true) for (const show of rows(libraries.tv || libraries.tvshows)) {
    const episodes = rows(show.files).filter(video);
    if (episodes.length) for (const episode of episodes) catalog.push(annotate({ ...episode, addedAt: episode.addedAt || episode.importedAt || episode.modifiedAt || show.addedAt, showTitle: name(show), poster: episode.poster || show.poster, title: name(show) }, 'tv', show));
    else catalog.push(annotate(show, 'tv'));
  }
  if (enabled.youtube === true) for (const creator of youtubeCreators) for (const entry of rows(creator.videos)) {
    catalog.push(annotate({ ...entry, creatorId: creator.id, creatorName: name(creator), poster: entry.poster || entry.thumbnail || entry.thumb || creator.poster }, 'youtube', creator));
  }
  return catalog;
}

export function homeRecentlyAdded(catalog, limit = 24) {
  const unique = new Map();
  for (const item of [...catalog].sort((a, b) => homeTimestamp(b) - homeTimestamp(a))) if (!unique.has(item.feedKey)) unique.set(item.feedKey, item);
  return [...unique.values()].slice(0, limit);
}

export function homeProgress(catalog, progress = {}, watchOrders = [], knownCollectionIds = [], limit = 24) {
  const result = new Map();
  const collections = new Set(knownCollectionIds.map(String));
  const candidates = [...Object.entries(progress).map(([id, item]) => ({ id, ...item })), ...watchOrders];
  for (const saved of candidates.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))) {
    if (!homeLibrary[saved.type] || saved.completed === true || saved.finished === true) continue;
    const reading = saved.type === 'book';
    const percent = reading ? Number(saved.percentage) * 100 : Number(saved.duration) > 0 ? Number(saved.currentTime) / Number(saved.duration) * 100 : 0;
    if (saved.type === 'watch-order') {
      const collectionId = text(saved.collectionId);
      if (!catalog.some((entry) => ["movie", "tv"].includes(entry.type)) || !collections.has(collectionId) || !(Number(saved.queueIndex) > 0 || Number(saved.currentTime) > 0) || (Number(saved.episodeCount) > 0 && Number(saved.queueIndex) >= Number(saved.episodeCount))) continue;
      const key = `watch-order:${collectionId}`;
      if (!result.has(key)) result.set(key, { ...saved, libraryLabel: 'Watch order', targetId: collectionId, feedKey: key, progress: Number(saved.episodeCount) > 0 ? Number(saved.queueIndex || 0) / Number(saved.episodeCount) * 100 : 0 });
      continue;
    }
    if (percent >= 95 || !(Number(saved.currentTime) > 0 || (reading && (Number(saved.percentage) > 0 || saved.location)))) continue;
    const type = saved.type === 'audiobook' ? 'book' : saved.type;
    const candidates = catalog.filter((entry) => entry.type === type);
    // Resolve progress against the current authorized catalog. Orphaned browser
    // records must not reveal a removed/private title or navigate to another user’s item.
    const savedPath = filePath(saved);
    let match = savedPath && candidates.find((entry) => filePath(entry) === savedPath);
    if (!match && savedPath && type !== 'tv') match = candidates.find((entry) => rows(entry.entity?.files).some((file) => filePath(file) === savedPath));
    const id = text(saved.bookId || saved.showId || saved.seriesId || saved.parentShowId || saved.id);
    if (!match && id) match = candidates.find((entry) => text(entry.targetId) === id || text(entry.id) === id);
    if (!match) {
      const wanted = normalize(saved.showTitle || saved.seriesTitle || saved.artist || saved.title || saved.name);
      const matches = candidates.filter((entry) => [name(entry.entity), entry.creatorName].some((value) => wanted && normalize(value) === wanted));
      if (new Set(matches.map((entry) => text(entry.targetId))).size === 1) match = matches[0];
    }
    if (!match) continue;
    if (saved.parentWatchOrderCollectionId && collections.has(String(saved.parentWatchOrderCollectionId))) continue;
    const key = `${saved.type}:${match.targetId}`;
    if (!result.has(key)) result.set(key, { ...match, ...saved, type: saved.type, targetId: match.targetId, entity: match.entity, libraryLabel: homeLibrary[saved.type][1], episodePill: saved.type === 'tv' ? homeEpisodePill(saved) || match.episodePill : '', progress: Number.isFinite(percent) ? percent : 0, feedKey: key });
  }
  return [...result.values()].slice(0, limit);
}

const tokens = (entry) => { const genres = entry.entity?.genres || entry.entity?.metadata?.genres || []; return new Set((typeof genres === 'string' ? genres.split(/[,|]/) : rows(genres)).map((genre) => normalize(typeof genre === 'string' ? genre : genre.name)).filter(Boolean)); };
export function homeRelated(catalog, progress, limit = 12) {
  const recent = homeProgress(catalog, progress, [], [], Number.MAX_SAFE_INTEGER)[0];
  // Completed titles can still anchor recommendations, but never reappear in Continue.
  const history = Object.entries(progress).map(([id, item]) => ({ id, ...item })).filter((entry) => ['movie', 'tv'].includes(entry.type) && Number(entry.currentTime) > 0).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  const source = history.map((saved) => catalog.find((entry) => entry.type === saved.type && [saved.showId, saved.seriesId, saved.id].filter(Boolean).map(String).includes(String(entry.targetId)))).find(Boolean) || (['movie', 'tv'].includes(recent?.type) ? recent : null);
  if (!source) return { title: '', items: [] };
  const sourceGenres = tokens(source);
  if (!sourceGenres.size) return { title: '', items: [] };
  const seen = new Set();
  const items = catalog.filter((entry) => ['movie', 'tv'].includes(entry.type) && entry.targetId !== source.targetId).map((entry) => ({ entry, score: [...tokens(entry)].filter((genre) => sourceGenres.has(genre)).length })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).filter(({ entry }) => { const key = `${entry.type}:${entry.targetId}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit).map(({ entry }) => ({ ...entry, episodePill: '', title: name(entry.entity) }));
  return { title: name(source.entity || source), items };
}
