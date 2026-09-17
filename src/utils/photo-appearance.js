// Album settings inherit the library until explicitly overridden. Never copy
// an album's changes back into the Photos library or another album.
export function resolvePhotoAlbumAppearance(base = {}, albumId = "") {
  if (!albumId) return base;
  return { ...base, ...base.albumAppearance?.[albumId], albumPoster: base.albumCovers?.[albumId] || "" };
}

export function updatePhotoAlbumAppearance(base = {}, albumId = "", update) {
  const current = resolvePhotoAlbumAppearance(base, albumId);
  const next = typeof update === "function" ? update(current) : update;
  if (!albumId) return next;
  const overrides = { ...base.albumAppearance?.[albumId] };
  const covers = { ...base.albumCovers };
  for (const [key, value] of Object.entries(next || {})) {
    if (["albumAppearance", "albumCovers", "__proto__", "constructor", "prototype"].includes(key)) continue;
    if (key === "albumPoster") { covers[albumId] = value; continue; }
    if (value !== current[key]) overrides[key] = value;
  }
  return { ...base, albumCovers: covers, albumAppearance: { ...base.albumAppearance, [albumId]: overrides } };
}

export function resetPhotoAlbumAppearance(base = {}, albumId = "") {
  const albumAppearance = { ...base.albumAppearance };
  delete albumAppearance[albumId];
  // Reset appearance doesn't discard a deliberately chosen album poster.
  return { ...base, albumAppearance };
}
