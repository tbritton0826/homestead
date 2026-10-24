export const memberKey = (item) => `${item.library}:${item.sourceId || item.id || item.title}`;
// Local HTTP servers do not expose randomUUID in every browser. This is a draft
// file identity, not an authentication secret.
export const collectionDraftId = (crypto = globalThis.crypto) => `draft-${crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
export const collectionRowLabel = (row) => row.unit === 'season' ? `Season ${row.season}` : row.unit === 'episode' ? `S${String(row.season).padStart(2, '0')}E${String(row.episodes?.[0]).padStart(2, '0')}` : row.library === 'books' ? 'Book' : row.library === 'tv' ? 'TV series' : 'Movie';
export function episodeIdentity(file = {}) {
  const match = String(file.name || file.title || file.sourcePath || file.path || '').match(/S(\d{1,3})[ ._-]*E(\d{1,4})\b/i);
  const season = file.seasonNumber ?? file.season ?? file.parsed?.season ?? match?.[1];
  const episode = file.episodeNumber ?? file.episode ?? file.parsed?.episode ?? match?.[2];
  return season != null && season !== '' && episode != null && episode !== '' && Number.isInteger(Number(season)) && Number.isInteger(Number(episode)) ? { season: Number(season), episode: Number(episode) } : null;
}
export function seasonRows(item) {
  const bySeason = new Map();
  const source = item.originalItem || item;
  const files = [...Object.values(item.files || source.files || {}), ...Object.values(item.episodes || source.episodes || {})];
  for (const [key, season] of Object.entries(item.seasons || source.seasons || {})) {
    const seasonNumber = season.seasonNumber ?? season.season ?? String(key).match(/\d+/)?.[0];
    for (const episode of Object.values(season.episodes || season.files || {})) {
      files.push({ ...episode, seasonNumber: episode.seasonNumber ?? episode.season ?? seasonNumber });
    }
  }
  for (const file of files) {
    if (file.type && !['video', 'episode', 'tv'].includes(file.type)) continue;
    const identity = episodeIdentity(file);
    if (!identity) continue;
    if (!bySeason.has(identity.season)) bySeason.set(identity.season, new Set());
    bySeason.get(identity.season).add(identity.episode);
  }
  const base = { library: item.library, sourceId: item.sourceId || item.id, title: item.title || item.name, type: item.library === 'books' ? 'book' : item.library === 'tv' ? 'tv' : 'movie' };
  return bySeason.size ? [...bySeason].sort(([a], [b]) => a - b).map(([season, episodes]) => ({ ...base, unit: 'season', season, episodes: [...episodes].sort((a, b) => a - b) })) : [{ ...base, unit: item.library === 'tv' ? 'series' : 'title' }];
}
export function splitSeason(rows, index) {
  const row = rows[index];
  if (row?.unit !== 'season' || !row.episodes?.length) return rows;
  return rows.flatMap((entry, i) => i === index ? row.episodes.map(episode => ({ ...row, unit: 'episode', episodes: [episode] })) : [entry]);
}
export function groupSeason(rows, index) {
  const target = rows[index];
  const same = row => row.unit === 'episode' && memberKey(row) === memberKey(target) && Number(row.season) === Number(target.season);
  const first = rows.findIndex(same);
  const episodes = rows.filter(same).flatMap(row => row.episodes || []);
  return rows.flatMap((row, i) => i === first ? [{ ...target, unit: 'season', episodes: [...new Set(episodes)] }] : same(row) ? [] : [row]);
}
export function membersFromRows(rows) {
  const seen = new Set();
  return rows.filter(row => row.sourceId && !seen.has(memberKey(row)) && seen.add(memberKey(row))).map((row, index) => ({ library: row.library, sourceId: row.sourceId, title: row.title, order: index + 1 }));
}
export function watchOrderFromRows(rows, name, sourceUrl = '') {
  return { title: `${name} Watch Order`, sourceUrl, manualOrder: true, sections: [{ id: 'manual', title: 'Manual order', manualOrder: true, items: rows.map((row, index) => ({ ...row, detail: collectionRowLabel(row), order: index + 1 })) }] };
}
export function matchImportedRows(order, catalog) {
  const normalize = value => String(value || '').toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return (order?.sections || []).flatMap(section => section.items || []).map(row => {
    const library = row.library || (row.type === 'book' ? 'books' : row.type === 'movie' ? 'movies' : 'tv');
    const matches = catalog.filter(item => item.library === library && (row.sourceId ? String(row.sourceId) === String(item.sourceId) : normalize(row.title) === normalize(item.title)));
    const match = matches.length === 1 ? matches[0] : null;
    const base = { ...row, library, sourceId: match?.sourceId || '', title: match?.title || row.title, unmatched: !match };
    if (row.unit) return [base];
    if (library === 'tv' && row.season != null && row.season !== '') {
      const explicit = Array.isArray(row.episodes) ? row.episodes.map(Number).filter(Number.isFinite) : [];
      const episodes = explicit.length ? explicit : match ? seasonRows(match).find(season => Number(season.season) === Number(row.season))?.episodes || [] : [];
      return [{ ...base, season: Number(row.season), episodes, unit: episodes.length === 1 ? 'episode' : 'season' }];
    }
    return match && library === 'tv' ? seasonRows(match) : [{ ...base, unit: library === 'tv' ? 'series' : 'title' }];
  }).flat();
}
