// Homestead Music metadata fetcher.
// Provider: MusicBrainz artist search first. TheAudioDB can be layered in later.
// Dependency-free CJS so server.cjs can require it directly.

function strictEncodeQuery(value = "") {
  return encodeURIComponent(String(value || "").trim()).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

function getYearFromDate(value) {
  if (!value) return null;
  const year = String(value).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function musicBrainzReleaseGroupCoverUrl(value = "") {
  const match = String(value || "").trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match ? `https://coverartarchive.org/release-group/${match[0]}/front-500` : "";
}

function normalizeMusicBrainzArtist(artist = {}) {
  const title = artist.name || artist.artist || "Untitled Artist";
  const musicbrainzId = artist.id || artist.mbid || artist.musicbrainzId || null;
  const lifeSpan = artist["life-span"] || {};

  return {
    id: musicbrainzId || title,
    providerId: musicbrainzId,
    provider: "musicbrainz",
    mediaType: "artist",
    title,
    name: title,
    sortTitle: artist["sort-name"] || artist.sortName || title,
    year: getYearFromDate(lifeSpan.begin || artist.beginDate),
    releaseDate: lifeSpan.begin || artist.beginDate || "",
    description: artist.disambiguation || artist.description || "",
    type: artist.type || "Artist",
    country: artist.country || "",
    area: artist.area?.name || "",
    genres: normalizeArray(artist.tags).map((tag) =>
      typeof tag === "string" ? tag : tag?.name
    ).filter(Boolean),
    poster: artist.poster || artist.image || "",
    backdrop: artist.backdrop || "",
    thumbnail: artist.thumbnail || artist.image || "",
    artists: [title],
    identifiers: {
      musicbrainzId,
    },
    raw: artist,
  };
}

function normalizeMusicBrainzRecording(recording = {}) {
  const title = recording.title || recording.name || "Untitled Track";
  const musicbrainzId = recording.id || recording.mbid || recording.musicbrainzId || null;
  const artistCredit = normalizeArray(recording["artist-credit"])
    .map((credit) => credit?.artist?.name || credit?.name)
    .filter(Boolean);

  return {
    id: musicbrainzId || title,
    providerId: musicbrainzId,
    provider: "musicbrainz",
    mediaType: "recording",
    title,
    name: title,
    sortTitle: title,
    year: getYearFromDate(recording["first-release-date"]),
    releaseDate: recording["first-release-date"] || "",
    description: recording.disambiguation || "",
    type: "Recording",
    country: "",
    area: "",
    genres: normalizeArray(recording.tags).map((tag) =>
      typeof tag === "string" ? tag : tag?.name
    ).filter(Boolean),
    poster: "",
    backdrop: "",
    thumbnail: "",
    artists: artistCredit,
    identifiers: {
      musicbrainzId,
    },
    raw: recording,
  };
}

async function fetchJson(url) {
  // Serialize this provider's metadata requests, including bulk Auto Match.
  const previous = musicRequestTail;
  let release;
  musicRequestTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextMusicRequestAt - Date.now())));
  nextMusicRequestAt = Date.now() + 1100;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Homestead/1.0 (metadata-fetch; self-hosted)",
    },
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `MusicBrainz returned ${response.status}`);
  }

  return data;
  } finally { release(); }
}

let musicRequestTail = Promise.resolve();
let nextMusicRequestAt = 0;

async function searchMusicBrainzAlbums(query, options = {}) {
  const data = await fetchJson(`https://musicbrainz.org/ws/2/release-group?query=${strictEncodeQuery(query)}&fmt=json&limit=${Math.min(100, Number(options.limit) || 12)}`);
  return (data?.["release-groups"] || []).map((album) => {
    const poster = musicBrainzReleaseGroupCoverUrl(album.id);
    return {
      id: album.id, providerId: album.id, provider: "musicbrainz", mediaType: "release-group",
      title: album.title, name: album.title, year: getYearFromDate(album["first-release-date"]),
      releaseDate: album["first-release-date"] || "", description: album.disambiguation || "",
      artists: (album["artist-credit"] || []).map((credit) => credit.artist?.name || credit.name).filter(Boolean),
      identifiers: { musicbrainzId: album.id }, poster, image: poster, cover: poster, raw: album,
    };
  });
}

async function searchMusicBrainzArtists(query, options = {}) {
  const limit = Number(options.limit || 12);
  const encodedQuery = strictEncodeQuery(query);
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodedQuery}&fmt=json&limit=${limit}`;
  const data = await fetchJson(url);
  const artists = Array.isArray(data?.artists) ? data.artists : [];

  return artists.map(normalizeMusicBrainzArtist);
}

async function searchMusicBrainzRecordings(query, options = {}) {
  const limit = Number(options.limit || 12);
  const encodedQuery = strictEncodeQuery(query);
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodedQuery}&fmt=json&limit=${limit}`;
  const data = await fetchJson(url);
  const recordings = Array.isArray(data?.recordings) ? data.recordings : [];

  return recordings.map(normalizeMusicBrainzRecording);
}

function dedupeMusicResults(results = []) {
  const seen = new Set();
  const deduped = [];

  for (const result of results) {
    const key = [
      result.provider,
      result.mediaType,
      result.providerId,
      result.title,
      (result.artists || []).join(","),
      result.year,
    ]
      .filter(Boolean)
      .join(":")
      .toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

async function searchMusicMetadata(query, options = {}) {
  const provider = String(options.provider || "musicbrainz").toLowerCase();
  const type = String(options.type || "artist").toLowerCase();
  const limit = Number(options.limit || 12);

  if (!query || !String(query).trim()) {
    throw new Error("Missing music metadata search query");
  }

  if (provider !== "musicbrainz") {
    throw new Error(`Unsupported music metadata provider: ${provider}`);
  }

  if (type === "recording" || type === "track" || type === "song") {
    return searchMusicBrainzRecordings(query, { ...options, limit });
  }

  if (type === "album" || type === "release-group") return searchMusicBrainzAlbums(query, options);

  if (type === "all") {
    const settled = await Promise.allSettled([
      searchMusicBrainzArtists(query, { ...options, limit }),
      searchMusicBrainzRecordings(query, { ...options, limit }),
    ]);

    return dedupeMusicResults(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      )
    ).slice(0, limit);
  }

  return searchMusicBrainzArtists(query, { ...options, limit });
}

module.exports = {
  searchMusicMetadata,
  searchMusicBrainzArtists,
  searchMusicBrainzRecordings,
  normalizeMusicBrainzArtist,
  normalizeMusicBrainzRecording,
  musicBrainzReleaseGroupCoverUrl,
  searchMusicBrainzAlbums,
};
