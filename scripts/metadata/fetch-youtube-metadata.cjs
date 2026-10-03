// Homestead YouTube metadata fetcher.
// Providers:
// - YouTube Data API when YOUTUBE_API_KEY or TUBEARCHIVIST_YOUTUBE_API_KEY is available
// - YouTube oEmbed for direct video/playlist URLs without an API key
// - TubeArchivist search when TUBEARCHIVIST_URL + TUBEARCHIVIST_API_KEY are available
// - Manual/local fallback candidate when no provider can search
//
// Dependency-free CJS so server.cjs can require it directly.

const YOUTUBE_WATCH_BASE = "https://www.youtube.com/watch?v=";
const YOUTUBE_CHANNEL_BASE = "https://www.youtube.com/channel/";
const YOUTUBE_PLAYLIST_BASE = "https://www.youtube.com/playlist?list=";

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

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toHttpsThumbnail(url = "") {
  if (!url) return "";
  return String(url).replace(/^http:/i, "https:");
}

function getYouTubeApiKey(options = {}) {
  return (
    options.apiKey ||
    process.env.YOUTUBE_API_KEY ||
    process.env.TUBEARCHIVIST_YOUTUBE_API_KEY ||
    process.env.GOOGLE_YOUTUBE_API_KEY ||
    ""
  );
}

function getTubeArchivistConfig(options = {}) {
  return {
    baseUrl: String(options.tubeArchivistUrl || process.env.TUBEARCHIVIST_URL || "").replace(/\/+$/, ""),
    apiKey: String(options.tubeArchivistApiKey || process.env.TUBEARCHIVIST_API_KEY || ""),
  };
}

function parseYouTubeIds(input = "") {
  const raw = String(input || "").trim();
  const result = {
    original: raw,
    videoId: "",
    channelId: "",
    playlistId: "",
    handle: "",
    isUrl: /^https?:\/\//i.test(raw),
  };

  if (!raw) return result;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");

    if (host === "youtu.be") {
      result.videoId = pathname.split("/").filter(Boolean)[0] || "";
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (url.searchParams.get("v")) {
        result.videoId = url.searchParams.get("v") || "";
      }

      if (url.searchParams.get("list")) {
        result.playlistId = url.searchParams.get("list") || "";
      }

      const parts = pathname.split("/").filter(Boolean);

      if (parts[0] === "shorts" && parts[1]) {
        result.videoId = parts[1];
      }

      if (parts[0] === "embed" && parts[1]) {
        result.videoId = parts[1];
      }

      if (parts[0] === "channel" && parts[1]) {
        result.channelId = parts[1];
      }

      if (parts[0] === "c" && parts[1]) {
        result.handle = parts[1];
      }

      if (parts[0] === "user" && parts[1]) {
        result.handle = parts[1];
      }

      if (parts[0]?.startsWith("@")) {
        result.handle = parts[0];
      }
    }
  } catch {
    // Not a URL. Allow direct IDs as a convenience.
    if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) {
      result.channelId = raw;
    } else if (/^PL[a-zA-Z0-9_-]{10,}$/.test(raw) || /^UU[a-zA-Z0-9_-]{10,}$/.test(raw)) {
      result.playlistId = raw;
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
      result.videoId = raw;
    }
  }

  return result;
}

function getBestThumbnail(thumbnails = {}) {
  const candidates = [
    thumbnails.maxres,
    thumbnails.standard,
    thumbnails.high,
    thumbnails.medium,
    thumbnails.default,
  ];

  return toHttpsThumbnail(candidates.find(Boolean)?.url || "");
}

function normalizeYouTubeApiSearchItem(item = {}) {
  const id = item.id || {};
  const snippet = item.snippet || {};
  const kind = String(id.kind || item.kind || "").toLowerCase();

  const videoId = id.videoId || item.videoId || "";
  const channelId = id.channelId || snippet.channelId || item.channelId || "";
  const playlistId = id.playlistId || item.playlistId || "";

  let mediaType = "youtube";
  let providerId = videoId || channelId || playlistId || item.id || snippet.title;
  let providerUrl = "";

  if (videoId || kind.includes("video")) {
    mediaType = "video";
    providerUrl = videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : "";
  } else if (playlistId || kind.includes("playlist")) {
    mediaType = "playlist";
    providerUrl = playlistId ? `${YOUTUBE_PLAYLIST_BASE}${playlistId}` : "";
  } else if (channelId || kind.includes("channel")) {
    mediaType = "channel";
    providerUrl = channelId ? `${YOUTUBE_CHANNEL_BASE}${channelId}` : "";
  }

  const title = cleanText(snippet.title || item.title || "Untitled YouTube Item");

  return {
    id: providerId || title,
    providerId,
    provider: "youtube",
    mediaType,
    title,
    name: title,
    sortTitle: title,
    year: getYearFromDate(snippet.publishedAt || item.publishedAt),
    releaseDate: snippet.publishedAt || item.publishedAt || "",
    description: snippet.description || item.description || "",
    channelTitle: snippet.channelTitle || item.channelTitle || "",
    creator: snippet.channelTitle || item.creator || "",
    poster: getBestThumbnail(snippet.thumbnails || item.thumbnails || {}),
    thumbnail: getBestThumbnail(snippet.thumbnails || item.thumbnails || {}),
    backdrop: "",
    url: providerUrl,
    providerUrl,
    identifiers: {
      youtubeId: videoId || playlistId || channelId || null,
      videoId: videoId || null,
      channelId: channelId || null,
      playlistId: playlistId || null,
    },
    raw: item,
  };
}

function normalizeYouTubeApiVideo(item = {}) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const statistics = item.statistics || {};
  const videoId = item.id || item.videoId || "";
  const title = cleanText(snippet.title || item.title || "Untitled Video");

  return {
    id: videoId || title,
    providerId: videoId || null,
    provider: "youtube",
    mediaType: "video",
    title,
    name: title,
    sortTitle: title,
    year: getYearFromDate(snippet.publishedAt),
    releaseDate: snippet.publishedAt || "",
    description: snippet.description || "",
    channelTitle: snippet.channelTitle || "",
    creator: snippet.channelTitle || "",
    duration: contentDetails.duration || "",
    viewCount: statistics.viewCount || null,
    likeCount: statistics.likeCount || null,
    tags: normalizeArray(snippet.tags),
    poster: getBestThumbnail(snippet.thumbnails || {}),
    thumbnail: getBestThumbnail(snippet.thumbnails || {}),
    backdrop: "",
    url: videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : "",
    providerUrl: videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : "",
    identifiers: {
      youtubeId: videoId || null,
      videoId: videoId || null,
      channelId: snippet.channelId || null,
      playlistId: null,
    },
    raw: item,
  };
}

function normalizeYouTubeOEmbed(item = {}, sourceUrl = "") {
  const ids = parseYouTubeIds(sourceUrl);
  const title = cleanText(item.title || "Untitled YouTube Video");

  return {
    id: ids.videoId || ids.playlistId || sourceUrl || title,
    providerId: ids.videoId || ids.playlistId || null,
    provider: "youtube-oembed",
    mediaType: ids.playlistId && !ids.videoId ? "playlist" : "video",
    title,
    name: title,
    sortTitle: title,
    year: null,
    releaseDate: "",
    description: "",
    channelTitle: item.author_name || "",
    creator: item.author_name || "",
    poster: toHttpsThumbnail(item.thumbnail_url || ""),
    thumbnail: toHttpsThumbnail(item.thumbnail_url || ""),
    backdrop: "",
    url: sourceUrl,
    providerUrl: sourceUrl,
    identifiers: {
      youtubeId: ids.videoId || ids.playlistId || null,
      videoId: ids.videoId || null,
      channelId: ids.channelId || null,
      playlistId: ids.playlistId || null,
    },
    raw: item,
  };
}

function normalizeYtDlpInfo(info = {}, fallback = {}) {
  const videoId = info.id || info.youtubeId || fallback.videoId || "";
  const channelId = info.channel_id || info.channelId || fallback.channelId || "";
  const playlistId = info.playlist_id || info.playlistId || fallback.playlistId || "";
  const title = cleanText(info.title || fallback.title || "Untitled YouTube Video");
  const uploadDate = info.upload_date
    ? `${String(info.upload_date).slice(0, 4)}-${String(info.upload_date).slice(4, 6)}-${String(info.upload_date).slice(6, 8)}`
    : info.releaseDate || info.publishedAt || "";

  const thumbnail =
    info.thumbnail ||
    normalizeArray(info.thumbnails).slice(-1)[0]?.url ||
    fallback.thumbnail ||
    fallback.poster ||
    "";

  return {
    id: videoId || fallback.id || title,
    providerId: videoId || fallback.providerId || null,
    provider: "yt-dlp-local",
    mediaType: "video",
    title,
    name: title,
    sortTitle: title,
    year: getYearFromDate(uploadDate),
    releaseDate: uploadDate,
    description: info.description || fallback.description || "",
    channelTitle: info.channel || info.uploader || info.channelTitle || fallback.channelTitle || "",
    creator: info.channel || info.uploader || info.creator || fallback.creator || "",
    duration: info.duration || fallback.duration || null,
    viewCount: info.view_count || fallback.viewCount || null,
    likeCount: info.like_count || fallback.likeCount || null,
    tags: normalizeArray(info.tags || fallback.tags),
    poster: toHttpsThumbnail(thumbnail),
    thumbnail: toHttpsThumbnail(thumbnail),
    backdrop: fallback.backdrop || "",
    url: info.webpage_url || info.original_url || (videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : fallback.url || ""),
    providerUrl: info.webpage_url || info.original_url || (videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : fallback.providerUrl || ""),
    identifiers: {
      youtubeId: videoId || playlistId || channelId || null,
      videoId: videoId || null,
      channelId: channelId || null,
      playlistId: playlistId || null,
    },
    raw: info,
  };
}

function normalizeTubeArchivistItem(item = {}) {
  const videoId = item.youtube_id || item.videoId || item.id || "";
  const channelId = item.channel?.channel_id || item.channel_id || item.channelId || "";
  const title = cleanText(item.title || item.name || "Untitled YouTube Video");
  const channelTitle = item.channel?.channel_name || item.channel_name || item.channelTitle || "";

  return {
    id: videoId || item.id || title,
    providerId: videoId || item.id || null,
    provider: "tubearchivist",
    mediaType: "video",
    title,
    name: title,
    sortTitle: title,
    year: getYearFromDate(item.published || item.upload_date || item.publishedAt),
    releaseDate: item.published || item.upload_date || item.publishedAt || "",
    description: item.description || "",
    channelTitle,
    creator: channelTitle,
    duration: item.player?.duration || item.duration || null,
    viewCount: item.stats?.view_count || item.view_count || null,
    likeCount: item.stats?.like_count || item.like_count || null,
    tags: normalizeArray(item.tags),
    poster: item.vid_thumb_url || item.thumbnail || item.poster || "",
    thumbnail: item.vid_thumb_url || item.thumbnail || item.poster || "",
    backdrop: "",
    url: videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : "",
    providerUrl: videoId ? `${YOUTUBE_WATCH_BASE}${videoId}` : "",
    identifiers: {
      youtubeId: videoId || null,
      videoId: videoId || null,
      channelId: channelId || null,
      playlistId: item.playlist_id || null,
    },
    raw: item,
  };
}

function createManualYouTubeCandidate(query = "", options = {}) {
  const ids = parseYouTubeIds(query);
  const title = cleanText(options.title || query || "Untitled YouTube Item");
  const mediaType = ids.channelId || ids.handle ? "channel" : ids.playlistId && !ids.videoId ? "playlist" : ids.videoId ? "video" : options.type || "youtube";
  const providerId = ids.videoId || ids.playlistId || ids.channelId || ids.handle || title;

  let providerUrl = ids.original && ids.isUrl ? ids.original : "";
  if (!providerUrl && ids.videoId) providerUrl = `${YOUTUBE_WATCH_BASE}${ids.videoId}`;
  if (!providerUrl && ids.playlistId) providerUrl = `${YOUTUBE_PLAYLIST_BASE}${ids.playlistId}`;
  if (!providerUrl && ids.channelId) providerUrl = `${YOUTUBE_CHANNEL_BASE}${ids.channelId}`;

  return {
    id: providerId,
    providerId,
    provider: "manual",
    mediaType,
    title,
    name: title,
    sortTitle: title,
    year: null,
    releaseDate: "",
    description: "Manual/local YouTube metadata candidate. Add a YouTube API key or TubeArchivist integration for live provider search.",
    channelTitle: "",
    creator: "",
    poster: "",
    thumbnail: "",
    backdrop: "",
    url: providerUrl,
    providerUrl,
    identifiers: {
      youtubeId: ids.videoId || ids.playlistId || ids.channelId || null,
      videoId: ids.videoId || null,
      channelId: ids.channelId || null,
      playlistId: ids.playlistId || null,
      handle: ids.handle || null,
    },
    raw: { query, options },
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "Homestead/1.0 (youtube-metadata-fetch; self-hosted)",
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || data?.message || `Provider returned ${response.status}`);
  }

  return data;
}

async function searchYouTubeApi(query, options = {}) {
  const apiKey = getYouTubeApiKey(options);
  if (!apiKey) {
    throw new Error("Missing YouTube API key");
  }

  const limit = Math.min(Number(options.limit || 12), 25);
  const type = String(options.type || "video,channel,playlist").trim();
  const encodedQuery = strictEncodeQuery(query);
  const url =
    "https://www.googleapis.com/youtube/v3/search" +
    `?part=snippet&type=${strictEncodeQuery(type)}&maxResults=${limit}&q=${encodedQuery}&key=${strictEncodeQuery(apiKey)}`;

  const data = await fetchJson(url);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(normalizeYouTubeApiSearchItem);
}

async function fetchYouTubeVideoById(videoId, options = {}) {
  const apiKey = getYouTubeApiKey(options);
  if (!apiKey) {
    throw new Error("Missing YouTube API key");
  }

  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=snippet,contentDetails,statistics&id=${strictEncodeQuery(videoId)}&key=${strictEncodeQuery(apiKey)}`;
  const data = await fetchJson(url);
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  return item ? normalizeYouTubeApiVideo(item) : null;
}

async function fetchYouTubeOEmbed(urlOrId) {
  const ids = parseYouTubeIds(urlOrId);
  const sourceUrl = ids.isUrl ? ids.original : ids.videoId ? `${YOUTUBE_WATCH_BASE}${ids.videoId}` : ids.playlistId ? `${YOUTUBE_PLAYLIST_BASE}${ids.playlistId}` : "";

  if (!sourceUrl) {
    throw new Error("YouTube oEmbed requires a video or playlist URL");
  }

  const url = `https://www.youtube.com/oembed?url=${strictEncodeQuery(sourceUrl)}&format=json`;
  const data = await fetchJson(url);
  return normalizeYouTubeOEmbed(data, sourceUrl);
}

async function searchTubeArchivist(query, options = {}) {
  const { baseUrl, apiKey } = getTubeArchivistConfig(options);
  if (!baseUrl || !apiKey) {
    throw new Error("Missing TubeArchivist URL or API key");
  }

  const limit = Number(options.limit || 12);
  const encodedQuery = strictEncodeQuery(query);

  // TubeArchivist versions have used more than one search shape. Try the current/common endpoint first.
  const candidateUrls = [
    `${baseUrl}/api/search/?query=${encodedQuery}`,
    `${baseUrl}/api/search/?search=${encodedQuery}`,
  ];

  let lastError = null;

  for (const url of candidateUrls) {
    try {
      const data = await fetchJson(url, {
        headers: {
          Authorization: `Token ${apiKey}`,
        },
      });

      const rawResults =
        data?.results ||
        data?.data ||
        data?.hits ||
        data?.response ||
        [];

      const results = Array.isArray(rawResults)
        ? rawResults.map((item) => normalizeTubeArchivistItem(item.source || item)).slice(0, limit)
        : [];

      return results;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("TubeArchivist search failed");
}

async function searchYouTubeMetadata(query, options = {}) {
  const provider = String(options.provider || "auto").toLowerCase();
  const limit = Number(options.limit || 12);

  if (!query || !String(query).trim()) {
    throw new Error("Missing YouTube metadata search query");
  }

  const ids = parseYouTubeIds(query);

  if (provider === "youtube" || provider === "youtube-api") {
    return searchYouTubeApi(query, { ...options, limit });
  }

  if (provider === "tubearchivist") {
    return searchTubeArchivist(query, { ...options, limit });
  }

  if (provider === "oembed") {
    return [await fetchYouTubeOEmbed(query)];
  }

  if (provider === "manual" || provider === "local") {
    return [createManualYouTubeCandidate(query, options)];
  }

  // Auto mode:
  // 1) Direct video ID/URL with API key gets full metadata.
  // 2) Direct URL without API key gets oEmbed metadata.
  // 3) TubeArchivist search if configured.
  // 4) YouTube API search if configured.
  // 5) Manual fallback so Fix Match UI has a selectable candidate.
  const attempts = [];

  if (ids.videoId && getYouTubeApiKey(options)) {
    attempts.push(async () => {
      const video = await fetchYouTubeVideoById(ids.videoId, options);
      return video ? [video] : [];
    });
  }

  if (ids.isUrl && (ids.videoId || ids.playlistId)) {
    attempts.push(async () => [await fetchYouTubeOEmbed(query)]);
  }

  if (getTubeArchivistConfig(options).baseUrl && getTubeArchivistConfig(options).apiKey) {
    attempts.push(async () => searchTubeArchivist(query, { ...options, limit }));
  }

  if (getYouTubeApiKey(options)) {
    attempts.push(async () => searchYouTubeApi(query, { ...options, limit }));
  }

  for (const attempt of attempts) {
    try {
      const results = await attempt();
      if (Array.isArray(results) && results.length) return results.slice(0, limit);
    } catch {
      // Fall through to the next provider.
    }
  }

  return [createManualYouTubeCandidate(query, options)];
}

module.exports = {
  searchYouTubeMetadata,
  searchYouTubeApi,
  searchTubeArchivist,
  fetchYouTubeOEmbed,
  fetchYouTubeVideoById,
  parseYouTubeIds,
  normalizeYouTubeApiSearchItem,
  normalizeYouTubeApiVideo,
  normalizeYouTubeOEmbed,
  normalizeYtDlpInfo,
  normalizeTubeArchivistItem,
  createManualYouTubeCandidate,
};
