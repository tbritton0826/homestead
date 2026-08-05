const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const projectRoot = path.join(__dirname, "..", "..");
const dataRoot = path.join(projectRoot, "data");
const setupConfigPath = path.join(dataRoot, "setup-config.json");
const mediaIndexPath = path.join(dataRoot, "media-index.json");
const youtubeIndexPath = path.join(dataRoot, "youtube-index.json");

const ADULT_SCAN_LIBRARIES = [
  "personal",
  "performers",
  "celebrities",
  "adultPhotos",
  "adultVideos",
];

const libraryIdAliasesForCli = {
  movie: "movies",
  movies: "movies",
  tvshow: "tv",
  tvshows: "tv",
  show: "tv",
  shows: "tv",
  tv: "tv",
  book: "books",
  books: "books",
  audiobook: "audiobooks",
  audiobooks: "audiobooks",
  music: "music",
  youtube: "youtube",
  yt: "youtube",
  photo: "photos",
  photos: "photos",
  family: "family",
  pets: "pets",
  inventory: "inventory",
  ai: "ai",
  cloud: "cloud",
  personal: "personal",
  performers: "performers",
  performer: "performers",
  celebrities: "celebrities",
  celebrity: "celebrities",
  adultphotos: "adultPhotos",
  "adult-photos": "adultPhotos",
  adultvideos: "adultVideos",
  "adult-videos": "adultVideos",
  adult: "adult",
  all: "all",
};

function splitCliList(value = "") {
  return String(value)
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getCliValues(names = []) {
  const values = [];
  const args = process.argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    for (const name of names) {
      if (arg === name && args[index + 1]) {
        values.push(...splitCliList(args[index + 1]));
      }

      if (arg.startsWith(`${name}=`)) {
        values.push(...splitCliList(arg.slice(name.length + 1)));
      }
    }
  }

  return values;
}

function hasCliFlag(names = []) {
  const args = process.argv.slice(2);
  return names.some((name) => args.includes(name));
}

function normalizeCliLibraryId(value = "") {
  const key = String(value || "")
    .trim()
    .replace(/^scan:/i, "")
    .replace(/[_\s]+/g, "-");

  const lookupKey = key.toLowerCase();
  return libraryIdAliasesForCli[lookupKey] || key;
}

function expandCliLibraries(values = []) {
  if (!values.length || hasCliFlag(["--all"])) {
    return [...libraryRoots];
  }

  const expanded = [];

  for (const value of values) {
    const normalized = normalizeCliLibraryId(value);

    if (normalized === "all") {
      expanded.push(...libraryRoots);
      continue;
    }

    if (normalized === "adult") {
      expanded.push(...ADULT_SCAN_LIBRARIES);
      continue;
    }

    expanded.push(normalized);
  }

  return Array.from(new Set(expanded)).filter((libraryId) => {
    if (libraryRoots.includes(libraryId)) return true;
    console.warn(`Unknown library requested, skipping: ${libraryId}`);
    return false;
  });
}

function getCliOptions() {
  const requestedLibraries = getCliValues(["--library", "--libraries", "-l"]);
  const requestedFolders = getCliValues(["--folder", "--folders", "-f"]);
  const targetLibraries = expandCliLibraries(requestedLibraries);

  return {
    requestedLibraries,
    requestedFolders,
    targetLibraries,
    isFullScan:
      !requestedLibraries.length &&
      !requestedFolders.length &&
      !hasCliFlag(["--library", "--libraries", "-l"]),
  };
}



function readSetupConfig() {
  if (!fs.existsSync(setupConfigPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(setupConfigPath, "utf8"));
  } catch {
    return {};
  }
}

function normalizeFolders(value, fallback) {
  const raw = value ?? fallback;

  if (Array.isArray(raw)) {
    return raw.filter(Boolean);
  }

  if (typeof raw === "string" && raw.trim()) {
    return [raw];
  }

  return [];
}

const setupConfig = readSetupConfig();

console.log("FOLDER MAPPINGS", setupConfig.folderMappings);

const mediaRoot =
  process.env.MEDIA_ROOT ||
  setupConfig.mediaRoot ||
  "/media";

const libraryPathAliases = {
  tv: ["tv", "tvshows"],
  tvshows: ["tvshows", "tv"],
  liveTV: ["liveTV", "livetv"],

  personal: ["personal", "personalProfiles"],
  performers: ["performers", "pornStars"],
  celebrities: ["celebrities"],
  adultPhotos: ["adultPhotos", "adult-photos", "photos"],
  adultVideos: ["adultVideos", "adult-videos", "videos"],
};

function normalizeMappedFolders(mapped) {
  if (!mapped) return null;

  if (Array.isArray(mapped)) {
    return mapped.filter(Boolean);
  }

  if (typeof mapped === "string") {
    return [mapped];
  }

  if (Array.isArray(mapped.paths)) {
    return mapped.paths.filter(Boolean);
  }

  if (Array.isArray(mapped.folders)) {
    return mapped.folders.filter(Boolean);
  }

  if (typeof mapped.path === "string") {
    return [mapped.path];
  }

  if (typeof mapped.folder === "string") {
    return [mapped.folder];
  }

  return null;
}

function getLibraryMapping(libraryId) {
  const adultSubLibraries = [
    "personal",
    "performers",
    "celebrities",
    "adultPhotos",
    "adultVideos",
  ];

  if (adultSubLibraries.includes(libraryId)) {
    const aliases = libraryPathAliases[libraryId] || [libraryId];

    for (const key of aliases) {
      const folders = normalizeMappedFolders(setupConfig.folderMappings?.[key]);

      if (folders?.length) {
        return folders;
      }
    }

    const adultBase =
      normalizeMappedFolders(setupConfig.folderMappings?.adult) ||
      [path.join(mediaRoot, "adult")];

    return adultBase.map((basePath) => {
      if (libraryId === "adultPhotos") return path.join(basePath, "photos");
      if (libraryId === "adultVideos") return path.join(basePath, "videos");
      return path.join(basePath, libraryId);
    });
  }

  const aliases = libraryPathAliases[libraryId] || [libraryId];

  for (const key of aliases) {
    const folders = normalizeMappedFolders(setupConfig.folderMappings?.[key]);

    if (folders?.length) {
      return folders;
    }
  }

  return [path.join(mediaRoot, libraryId)];
}

function getLibraryDir(libraryId) {
  return getLibraryMapping(libraryId);
}

function getLibraryDirs(libraryId) {
  return []
    .concat(getLibraryDir(libraryId) || [])
    .filter(Boolean);
}

const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];
const videoExts = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"];
const audioExts = [".mp3", ".m4a", ".flac", ".wav", ".aac", ".ogg"];
const musicVideoExts = [".mp4", ".mkv", ".webm", ".mov"];
const ebookExts = [".epub", ".pdf", ".mobi", ".azw3"];
const audiobookExts = [".mp3", ".m4b", ".m4a", ".aac"];
const docExts = [".pdf", ".txt", ".md", ".json", ".doc", ".docx"];

const libraryRoots = [
  "personal",
  "performers",
  "celebrities",
  "adultPhotos",
  "adultVideos",
  "family",
  "pets",
  "movies",
  "tv",
  "music",
  "youtube",
  "photos",
  "books",
  "audiobooks",
  "ai",
  "inventory",
  "cloud",
];

const librarySettings = {
  books: {
    scanMode: "auto", 
    // options: "auto", "author-book", "author-series-book"
  },
  music: {
    scanMode: "auto",
    // options: "auto", "artist-song", "artist-album-song"
  },
};

function ensureDir(dir) {
  if (!exists(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function splitRelativeParts(libraryId, fullPath) {
  const libraryDir = getLibraryDirs(libraryId)[0];

  return path
    .relative(libraryDir, fullPath)
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
}

function stripExt(filename) {
  return path.basename(filename, path.extname(filename));
}

function getBookFolderInfo(fullPath) {
  const parts = splitRelativeParts("books", fullPath);

  const formatFolders = [
    "ebook",
    "ebooks",
    "audiobook",
    "audiobooks",
  ];

  const formatIndex = parts.findIndex((part) =>
    formatFolders.includes(part.toLowerCase())
  );

if (formatIndex !== -1) {
  return {
    author: parts[0] || "Unknown Author",
    series: null,
    title:
      parts[formatIndex - 1] ||
      stripExt(parts.at(-1) || "Unknown Book"),
    format: parts[formatIndex],
  };
}

  const mode = librarySettings.books.scanMode;

  if (mode === "author-book") {
    return {
      author: parts[0] || "Unknown Author",
      series: null,
      title: parts[1] || "Unknown Book",
    };
  }

  if (mode === "author-series-book") {
    return {
      author: parts[0] || "Unknown Author",
      series: parts[1] || null,
      title: parts[2] || "Unknown Book",
    };
  }

  if (parts.length >= 4) {
    return {
      author: parts[0],
      series: parts[1],
      title: parts[2],
    };
  }

  return {
    author: parts[0] || "Unknown Author",
    series: null,
    title: parts[1] || "Unknown Book",
  };
}

function findBookArtwork(bookFiles) {
  const imageFiles = bookFiles.filter((file) => file.type === "image");

  const poster =
    imageFiles.find((file) => /poster/i.test(file.name)) ||
    imageFiles.find((file) => /cover/i.test(file.name)) ||
    imageFiles.find((file) => /folder/i.test(file.name)) ||
    imageFiles[0];

  return poster?.path || null;
}

function findBookBanner(bookFiles) {
  const imageFiles = bookFiles.filter((file) => file.type === "image");

  const banner =
    imageFiles.find((file) => /banner/i.test(file.name)) ||
    imageFiles.find((file) => /backdrop/i.test(file.name)) ||
    imageFiles.find((file) => /fanart/i.test(file.name));

  return banner?.path || null;
}

function getMusicFileInfo(fullPath) {
  const parts = splitRelativeParts("music", fullPath);
  const mode = librarySettings.music.scanMode;

  // /music/Artist/Song.mp3
  if (mode === "artist-song") {
    return {
      artist: parts[0] || "Unknown Artist",
      album: null,
      title: stripExt(parts[1] || parts.at(-1) || "Unknown Song"),
    };
  }

  // /music/Artist/Album/Song.mp3
  if (mode === "artist-album-song") {
    return {
      artist: parts[0] || "Unknown Artist",
      album: parts[1] || null,
      title: stripExt(parts[2] || parts.at(-1) || "Unknown Song"),
    };
  }

  // auto
  if (parts.length >= 3) {
    return {
      artist: parts[0],
      album: parts[1],
      title: stripExt(parts[2]),
    };
  }

  return {
    artist: parts[0] || "Unknown Artist",
    album: null,
    title: stripExt(parts[1] || parts.at(-1) || "Unknown Song"),
  };
}

function getThumbnailPath(fullPath) {
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath, path.extname(fullPath));
  return path.join(dir, "_thumbs", `${base}.webp`);
}

async function generateThumbnail(fullPath, ext) {
  // V1: skip HEIC/HEIF thumbnail generation.
  // Some Sharp/libvips builds cannot decode iPhone HEIC compression.
  return null;
}

function getThumbnailPath(fullPath) {
  const dir = path.dirname(fullPath);
  const base = path.basename(fullPath, path.extname(fullPath));
  return path.join(dir, "_thumbs", `${base}.webp`);
}

async function walkFiles(dir) {
  if (!exists(dir)) return [];

  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "_thumbs") continue;
      results.push(...await walkFiles(fullPath));
      continue;
    }

    const libraryId = path.relative(mediaRoot, fullPath).split(path.sep)[0];

      let parsed = null;
      
      if (libraryId === "books") {
        parsed = getBookFolderInfo(fullPath);
}

    const ext = path.extname(entry.name).toLowerCase();
    const stat = fs.statSync(fullPath);
    const thumbnail = await generateThumbnail(fullPath, ext);

results.push({
  name: entry.name,

  // browser/public path
  path: toPublicPath(fullPath),

  // real filesystem path
  sourcePath: fullPath,
      ext,
      type: getType(ext),
      thumbnail,
      parsed,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  return results;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function toPublicPath(fullPath) {
  const normalizedFullPath = fullPath.replaceAll("\\", "/");
  const normalizedMediaRoot = mediaRoot.replaceAll("\\", "/");

  if (normalizedFullPath.startsWith(normalizedMediaRoot)) {
    return "/media/" + path.relative(mediaRoot, fullPath).replaceAll("\\", "/");
  }

for (const libraryId of libraryRoots) {
  const libraryDirs = getLibraryDirs(libraryId);

  for (const libraryDir of libraryDirs) {
    const normalizedLibraryDir = String(libraryDir).replaceAll("\\", "/");

    if (normalizedFullPath.startsWith(normalizedLibraryDir)) {
      return (
        `/media/${libraryId}/` +
        path.relative(libraryDir, fullPath).replaceAll("\\", "/")
      );
    }
  }
}

  return normalizedFullPath;
}

function getType(ext) {
  if (imageExts.includes(ext)) return "image";
  if (videoExts.includes(ext)) return "video";
  if (ebookExts.includes(ext)) return "ebook";
  if (audiobookExts.includes(ext)) return "audiobook";
  if (audioExts.includes(ext)) return "audio";
  if (musicVideoExts.includes(ext)) return "musicvideo";
  if (docExts.includes(ext)) return "document";
  return "file";
}

function isImageFile(fileName) {
  return getType(path.extname(fileName).toLowerCase()) === "image";
}

function isVideoFile(fileName) {
  return getType(path.extname(fileName).toLowerCase()) === "video";
}

function readJsonIfExists(filePath) {
  if (!exists(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn("Invalid JSON:", filePath);
    return null;
  }
}

function normalizeLibraryItemKey(libraryId, value) {
  const raw = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/\(\s*\d{4}\s*\)/g, "")
    .replace(/\[\s*\d{4}\s*\]/g, "")
    .replace(/\b(1080p|720p|2160p|4k|uhd|hdr|dv|bluray|web[- .]?dl|webrip|brrip|x264|x265|h264|h265)\b/gi, "")
    .trim();

  return raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || String(value || "unknown").toLowerCase();
}

function uniqueByPath(files = []) {
  const seen = new Set();
  const out = [];

  for (const file of files.filter(Boolean)) {
    const key = file.sourcePath || file.path || file.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }

  return out;
}

function mergeCounts(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const merged = {};

  for (const key of keys) {
    merged[key] = (Number(a?.[key]) || 0) + (Number(b?.[key]) || 0);
  }

  return merged;
}

function preferValue(existing, incoming) {
  return existing ?? incoming ?? null;
}

function mergeScannedEntities(existing, incoming) {
  if (!existing) {
    return {
      ...incoming,
      sourcePaths: uniqueByPath([
        ...(incoming.sourcePaths || []).map((sourcePath) => ({ sourcePath })),
        incoming.sourcePath ? { sourcePath: incoming.sourcePath } : null,
      ]).map((item) => item.sourcePath),
      mergedFrom: incoming.sourcePath ? [incoming.sourcePath] : [],
    };
  }

  const files = uniqueByPath([...(existing.files || []), ...(incoming.files || [])]);
  const sourcePaths = Array.from(
    new Set([
      ...(existing.sourcePaths || []),
      ...(incoming.sourcePaths || []),
      existing.sourcePath,
      incoming.sourcePath,
    ].filter(Boolean))
  );

  return {
    ...existing,
    ...incoming,
    name: existing.name || incoming.name,
    title: existing.title || incoming.title,
    metadata: {
      ...(incoming.metadata || {}),
      ...(existing.metadata || {}),
    },
    relationships: {
      ...(incoming.relationships || {}),
      ...(existing.relationships || {}),
    },
    status: existing.status || incoming.status || null,
    poster: preferValue(existing.poster, incoming.poster),
    banner: preferValue(existing.banner, incoming.banner),
    trailer: preferValue(existing.trailer, incoming.trailer),
    theme: preferValue(existing.theme, incoming.theme),
    logo: preferValue(existing.logo, incoming.logo),
    bio: preferValue(existing.bio, incoming.bio),
    timeline: preferValue(existing.timeline, incoming.timeline),
    files,
    counts: mergeCounts(existing.counts, incoming.counts),
    itemCount:
      (Number(existing.itemCount) || Number(existing.counts?.total) || 0) +
      (Number(incoming.itemCount) || Number(incoming.counts?.total) || 0),
    sourcePath: existing.sourcePath || incoming.sourcePath || null,
    sourcePaths,
    mergedFrom: sourcePaths,
  };
}

async function scanEntityFolder(libraryId, entityId, entityDir) {
  const metadataPath = path.join(entityDir, "metadata.json");
  const bioPath = path.join(entityDir, "bio.md");
  const timelinePath = path.join(entityDir, "timeline.json");

  const metadataFile = readJsonIfExists(metadataPath) || {};

const metadata = {
  ...(metadataFile.metadata || {}),
};

const relationships = metadataFile.relationships || {};
const status = metadataFile.status || metadata.relationshipStatus || null;

  const posterCandidates = [
    "poster.jpg",
    "poster.jpeg",
    "poster.png",
    "poster.webp",

    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "folder.webp",

    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",

    "poster.heic",
    "poster.heif",
  ];

  const bannerCandidates = [
    "banner.jpg",
    "banner.jpeg",
    "banner.png",
    "banner.webp",
    "backdrop.jpg",
    "backdrop.jpeg",
    "backdrop.png",
    "backdrop.webp",
    "fanart.jpg",
    "fanart.jpeg",
    "fanart.png",
    "fanart.webp",
    "banner.heic",
    "banner.heif",
  ];

  const trailerCandidates = [
    "trailer.mp4",
    "trailer.webm",
    "trailer.mkv",
    "theme.mp4",
  ];

  const themeCandidates = [
    "theme.mp3",
    "theme.flac",
    "theme.m4a",
    "theme.ogg",
  ];

  const logoCandidates = [
    "logo.png",
    "logo.webp",
    "clearlogo.png",
    "clearlogo.webp",
  ];

  const posterFile = posterCandidates.find((file) =>
    exists(path.join(entityDir, file))
  );

  const bannerFile = bannerCandidates.find((file) =>
    exists(path.join(entityDir, file))
  );

  const trailerFile = trailerCandidates.find((file) =>
    exists(path.join(entityDir, file))
  );

  const themeFile = themeCandidates.find((file) =>
    exists(path.join(entityDir, file))
  );

  const logoFile = logoCandidates.find((file) =>
    exists(path.join(entityDir, file))
  );

  const allFiles = (await walkFiles(entityDir)).filter((file) => {
    const lower = file.name.toLowerCase();

    return ![
      "metadata.json",
      "timeline.json",
      "bio.md",

      "poster.jpg",
      "poster.jpeg",
      "poster.png",
      "poster.webp",
      "poster.heic",
      "poster.heif",

      "folder.jpg",
      "folder.jpeg",
      "folder.png",
      "folder.webp",

      "cover.jpg",
      "cover.jpeg",
      "cover.png",
      "cover.webp",

      "banner.jpg",
      "banner.jpeg",
      "banner.png",
      "banner.webp",
      "banner.heic",
      "banner.heif",

      "backdrop.jpg",
      "backdrop.jpeg",
      "backdrop.png",
      "backdrop.webp",

      "fanart.jpg",
      "fanart.jpeg",
      "fanart.png",
      "fanart.webp",

      "trailer.mp4",
      "trailer.webm",
      "trailer.mkv",
      "theme.mp4",

      "theme.mp3",
      "theme.flac",
      "theme.m4a",
      "theme.ogg",

      "logo.png",
      "logo.webp",
      "clearlogo.png",
      "clearlogo.webp",
    ].includes(lower);
  });

  return {
    id: entityId,
    library: libraryId,
    path: toPublicPath(entityDir),
    sourcePath: entityDir,
    sourcePaths: [entityDir],
    name:
      metadata?.name ||
      entityId
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    metadata,
relationships,
status,
    poster: posterFile ? toPublicPath(path.join(entityDir, posterFile)) : null,
    banner: bannerFile ? toPublicPath(path.join(entityDir, bannerFile)) : null,
    trailer: trailerFile ? toPublicPath(path.join(entityDir, trailerFile)) : null,
    theme: themeFile ? toPublicPath(path.join(entityDir, themeFile)) : null,
    logo: logoFile ? toPublicPath(path.join(entityDir, logoFile)) : null,
    bio: exists(bioPath) ? `/media/${libraryId}/${entityId}/bio.md` : null,
    timeline: exists(timelinePath)
      ? `/media/${libraryId}/${entityId}/timeline.json`
      : null,
    files: allFiles,
    counts: {
      images: allFiles.filter((file) => file.type === "image").length,
      videos: allFiles.filter((file) => file.type === "video").length,
      ebooks: allFiles.filter((file) => file.type === "ebook").length,
      audiobooks: allFiles.filter((file) => file.type === "audiobook").length,
      audio: allFiles.filter(
        (file) => file.type === "audio" || file.type === "audiobook"
      ).length,
      documents: allFiles.filter((file) => file.type === "document").length,
      total: allFiles.length,
    },
  };
}

async function scanPhotoCollectionFolder(libraryId, collectionId, collectionDir) {
  const metadataPath = path.join(collectionDir, "metadata.json");
  const metadataFile = readJsonIfExists(metadataPath) || {};

  const allFiles = (await walkFiles(collectionDir)).filter((file) => {
    const lower = file.name.toLowerCase();

    return ![
      "metadata.json",
      "poster.jpg",
      "poster.jpeg",
      "poster.png",
      "poster.webp",
      "folder.jpg",
      "folder.jpeg",
      "folder.png",
      "folder.webp",
      "cover.jpg",
      "cover.jpeg",
      "cover.png",
      "cover.webp",
    ].includes(lower);
  });

  const imageFiles = allFiles.filter((file) => file.type === "image");
  const videoFiles = allFiles.filter((file) => file.type === "video");

  const coverCandidates = [
    "poster.jpg",
    "poster.jpeg",
    "poster.png",
    "poster.webp",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "folder.webp",
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",
  ];

  const coverFile = coverCandidates.find((file) =>
    exists(path.join(collectionDir, file))
  );

  const firstImage = imageFiles[0]?.path || null;
const firstVideo = videoFiles[0]?.path || null;
const fallbackCover = firstImage || firstVideo;

  return {
    id: collectionId,
    library: libraryId,
    type:
  libraryId === "adultVideos"
    ? "adult-video-collection"
    : "adult-photo-collection",
    name:
      metadataFile.name ||
      collectionId
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    title:
      metadataFile.title ||
      metadataFile.name ||
      collectionId
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    path: toPublicPath(collectionDir),
    sourcePath: collectionDir,
poster: coverFile ? toPublicPath(path.join(collectionDir, coverFile)) : fallbackCover,
coverImage: coverFile ? toPublicPath(path.join(collectionDir, coverFile)) : fallbackCover,
    hidden: metadataFile.hidden || false,
    linkedProfileIds: metadataFile.linkedProfileIds || [],
    metadata: metadataFile.metadata || {},
    files: allFiles,
    counts: {
      images: imageFiles.length,
      videos: videoFiles.length,
      total: allFiles.length,
    },
    itemCount: allFiles.length,
  };
}

async function scanLibrary(libraryId, overrideFolder = null) {
const libraryDirs = overrideFolder
  ? [overrideFolder]
  : getLibraryDirs(libraryId);

  const entities = {};

  for (const libraryDir of libraryDirs) {
    console.log("SCANNING", libraryId, "->", libraryDir);

    if (!fs.existsSync(libraryDir)) {
  console.warn("MISSING PATH:", libraryId, "->", libraryDir);
  continue;
}

const entries = fs.readdirSync(libraryDir, { withFileTypes: true });

console.log(
  "FOUND ENTRIES:",
  libraryId,
  libraryDir,
  entries.length,
  entries.slice(0, 10).map((entry) => entry.name)
);

const entityDirs = entries.filter((entry) => entry.isDirectory());

if (libraryId === "adultPhotos" || libraryId === "adultVideos") {
  const mediaType = libraryId === "adultPhotos" ? "image" : "video";
  const isMatchingFile =
    libraryId === "adultPhotos" ? isImageFile : isVideoFile;

  const directFiles = entries.filter(
    (entry) => entry.isFile() && isMatchingFile(entry.name)
  );
  
  console.log(
  "DIRECT FILE DEBUG:",
  libraryId,
  entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    ext: path.extname(entry.name).toLowerCase(),
    type: getType(path.extname(entry.name).toLowerCase()),
    matches: isMatchingFile(entry.name),
  }))
);

  if (directFiles.length) {
    const unsortedId = "_unsorted";

    entities[unsortedId] = {
      id: unsortedId,
      library: libraryId,
      type:
        libraryId === "adultPhotos"
          ? "adult-photo-album"
          : "adult-video-collection",
      name:
        libraryId === "adultPhotos"
          ? "Unsorted Photos"
          : "Unsorted Videos",
      title:
        libraryId === "adultPhotos"
          ? "Unsorted Photos"
          : "Unsorted Videos",
      path: toPublicPath(libraryDir),
      sourcePath: libraryDir,
      hidden: false,
      files: directFiles.map((entry) => {
        const filePath = path.join(libraryDir, entry.name);

        return {
          name: entry.name,
          path: toPublicPath(filePath),
          sourcePath: filePath,
          type: mediaType,
        };
      }),
      counts: {
        images: libraryId === "adultPhotos" ? directFiles.length : 0,
        videos: libraryId === "adultVideos" ? directFiles.length : 0,
        total: directFiles.length,
      },
      itemCount: directFiles.length,
    };
  }
}

console.log(
  "FOUND FOLDERS:",
  libraryId,
  libraryDir,
  entityDirs.length,
  entityDirs.slice(0, 10).map((entry) => entry.name)
);

    for (const entry of entityDirs) {
const entityPath = path.join(libraryDir, entry.name);

const scannedEntity =
  libraryId === "adultPhotos" || libraryId === "adultVideos"
    ? await scanPhotoCollectionFolder(libraryId, entry.name, entityPath)
    : await scanEntityFolder(libraryId, entry.name, entityPath);

const mergeKey = normalizeLibraryItemKey(libraryId, entry.name);
scannedEntity.id = entities[mergeKey]?.id || mergeKey;
scannedEntity.folderName = entry.name;
scannedEntity.folderNames = Array.from(
  new Set([...(entities[mergeKey]?.folderNames || []), entry.name])
);

entities[mergeKey] = mergeScannedEntities(entities[mergeKey], scannedEntity);
    }
  }

  return entities;
}


function normalizeYouTubeCreatorFromIndex(creatorId, creator = {}) {
  const videos = Array.isArray(creator.videos) ? creator.videos : [];
  const videoCount = Number(creator.videoCount) || videos.length || 0;

  return {
    id: creator.id || creatorId,
    library: "youtube",
    type: "youtube-creator",
    name: creator.name || creator.title || creatorId,
    title: creator.title || creator.name || creatorId,
    description: creator.description || creator.metadata?.description || "",
    poster: creator.poster || creator.thumbnail || null,
    banner: creator.banner || creator.backdrop || null,
    channelId: creator.channelId || creator.channel_id || creator.metadata?.channelId || creator.metadata?.channel_id || "",
    youtubeUrl: creator.youtubeUrl || creator.channel_url || creator.metadata?.youtubeUrl || creator.metadata?.channel_url || "",
    metadata: creator.metadata || {},
    videos,
    videoCount,
    files: videos,
    counts: {
      images: 0,
      videos: videoCount,
      total: videoCount,
    },
    itemCount: videoCount,
  };
}

function scanYouTubeFromDedicatedIndex() {
  const youtubeIndex = readJsonIfExists(youtubeIndexPath);
  const creators = youtubeIndex?.creators || null;

  if (!creators || typeof creators !== "object") {
    return null;
  }

  return Object.fromEntries(
    Object.entries(creators).map(([creatorId, creator]) => [
      normalizeLibraryItemKey("youtube", creatorId),
      normalizeYouTubeCreatorFromIndex(creatorId, creator),
    ])
  );
}

async function scanAllLibraries() {
  const index = {
    generatedAt: new Date().toISOString(),
    libraries: {},
  };

  for (const libraryId of libraryRoots) {
    if (libraryId === "books") {
      index.libraries[libraryId] = await scanBooksLibrary();
      continue;
    }

    if (libraryId === "youtube") {
      const dedicatedYouTubeIndex = scanYouTubeFromDedicatedIndex();

      if (dedicatedYouTubeIndex) {
        index.libraries[libraryId] = dedicatedYouTubeIndex;
        continue;
      }
    }

    // Always let scanLibrary/getLibraryDirs handle mappings and aliases.
    index.libraries[libraryId] = await scanLibrary(libraryId);
  }

  index.personal = Object.fromEntries(
    Object.entries(index.libraries.personal || {}).map(([id, entity]) => [
      id,
      entity.files || [],
    ])
  );

  return index;
}

async function scanBooksLibrary(overrideFolders = null) {
const bookDirs = overrideFolders?.length ? overrideFolders : getLibraryDirs("books");

const files = [];

for (const booksDir of bookDirs) {
  if (!exists(booksDir)) continue;
  files.push(...await walkFiles(booksDir));
}
  const entities = {};
  const bookFiles = files.filter(
  (file) =>
    file.type === "ebook" ||
    file.type === "audiobook" ||
    file.type === "image"
);

  for (const file of bookFiles) {
    const parsed = file.parsed || {};
    const cleanTitle = stripExt(file.name);

    const title = parsed.title || cleanTitle;
    const author = parsed.author || "Unknown Author";
    const series = parsed.series || null;

    const id = `${author}-${series || "standalone"}-${title}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    if (!entities[id]) {
      entities[id] = {
        id,
        library: "books",
        name: title,
        metadata: {
          title,
          author,
          series,
        },
        poster: null,
        banner: null,
        bio: null,
        timeline: null,
        files: [],
        counts: {
          images: 0,
          videos: 0,
          ebooks: 0,
          audiobooks: 0,
          audio: 0,
          documents: 0,
          total: 0,
        },
      };
    }

    entities[id].files.push(file);

    if (file.type === "ebook") {
      entities[id].counts.ebooks++;
    }

    if (file.type === "audiobook") {
      entities[id].counts.audiobooks++;
      entities[id].counts.audio++;
    }

    entities[id].counts.total++;
  }

for (const book of Object.values(entities)) {
  book.poster = findBookArtwork(book.files);
  book.banner = findBookBanner(book.files);
}

  return entities;
}


async function scanLibraryWithFolders(libraryId, overrideFolders = []) {
  if (!overrideFolders?.length) {
    if (libraryId === "books") {
      return await scanBooksLibrary();
    }

    if (libraryId === "youtube") {
      const dedicatedYouTubeIndex = scanYouTubeFromDedicatedIndex();
      if (dedicatedYouTubeIndex) return dedicatedYouTubeIndex;
    }

    return await scanLibrary(libraryId);
  }

  const merged = {};

  for (const folder of overrideFolders) {
    const scanned =
      libraryId === "books"
        ? await scanBooksLibrary([folder])
        : await scanLibrary(libraryId, folder);

    for (const [id, entity] of Object.entries(scanned || {})) {
      merged[id] = mergeScannedEntities(merged[id], entity);
    }
  }

  return merged;
}

function preserveItemTimestamps(existingLibrary = {}, scannedLibrary = {}, now = new Date().toISOString()) {
  const output = {};

  for (const [id, item] of Object.entries(scannedLibrary || {})) {
    const existing = existingLibrary?.[id] || null;

    output[id] = {
      ...item,
      addedAt: existing?.addedAt || existing?.createdAt || now,
      createdAt: existing?.createdAt || existing?.addedAt || now,
      updatedAt: now,
      lastScannedAt: now,
    };
  }

  return output;
}

function getScanSummary(libraryId, existingLibrary = {}, scannedLibrary = {}, overrideFolders = [], now = new Date().toISOString()) {
  const existingIds = new Set(Object.keys(existingLibrary || {}));
  const scannedIds = Object.keys(scannedLibrary || {});
  const newIds = scannedIds.filter((id) => !existingIds.has(id));
  const removedIds = Array.from(existingIds).filter((id) => !scannedLibrary?.[id]);

  return {
    libraryId,
    completedAt: now,
    folders: overrideFolders?.length ? overrideFolders : getLibraryDirs(libraryId),
    itemCount: scannedIds.length,
    newItemCount: newIds.length,
    removedItemCount: removedIds.length,
    newIds,
    removedIds,
  };
}

async function scanSelectedLibraries() {
  const now = new Date().toISOString();
  const options = getCliOptions();
  const existingIndex = readJsonIfExists(mediaIndexPath) || {};
  const targetLibraries = options.targetLibraries.length ? options.targetLibraries : [...libraryRoots];

  const isBulkScan =
    options.isFullScan ||
    targetLibraries.length === libraryRoots.length && !options.requestedFolders.length;

  const index = isBulkScan
    ? {
        generatedAt: now,
        libraries: {},
        scanHistory: {},
      }
    : {
        ...existingIndex,
        generatedAt: now,
        libraries: {
          ...(existingIndex.libraries || {}),
        },
        scanHistory: {
          ...(existingIndex.scanHistory || {}),
        },
      };

  const folderOverride =
    options.requestedFolders.length && targetLibraries.length === 1
      ? options.requestedFolders
      : [];

  if (options.requestedFolders.length && targetLibraries.length !== 1) {
    console.warn("--folder/--folders can only be used with a single --library target. Ignoring folder override.");
  }

  for (const libraryId of targetLibraries) {
    const existingLibrary = existingIndex.libraries?.[libraryId] || {};
    const scanned = await scanLibraryWithFolders(libraryId, folderOverride);
    const stamped = preserveItemTimestamps(existingLibrary, scanned, now);

    index.libraries[libraryId] = stamped;
    index.scanHistory[libraryId] = getScanSummary(
      libraryId,
      existingLibrary,
      stamped,
      folderOverride,
      now
    );
  }

  index.personal = Object.fromEntries(
    Object.entries(index.libraries?.personal || {}).map(([id, entity]) => [
      id,
      entity.files || [],
    ])
  );

  return { index, targetLibraries };
}

(async () => {
  const { index, targetLibraries } = await scanSelectedLibraries();

  fs.mkdirSync(dataRoot, { recursive: true });

  fs.writeFileSync(
    mediaIndexPath,
    JSON.stringify(index, null, 2)
  );

  console.log("Media index generated:");
  console.log(mediaIndexPath);

  for (const libraryId of targetLibraries) {
    const count = Object.keys(index.libraries?.[libraryId] || {}).length;
    const summary = index.scanHistory?.[libraryId];
    console.log(
      `${libraryId}: ${count} item(s)` +
      (summary ? `, ${summary.newItemCount} new, ${summary.removedItemCount} removed` : "")
    );
  }
})();
