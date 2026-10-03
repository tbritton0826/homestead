// Metadata only. This module never renames media, monitors catalogs, or downloads files.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { applyArtwork } = require('./media-artwork.cjs');

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((v) => typeof v === "object" ? v.name : v).filter(Boolean);
const normalize = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const cleanTitle = (value) => String(value || "").replace(/\.(epub|pdf|mobi|azw3?|mp3|flac|m4a|m4b|aac|ogg|wav)$/i, "").replace(/\s*\((?:19|20)\d{2}\)\s*$/, "").trim();
const authorKey = (value) => normalize(String(value || "").replace(/^([^,]+),\s*([^,]+)$/, "$2 $1"));
const validName = (value) => value && !/^(unknown|untitled|various artists|standalone)(\b|$)/i.test(value);
const hasManualLock = (match) => Boolean(match && (match.manualOverride || match.matchLocked || match.matchSource === "manual-fix-match"));
const quote = (value) => `"${String(value || "").replace(/[\\"]/g, " ")}"`;

function localId(item = {}) { return String(item.localId || item.id || item.path || item.sourcePath || item.folderPath || ""); }
function names(item, kind) {
  const meta = item.metadata || {};
  return list(kind === "book" ? (meta.authors || meta.author || item.authors || item.author) : (meta.artists || meta.artist || item.artists || item.artist));
}
function identifiers(item, kind) {
  const meta = item.metadata || item.tags || {};
  const ids = { ...item.identifiers, ...meta.identifiers };
  for (const key of ["isbn", "isbn10", "isbn13", "openLibraryId", "googleBooksId"]) ids[key] ||= meta[key] || item[key];
  if (kind !== "book") {
    const key = kind === "artist" ? "musicbrainz_artistid" : kind === "release-group" ? "musicbrainz_releasegroupid" : "musicbrainz_recordingid";
    ids.musicbrainzId ||= meta[key] || item[key] || meta.musicbrainzId || item.musicbrainzId || (kind === "artist" ? meta.foreignArtistId || item.foreignArtistId : "");
    ids.musicbrainzId = list(ids.musicbrainzId)[0] || "";
  }
  return ids;
}
function buildEntities(library, index) {
  const items = Object.values(index?.libraries?.[library] || {});
  if (library === "books") return items.filter((item) => !Array.isArray(item.files) || item.files.some((f) => ["ebook", "audiobook"].includes(f.type))).map((item) => ({
    localId: localId(item), title: cleanTitle(item.metadata?.title || item.title || item.name), kind: "book",
    authors: names(item, "book"), identifiers: identifiers(item, "book"),
    edition: item.metadata?.edition || "", format: item.metadata?.format || "",
    sourcePath: item.sourcePath || item.folderPath || "",
  })).filter((item) => item.localId);
  const entities = [];
  const seenAlbums = new Set();
  for (const artist of items) {
    const artistName = artist.metadata?.name || artist.name || artist.title || "";
    const artistId = localId(artist);
    if (!artistId) continue;
    entities.push({ localId: artistId, title: artistName, kind: "artist", artists: [artistName], identifiers: identifiers(artist, "artist") });
    for (const file of artist.files || []) {
      if (!["audio", "audiobook"].includes(file.type)) continue;
      const filePath = String(file.path || file.sourcePath || "");
      if (!filePath) continue;
      const meta = file.metadata || file.tags || {};
      const directory = path.posix.dirname(filePath.replaceAll("\\", "/"));
      const directParent = path.posix.basename(directory);
      const parent = /^(?:cd|disc|disk)\s*\d+$/i.test(directParent) ? path.posix.basename(path.posix.dirname(directory)) : directParent;
      const albumName = meta.album || (normalize(parent) === normalize(artistName) ? "" : parent);
      const albumId = `album:${artistId}:${albumName}`;
      if (albumName && !seenAlbums.has(albumId)) {
        seenAlbums.add(albumId);
        entities.push({ localId: albumId, title: cleanTitle(albumName), kind: "release-group", artists: list(meta.albumArtist || meta.albumartist || artistName), identifiers: identifiers({ metadata: { musicbrainz_releasegroupid: meta.musicbrainz_releasegroupid } }, "release-group") });
      }
      let title = cleanTitle(meta.title || file.title || file.name || path.posix.basename(filePath));
      // Never strip an embedded title's leading number (e.g. "1979").
      if (!meta.title && !file.title) {
        title = title.replace(/^\s*\d{1,2}[\s._-]*[-x]\s*\d{1,3}[\s._-]+/i, "").replace(/^\s*\d{1,3}[\s._-]+/, "");
        const prefix = `${artistName} - `;
        if (title.toLowerCase().startsWith(prefix.toLowerCase())) title = title.slice(prefix.length);
      }
      entities.push({ localId: `track:${filePath}`, title, kind: "recording", artists: list(meta.artist || artistName), album: cleanTitle(albumName),
        duration: Number(meta.duration || file.duration || file.format?.duration || 0), identifiers: identifiers(file, "recording"), sourcePath: filePath });
    }
  }
  return entities;
}
function isbnValues(item) {
  const ids = item.identifiers || {};
  return [...list(ids.isbn), ...list(ids.isbn10), ...list(ids.isbn13), ...list(item.raw?.isbn)].map((v) => String(v).replace(/[^\dX]/gi, "")).filter(Boolean);
}
function evaluateCandidate(item, candidate) {
  if (!candidate?.providerId || !candidate.title) return { compatible: false, reason: "Missing provider identity" };
  if (normalize(cleanTitle(item.title)) !== normalize(cleanTitle(candidate.title))) return { compatible: false, reason: "Title differs" };
  if (item.kind === "book") {
    const wanted = item.authors.filter(validName).map(authorKey);
    const found = list(candidate.authors || candidate.people?.authors).map(authorKey);
    if (!wanted.length || !wanted.every((name) => found.includes(name))) return { compatible: false, reason: "Author differs or is missing" };
    if (item.edition && normalize(item.edition) !== normalize(candidate.edition || candidate.raw?.edition_name)) return { compatible: false, reason: "Edition needs review" };
    if (item.format && candidate.format && normalize(item.format) !== normalize(candidate.format)) return { compatible: false, reason: "Format differs" };
    const localIsbns = isbnValues(item), remoteIsbns = isbnValues(candidate);
    if (localIsbns.length && !localIsbns.some((id) => remoteIsbns.includes(id))) return { compatible: false, reason: "ISBN/edition could not be verified" };
    for (const key of ["openLibraryId", "googleBooksId"]) {
      if (item.identifiers?.[key] && item.identifiers[key] !== candidate.identifiers?.[key]) return { compatible: false, reason: "Provider ID differs" };
    }
  } else {
    if ((candidate.mediaType || "artist") !== item.kind) return { compatible: false, reason: "Music entity type differs" };
    const wanted = item.identifiers?.musicbrainzId;
    if (wanted && wanted !== candidate.providerId) return { compatible: false, reason: "MusicBrainz ID differs" };
    if (item.kind !== "artist") {
      const artists = list(candidate.artists || candidate.people?.artists).map(authorKey);
      if (!item.artists?.length || !item.artists.filter(validName).length || !item.artists.every((artist) => artists.includes(authorKey(artist)))) return { compatible: false, reason: "Artist differs or is missing" };
    }
    if (item.kind === "recording") {
      const length = Number(candidate.raw?.length || candidate.length || 0) / 1000;
      if (item.duration > 0 && length > 0 && Math.abs(item.duration - length) > 5) return { compatible: false, reason: "Track duration differs" };
      const releases = candidate.raw?.releases || [];
      if (item.album && !wanted && !releases.some((release) => normalize(cleanTitle(release.title)) === normalize(item.album))) return { compatible: false, reason: "Album/version needs review" };
    }
  }
  return { compatible: true, reason: "Exact identity match" };
}
function selectCandidate(item, candidates) {
  if (candidates.length >= 50 && !item.identifiers?.musicbrainzId && !isbnValues(item).length) return { match: null, reason: "Search has too many candidates — narrow it in Fix Match" };
  const unique = [...new Map(candidates.map((c) => [`${c.provider}:${c.providerId}`, c])).values()];
  const exact = unique.filter((c) => evaluateCandidate(item, c).compatible);
  return exact.length === 1 ? { match: exact[0], reason: "Exact identity match" } : {
    match: null, reason: exact.length > 1 ? "Multiple compatible identities — choose the correct edition/version" : "No compatible title and author/artist match found",
  };
}
function makeRecord(library, item, candidate, manual = false) {
  const { raw, ...safe } = candidate;
  return { ...safe, libraryType: library, localId: item.localId, aliases: [item.localId], status: "matched", mediaType: item.kind,
    people: { authors: candidate.authors || [], artists: candidate.artists || [] },
    manualOverride: manual, matchLocked: manual, matchSource: manual ? "manual-fix-match" : "conservative-auto-match",
    matchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function createLibraryAutoMatch({ stateFile, readIndex, readMatches, writeMatches, searchBooks, searchMusic, linkArtist }) {
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { state = {}; }
  const running = new Set();
  const pending = new Set();
  const status = {};
  for (const library of ["music", "books"]) state[library] = { enabled: true, reviews: {}, attempts: {}, ...state[library] };
  const persist = () => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state)); fs.renameSync(`${stateFile}.tmp`, stateFile); };
  const currentMatch = (library, item, all = readMatches()) => {
    const record = all[`${library}:${item.localId}`];
    const resolved = record?.aliasOf ? all[record.aliasOf] : record;
    return resolved?.localId === item.localId && (resolved.providerId || resolved.identifiers?.musicbrainzId || hasManualLock(resolved)) ? resolved : null;
  };
  function getStatus(library, offset = 0) {
    const matches = readMatches();
    const reviews = Object.values(state[library].reviews).filter((item) => !currentMatch(library, item, matches));
    return { ok: true, enabled: state[library].enabled, state: "idle", matched: 0, scanned: 0, ...status[library], running: running.has(library), reviewCount: reviews.length,
      reviews: reviews.slice(offset, offset + 40), offset, hasMore: offset + 40 < reviews.length };
  }
  async function search(item, queryOverride) {
    if (item.kind === "book") {
      const isbn = isbnValues(item)[0];
      const query = queryOverride || (isbn ? `isbn:${isbn}` : `title:${quote(item.title)} AND author:${quote(item.authors[0] || "")}`);
      return searchBooks(query, { provider: "openlibrary", limit: 50 });
    }
    const field = item.kind === "release-group" ? "releasegroup" : item.kind;
    const query = queryOverride || (item.identifiers.musicbrainzId ? `${item.kind === "artist" ? "arid" : item.kind === "recording" ? "rid" : "rgid"}:${item.identifiers.musicbrainzId}` : `${field}:${quote(item.title)}${item.kind === "artist" ? "" : ` AND artist:${quote(item.artists[0])}`}`);
    return searchMusic(query, { type: item.kind, limit: 50 });
  }
  async function run(library, { force = false, automatic = false, localId: wantedId } = {}) {
    if (running.has(library)) { pending.add(library); return; }
    running.add(library);
    status[library] = { state: "running", scanned: 0, matched: 0, skipped: 0, errors: 0, message: "Matching metadata in the background…" };
    try {
      const entities = buildEntities(library, readIndex()).filter((item) => !wantedId || item.localId === wantedId);
      if (!wantedId) {
        const ids = new Set(entities.map((item) => item.localId));
        for (const id of Object.keys(state[library].reviews)) if (!ids.has(id)) { delete state[library].reviews[id]; delete state[library].attempts[id]; }
      }
      status[library].total = entities.length;
      for (const item of entities) {
        if (automatic && state[library].enabled === false) break;
        status[library].scanned++;
        const saved = currentMatch(library, item);
        if (saved) { status[library].skipped++; delete state[library].reviews[item.localId]; continue; }
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(item)).digest("hex");
        const prior = state[library].attempts[item.localId];
        if (!force && prior?.fingerprint === fingerprint && (!prior.error || Date.now() - prior.at < 3600000)) { status[library].skipped++; continue; }
        try {
          const identifiable = validName(item.title) && (item.kind !== "book" || item.authors.some(validName));
          const candidates = identifiable ? await search(item) : [];
          const selection = selectCandidate(item, candidates);
          // Re-read after network I/O so Fix Match saved during this job always wins.
          if (currentMatch(library, item)) { delete state[library].reviews[item.localId]; continue; }
          if (selection.match) {
            const all = readMatches();
            all[`${library}:${item.localId}`] = applyArtwork(makeRecord(library, item, selection.match), all[`${library}:${item.localId}`]?.artworkOverrides || {});
            writeMatches(all);
            status[library].matched++;
            delete state[library].reviews[item.localId];
            if (library === "music" && item.kind === "artist" && linkArtist) {
              try { await linkArtist(selection.match); } catch (error) { status[library].linkWarning = error.message; }
            }
          } else {
            state[library].reviews[item.localId] = { ...item, reason: selection.reason, candidates: candidates.slice(0, 8).map((c) => ({ ...makeRecord(library, item, c), compatibility: evaluateCandidate(item, c) })) };
          }
          state[library].attempts[item.localId] = { fingerprint, at: Date.now() };
        } catch (error) {
          status[library].errors++;
          state[library].reviews[item.localId] = { ...item, reason: `Provider unavailable: ${error.message}`, candidates: [] };
          state[library].attempts[item.localId] = { fingerprint, at: Date.now(), error: true };
        }
        persist();
        if (library === "books") await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      status[library].state = "complete";
      status[library].message = `${status[library].matched} matched; ${status[library].skipped} already matched or previously checked. Uncertain items need review.`;
    } catch (error) { status[library] = { ...status[library], state: "error", message: error.message }; }
    finally {
      running.delete(library); persist();
      if (pending.delete(library) && state[library].enabled) setImmediate(() => run(library, { automatic: true }));
    }
  }
  function start(library, options = {}) {
    if (options.automatic && state[library].enabled === false) return getStatus(library);
    if (!running.has(library)) void run(library, options);
    else if (options.automatic) pending.add(library);
    return getStatus(library);
  }
  function setEnabled(library, enabled) { state[library].enabled = enabled; persist(); return getStatus(library); }
  function findEntity(library, id) { return buildEntities(library, readIndex()).find((item) => item.localId === id); }
  return { start, run, getStatus, setEnabled, findEntity, search, evaluateCandidate, makeRecord };
}

module.exports = { normalize, cleanTitle, authorKey, buildEntities, evaluateCandidate, selectCandidate, makeRecord, hasManualLock, createLibraryAutoMatch };
