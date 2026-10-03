// Homestead metadata provider registry + normalization helpers.
// Keep this file dependency-free so it can be reused by frontend and backend code later.

export const METADATA_STATUS = {
  MATCHED: "matched",
  UNMATCHED: "unmatched",
  PARTIAL: "partial",
  MANUAL: "manual",
  FAILED: "failed",
};

export const METADATA_SOURCES = {
  LOCAL: "local",
  MANUAL: "manual",
  TMDB: "tmdb",
  TVDB: "tvdb",
  IMDB: "imdb",
  MUSICBRAINZ: "musicbrainz",
  AUDIODB: "audiodb",
  OPENLIBRARY: "openlibrary",
  GOOGLEBOOKS: "googlebooks",
  YOUTUBE: "youtube",
};

export const METADATA_PROVIDERS = {
  movies: ["local", "tmdb"],
  tv: ["local", "tmdb"],
  books: ["local", "openlibrary", "googlebooks"],
  music: ["local", "musicbrainz", "audiodb"],
  youtube: ["local", "youtube"],
  photos: ["local"],
  personal: ["local", "manual"],
  performers: ["local", "manual"],
  celebrities: ["local", "tmdb", "manual"],
  inventory: ["local", "manual"],
};

export function getMetadataProviders(libraryType = "unknown") {
  return METADATA_PROVIDERS[libraryType] || ["local", "manual"];
}

export function getTmdbImageUrl(path, size = "w780") {
  if (!path) return "";

  if (String(path).startsWith("http")) {
    return path;
  }

  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value].filter(Boolean);
}

export function getPrimaryTitle(item = {}) {
  return (
    item.title ||
    item.name ||
    item.artist ||
    item.author ||
    item.displayName ||
    item.filename ||
    item.fileName ||
    item.folderName ||
    "Untitled"
  );
}

export function getYearFromDate(value) {
  if (!value) return null;

  const year = String(value).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

export function createBaseMetadata(item = {}, libraryType = "unknown") {
  const title = getPrimaryTitle(item);

  return {
    status: item.metadata?.status || METADATA_STATUS.UNMATCHED,
    source: item.metadata?.source || METADATA_SOURCES.LOCAL,
    providerId: item.metadata?.providerId || null,
    providerUrl: item.metadata?.providerUrl || null,

    title,
    sortTitle: item.sortTitle || title,
    originalTitle: item.originalTitle || item.originalName || "",
    year:
      item.year ||
      getYearFromDate(item.releaseDate) ||
      getYearFromDate(item.firstAirDate) ||
      getYearFromDate(item.publishedAt) ||
      null,
    releaseDate: item.releaseDate || item.firstAirDate || item.publishedAt || "",
    description: item.description || item.overview || item.summary || "",
    genres: normalizeArray(item.genres),
    tags: normalizeArray(item.tags),

    poster: item.poster || item.posterPath || item.cover || "",
    backdrop: item.backdrop || item.backdropPath || "",
    logo: item.logo || "",
    banner: item.banner || "",
    thumbnail: item.thumbnail || item.image || item.cover || "",

    people: {
      cast: normalizeArray(item.cast),
      crew: normalizeArray(item.crew),
      creators: normalizeArray(item.creators),
      authors: normalizeArray(item.authors || item.author),
      artists: normalizeArray(item.artists || item.artist),
    },

    identifiers: {
      tmdbId: item.tmdbId || null,
      imdbId: item.imdbId || null,
      tvdbId: item.tvdbId || null,
      musicbrainzId: item.musicbrainzId || item.mbid || null,
      audiodbId: item.audiodbId || null,
      openLibraryId: item.openLibraryId || item.olid || null,
      googleBooksId: item.googleBooksId || null,
      isbn10: item.isbn10 || null,
      isbn13: item.isbn13 || item.isbn || null,
      youtubeId: item.youtubeId || item.videoId || item.channelId || null,
    },

    match: {
      query: item.metadata?.match?.query || title,
      confidence: item.metadata?.match?.confidence || 0,
      candidates: item.metadata?.match?.candidates || [],
      matchedAt: item.metadata?.match?.matchedAt || null,
      refreshedAt: item.metadata?.match?.refreshedAt || null,
    },

    local: {
      path: item.path || item.filePath || item.folderPath || "",
      folderName: item.folderName || "",
      fileName: item.fileName || item.filename || "",
      extension: item.extension || "",
      size: item.size || item.sizeBytes || null,
      modifiedAt: item.modifiedAt || item.lastModified || "",
      artworkFound: normalizeArray(item.artworkFound),
    },

    libraryType,
  };
}

export function normalizeTmdbMetadata(item = {}, mediaType = "movie") {
  const title = item.title || item.name || "Untitled";
  const releaseDate = item.releaseDate || item.firstAirDate || item.release_date || item.first_air_date || "";

  return {
    status: item.id || item.tmdbId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.TMDB,
    providerId: item.id || item.tmdbId || null,
    providerUrl:
      item.id || item.tmdbId
        ? `https://www.themoviedb.org/${mediaType}/${item.id || item.tmdbId}`
        : null,

    title,
    sortTitle: title,
    originalTitle: item.originalTitle || item.originalName || item.original_title || item.original_name || "",
    year: item.year || getYearFromDate(releaseDate),
    releaseDate,
    description: item.overview || item.description || "",

    genres: normalizeArray(item.genres).map((genre) =>
      typeof genre === "string" ? genre : genre.name
    ),

    poster: getTmdbImageUrl(item.posterPath || item.poster_path || item.poster, "w500"),
    backdrop: getTmdbImageUrl(item.backdropPath || item.backdrop_path || item.backdrop, "original"),
    logo: "",
    banner: "",

    people: {
      cast: normalizeArray(item.credits?.cast || item.cast),
      crew: normalizeArray(item.credits?.crew || item.crew),
      creators: normalizeArray(item.createdBy || item.created_by),
      authors: [],
      artists: [],
    },

    identifiers: {
      tmdbId: item.id || item.tmdbId || null,
      imdbId: item.externalIds?.imdbId || item.external_ids?.imdb_id || item.imdbId || null,
      tvdbId: item.externalIds?.tvdbId || item.external_ids?.tvdb_id || item.tvdbId || null,
    },
  };
}

export function normalizeOpenLibraryMetadata(item = {}) {
  const title = item.title || "Untitled";
  const authors = normalizeArray(item.authors || item.author_name).map((author) =>
    typeof author === "string" ? author : author.name
  );

  return {
    status: item.key || item.openLibraryId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.OPENLIBRARY,
    providerId: item.key || item.openLibraryId || null,
    providerUrl: item.key ? `https://openlibrary.org${item.key}` : null,

    title,
    sortTitle: title,
    originalTitle: "",
    year: item.first_publish_year || item.year || null,
    releaseDate: item.first_publish_year ? String(item.first_publish_year) : "",
    description:
      typeof item.description === "string"
        ? item.description
        : item.description?.value || "",

    genres: normalizeArray(item.subject).slice(0, 12),
    poster: item.cover_i
      ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`
      : item.cover || "",
    backdrop: "",
    logo: "",
    banner: "",

    people: {
      cast: [],
      crew: [],
      creators: [],
      authors,
      artists: [],
    },

    identifiers: {
      openLibraryId: item.key || item.openLibraryId || null,
      isbn10: normalizeArray(item.isbn).find((isbn) => String(isbn).length === 10) || null,
      isbn13: normalizeArray(item.isbn).find((isbn) => String(isbn).length === 13) || null,
    },
  };
}

export function normalizeGoogleBooksMetadata(item = {}) {
  const volume = item.volumeInfo || item;
  const title = volume.title || "Untitled";

  return {
    status: item.id || item.googleBooksId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.GOOGLEBOOKS,
    providerId: item.id || item.googleBooksId || null,
    providerUrl: volume.infoLink || null,

    title,
    sortTitle: title,
    originalTitle: "",
    year: getYearFromDate(volume.publishedDate),
    releaseDate: volume.publishedDate || "",
    description: volume.description || "",

    genres: normalizeArray(volume.categories),
    poster: volume.imageLinks?.thumbnail || volume.imageLinks?.smallThumbnail || "",
    backdrop: "",
    logo: "",
    banner: "",

    people: {
      cast: [],
      crew: [],
      creators: [],
      authors: normalizeArray(volume.authors),
      artists: [],
    },

    identifiers: {
      googleBooksId: item.id || item.googleBooksId || null,
      isbn10:
        normalizeArray(volume.industryIdentifiers).find((id) => id.type === "ISBN_10")
          ?.identifier || null,
      isbn13:
        normalizeArray(volume.industryIdentifiers).find((id) => id.type === "ISBN_13")
          ?.identifier || null,
    },
  };
}

export function normalizeMusicBrainzArtistMetadata(item = {}) {
  const title = item.name || item.artist || "Untitled Artist";

  return {
    status: item.id || item.mbid || item.musicbrainzId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.MUSICBRAINZ,
    providerId: item.id || item.mbid || item.musicbrainzId || null,
    providerUrl:
      item.id || item.mbid || item.musicbrainzId
        ? `https://musicbrainz.org/artist/${item.id || item.mbid || item.musicbrainzId}`
        : null,

    title,
    sortTitle: item.sortName || item["sort-name"] || title,
    originalTitle: "",
    year: getYearFromDate(item["life-span"]?.begin || item.beginDate),
    releaseDate: item["life-span"]?.begin || item.beginDate || "",
    description: item.disambiguation || item.description || "",

    genres: normalizeArray(item.tags).map((tag) =>
      typeof tag === "string" ? tag : tag.name
    ),

    poster: item.poster || item.image || "",
    backdrop: "",
    logo: "",
    banner: "",
    thumbnail: item.thumbnail || item.image || "",

    people: {
      cast: [],
      crew: [],
      creators: [],
      authors: [],
      artists: [title],
    },

    identifiers: {
      musicbrainzId: item.id || item.mbid || item.musicbrainzId || null,
    },
  };
}

export function normalizeAudioDbArtistMetadata(item = {}) {
  const title = item.strArtist || item.artist || item.name || "Untitled Artist";

  return {
    status: item.idArtist || item.audiodbId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.AUDIODB,
    providerId: item.idArtist || item.audiodbId || null,
    providerUrl: item.strWebsite || null,

    title,
    sortTitle: title,
    originalTitle: "",
    year: item.intFormedYear || null,
    releaseDate: item.intFormedYear ? String(item.intFormedYear) : "",
    description: item.strBiographyEN || item.description || "",

    genres: normalizeArray([item.strGenre, item.strStyle, item.strMood]).filter(Boolean),
    poster: item.strArtistThumb || item.strArtistClearart || "",
    backdrop: item.strArtistFanart || item.strArtistFanart2 || "",
    logo: item.strArtistLogo || "",
    banner: item.strArtistBanner || "",
    thumbnail: item.strArtistThumb || "",

    people: {
      cast: [],
      crew: [],
      creators: [],
      authors: [],
      artists: [title],
    },

    identifiers: {
      audiodbId: item.idArtist || item.audiodbId || null,
      musicbrainzId: item.strMusicBrainzID || item.musicbrainzId || null,
    },
  };
}

export function normalizeYouTubeMetadata(item = {}) {
  const title = item.title || item.name || item.channelTitle || "Untitled YouTube Item";

  return {
    status: item.videoId || item.channelId || item.youtubeId ? METADATA_STATUS.MATCHED : METADATA_STATUS.PARTIAL,
    source: METADATA_SOURCES.YOUTUBE,
    providerId: item.videoId || item.channelId || item.youtubeId || null,
    providerUrl:
      item.videoId || item.youtubeId
        ? `https://www.youtube.com/watch?v=${item.videoId || item.youtubeId}`
        : item.channelId
        ? `https://www.youtube.com/channel/${item.channelId}`
        : null,

    title,
    sortTitle: title,
    originalTitle: "",
    year: getYearFromDate(item.publishedAt || item.uploadDate),
    releaseDate: item.publishedAt || item.uploadDate || "",
    description: item.description || "",

    genres: normalizeArray(item.categories),
    tags: normalizeArray(item.tags),

    poster: item.thumbnail || item.poster || "",
    backdrop: item.backdrop || "",
    logo: "",
    banner: item.banner || "",
    thumbnail: item.thumbnail || "",

    people: {
      cast: [],
      crew: [],
      creators: normalizeArray(item.channelTitle || item.creator),
      authors: [],
      artists: [],
    },

    identifiers: {
      youtubeId: item.videoId || item.channelId || item.youtubeId || null,
    },
  };
}

export function mergeMetadata(baseMetadata, providerMetadata = {}) {
  return {
    ...baseMetadata,
    ...providerMetadata,

    genres: providerMetadata.genres?.length
      ? providerMetadata.genres
      : baseMetadata.genres,

    tags: providerMetadata.tags?.length
      ? providerMetadata.tags
      : baseMetadata.tags,

    people: {
      ...baseMetadata.people,
      ...(providerMetadata.people || {}),
    },

    identifiers: {
      ...baseMetadata.identifiers,
      ...(providerMetadata.identifiers || {}),
    },

    match: {
      ...baseMetadata.match,
      confidence:
        providerMetadata.status === METADATA_STATUS.MATCHED
          ? Math.max(baseMetadata.match?.confidence || 0, 90)
          : baseMetadata.match?.confidence || 0,
      refreshedAt: new Date().toISOString(),
    },

    local: baseMetadata.local,
    libraryType: baseMetadata.libraryType,
  };
}

export function normalizeHomesteadMetadata(item = {}, libraryType = "unknown", providerMetadata = null) {
  const baseMetadata = createBaseMetadata(item, libraryType);

  if (!providerMetadata) {
    return baseMetadata;
  }

  return mergeMetadata(baseMetadata, providerMetadata);
}