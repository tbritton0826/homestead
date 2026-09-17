// Ignore heartbeat timestamps, but retain every user-visible status/progress field.
export function requestContentKey(value) {
  return JSON.stringify(value, (key, entry) => ['checkedAt', 'updatedAt', 'lastPolledAt'].includes(key) ? undefined : entry);
}
export function mergeRequestSnapshot(current, rows, libraries) {
  let changed = false;
  const next = { ...current };
  for (const library of libraries) {
    const updates = rows.filter((row) => row.library === library);
    const prior = current[library] || [];
    const merged = [...prior.filter((row) => !updates.some((update) =>
      (update.tmdbId && String(update.tmdbId) === String(row.tmdbId)) || (update.id && update.id === row.id))), ...updates];
    if (requestContentKey(prior) !== requestContentKey(merged)) { next[library] = merged; changed = true; }
  }
  return changed ? next : current;
}
export const musicIdentity = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function chooseOwnedArtist(owned, results = []) {
  const saved = owned.metadataMatch || owned.songs?.find((song) => song.artistMetadataMatch)?.artistMetadataMatch;
  const id = saved?.identifiers?.musicbrainzId || (saved?.provider === 'musicbrainz' ? saved.providerId : null);
  if (id) return { id, name: saved.title || owned.artist, type: 'Artist' };
  const exact = [...new Map(results.filter((row) => musicIdentity(row.name) === musicIdentity(owned.artist)).map((row) => [row.id, row])).values()];
  return exact.length === 1 ? exact[0] : null;
}
export function readableEbooks(book) {
  return (book?.ebookFiles || []).filter((file) => /\.(epub|pdf)$/i.test(file.name || file.path || file.sourcePath || ''));
}
export function transferRows(rows = []) {
  return rows.filter((row) => ['downloading', 'importing', 'scanning', 'needs-attention', 'paused', 'stalled'].includes(row.status));
}
