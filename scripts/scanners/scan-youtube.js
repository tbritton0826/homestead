import fs from "fs";
import path from "path";

const PROJECT_ROOT = process.cwd();
const MEDIA_ROOT = process.env.MEDIA_ROOT || "/media";
const YOUTUBE_CREATORS_ROOT = path.join(MEDIA_ROOT, "youtube", "creators");
const DATA_ROOT = path.join(PROJECT_ROOT, "data");
const OUTPUT_FILE = path.join(DATA_ROOT, "youtube-index.json");

const VIDEO_EXTS = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const LOCAL_METADATA_NAMES = ["metadata.json", "info.json", "channel.json", "playlist.json"];

function ensureFolder(folderPath) {
  fs.mkdirSync(folderPath, { recursive: true });
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`Failed to read JSON: ${filePath}`, error.message);
    return null;
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  });
}

function cleanTitle(filename = "") {
  return String(filename)
    .replace(/\.(mp4|mkv|mov|avi|webm|m4v)$/i, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";
}

function toPublicMediaPath(filePath) {
  const relativeToMedia = path.relative(MEDIA_ROOT, filePath);
  return `/media/${relativeToMedia.replaceAll("\\", "/")}`;
}

function findFirstExisting(baseDir, names) {
  return names
    .map((name) => path.join(baseDir, name))
    .find((filePath) => fs.existsSync(filePath));
}

function findFirstByExtensions(basePathNoExt, suffixes = [""], extensions = IMAGE_EXTS) {
  for (const suffix of suffixes) {
    for (const ext of extensions) {
      const candidate = `${basePathNoExt}${suffix}${ext}`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findLocalMetadataFile(dir) {
  const named = findFirstExisting(dir, LOCAL_METADATA_NAMES);
  if (named) return named;

  const localJson = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .find((name) => /\.(info|metadata|channel|playlist)\.json$/i.test(name));

  return localJson ? path.join(dir, localJson) : null;
}

function findVideoMetadataFile(videoFilePath) {
  const base = videoFilePath.replace(path.extname(videoFilePath), "");
  const candidates = [
    `${base}.info.json`,
    `${base}.metadata.json`,
    `${base}.json`,
    path.join(path.dirname(videoFilePath), "metadata.json"),
    path.join(path.dirname(videoFilePath), "info.json"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function normalizeDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  return raw;
}

function getYearFromDate(value = "") {
  const year = String(value || "").slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function getBestThumbnailFromInfo(info = {}) {
  if (info.thumbnail) return info.thumbnail;

  const thumbnails = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const best = [...thumbnails]
    .filter((thumb) => thumb?.url)
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];

  return best?.url || "";
}

function getYoutubeIdFromInfo(info = {}) {
  return info.id || info.video_id || info.youtubeId || info.webpage_url_basename || "";
}

function detectSeriesAndSeason(filePath, creatorId) {
  const creatorRoot = path.join(YOUTUBE_CREATORS_ROOT, creatorId);
  const relative = path.relative(creatorRoot, filePath);
  const parts = relative.split(path.sep).filter(Boolean);

  let series = "uploads";
  let season = "season-1";

  if (parts.length >= 2) {
    series = parts[0];
  }

  for (const part of parts) {
    const lower = part.toLowerCase();
    const seasonMatch = lower.match(/season[\s_-]?(\d+)/i) || lower.match(/^s(\d{1,2})$/i);

    if (seasonMatch) {
      season = `season-${Number(seasonMatch[1])}`;
    }
  }

  return { series: slugify(series), season };
}

function findThumbnail(filePath, videoInfo = {}) {
  const localFromInfo = videoInfo.thumbnail;
  if (localFromInfo && fs.existsSync(localFromInfo)) return localFromInfo;

  const base = filePath.replace(path.extname(filePath), "");
  return findFirstByExtensions(base, ["-thumb", ".thumb", "", "-thumbnail", ".thumbnail"], IMAGE_EXTS);
}

function parseVideo(filePath, creatorId) {
  const { series, season } = detectSeriesAndSeason(filePath, creatorId);
  const metadataFile = findVideoMetadataFile(filePath);
  const info = readJson(metadataFile) || {};
  const localThumb = findThumbnail(filePath, info);
  const uploadedAt = normalizeDate(info.upload_date || info.release_date || info.timestamp || info.publishedAt || "");
  const youtubeId = getYoutubeIdFromInfo(info);
  const title = info.title || cleanTitle(path.basename(filePath));

  return {
    id: youtubeId || slugify(`${creatorId}-${series}-${path.basename(filePath)}`),
    title,
    creatorId,
    creatorName: info.channel || info.uploader || info.channel_title || creatorId,
    series,
    season,
    path: toPublicMediaPath(filePath),
    thumb: localThumb ? toPublicMediaPath(localThumb) : getBestThumbnailFromInfo(info),
    thumbnail: localThumb ? toPublicMediaPath(localThumb) : getBestThumbnailFromInfo(info),
    filename: path.basename(filePath),
    description: info.description || "",
    duration: info.duration || null,
    uploadedAt,
    year: getYearFromDate(uploadedAt),
    youtubeId,
    url: info.webpage_url || info.original_url || (youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : ""),
    metadataFile: metadataFile ? toPublicMediaPath(metadataFile) : "",
    metadata: info,
  };
}

function createEmptyIndex() {
  return {
    scannedAt: new Date().toISOString(),
    sourceRoot: YOUTUBE_CREATORS_ROOT,
    creators: {},
    series: {},
    collections: {},
  };
}

function readCreatorMetadata(creatorDir, creatorId) {
  const metadataFile = findLocalMetadataFile(creatorDir);
  const metadata = readJson(metadataFile) || {};

  return {
    id: creatorId,
    name:
      metadata.name ||
      metadata.channel ||
      metadata.uploader ||
      metadata.channelTitle ||
      metadata.title ||
      creatorId,
    description: metadata.description || metadata.channel_description || "",
    channelId: metadata.channel_id || metadata.channelId || metadata.youtubeChannelId || "",
    youtubeUrl:
      metadata.youtubeUrl ||
      metadata.channel_url ||
      metadata.uploader_url ||
      (metadata.channel_id ? `https://www.youtube.com/channel/${metadata.channel_id}` : ""),
    metadataFile: metadataFile ? toPublicMediaPath(metadataFile) : "",
    ...metadata,
  };
}

function addCreator(index, creatorId, metadata, videos) {
  const creatorDir = path.join(YOUTUBE_CREATORS_ROOT, creatorId);

  const posterFile = findFirstExisting(creatorDir, [
    "poster.jpg", "poster.jpeg", "poster.png", "poster.webp",
    "folder.jpg", "folder.jpeg", "folder.png", "folder.webp",
    "cover.jpg", "cover.jpeg", "cover.png", "cover.webp",
    "avatar.jpg", "avatar.jpeg", "avatar.png", "avatar.webp",
    "channel.jpg", "channel.jpeg", "channel.png", "channel.webp",
  ]);

  const bannerFile = findFirstExisting(creatorDir, [
    "banner.jpg", "banner.jpeg", "banner.png", "banner.webp",
    "backdrop.jpg", "backdrop.jpeg", "backdrop.png", "backdrop.webp",
    "fanart.jpg", "fanart.jpeg", "fanart.png", "fanart.webp",
    "landscape.jpg", "landscape.jpeg", "landscape.png", "landscape.webp",
  ]);

  index.creators[creatorId] = {
    id: creatorId,
    name: metadata.name || creatorId,
    description: metadata.description || "",
    poster: posterFile ? toPublicMediaPath(posterFile) : metadata.thumbnail || metadata.poster || null,
    banner: bannerFile ? toPublicMediaPath(bannerFile) : metadata.banner || metadata.backdrop || null,
    channelId: metadata.channelId || metadata.channel_id || "",
    youtubeUrl: metadata.youtubeUrl || metadata.channel_url || "",
    metadata,
    videos,
    videoCount: videos.length,
  };
}

function addVideoToSeries(index, video) {
  if (!index.series[video.series]) {
    index.series[video.series] = {
      id: video.series,
      title: video.series.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      poster: video.thumbnail || null,
      banner: null,
      seasons: {},
    };
  }

  if (!index.series[video.series].seasons[video.season]) {
    index.series[video.series].seasons[video.season] = {
      id: video.season,
      videos: [],
    };
  }

  index.series[video.series].seasons[video.season].videos.push(video);
}

function naturalSortVideos(videos = []) {
  return videos.sort((a, b) =>
    String(a.title || a.filename).localeCompare(String(b.title || b.filename), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function scanYouTube() {
  ensureFolder(DATA_ROOT);
  ensureFolder(YOUTUBE_CREATORS_ROOT);

  const index = createEmptyIndex();

  const creatorIds = fs
    .readdirSync(YOUTUBE_CREATORS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  for (const creatorId of creatorIds) {
    const creatorDir = path.join(YOUTUBE_CREATORS_ROOT, creatorId);
    const metadata = readCreatorMetadata(creatorDir, creatorId);
    const files = walk(creatorDir);

    const videos = naturalSortVideos(
      files
        .filter((file) => VIDEO_EXTS.includes(path.extname(file).toLowerCase()))
        .map((file) => parseVideo(file, creatorId))
    );

    addCreator(index, creatorId, metadata, videos);

    for (const video of videos) {
      addVideoToSeries(index, video);
    }
  }

  for (const series of Object.values(index.series)) {
    for (const season of Object.values(series.seasons)) {
      season.videos = naturalSortVideos(season.videos);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index, null, 2));

  console.log(`Saved ${OUTPUT_FILE}`);
  console.log(`Creators: ${Object.keys(index.creators).length}`);
  console.log(`Series: ${Object.keys(index.series).length}`);
}

scanYouTube();
