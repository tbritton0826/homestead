const { createPluginRegistry } = require("./plugins/registry.cjs");
const { createPluginInstaller } = require("./plugins/installer.cjs");

const { execFile } = require("child_process");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let sharp = null;
try {
  sharp = require("sharp");
} catch (error) {
  console.warn("Sharp is unavailable; uploaded image EXIF orientation cannot be normalized.");
}
const { pathToFileURL } = require("url");
const {
  getLiveTvConfig,
  saveLiveTvConfig,
  getLiveTvChannels,
  saveLiveTvChannels,
  getLiveTvEpg,
  saveLiveTvEpg,
  parseM3U,
  fetchPlaylistText,
  scanLiveTvSource,
  fetchEpgPrograms,
  applyChannelOverrides,
  dedupeChannels,
  createId,
} = require("./src/components/livetv/livetv.cjs");

const app = express();
const PORT = 7312;
const dataDir = path.join(__dirname, "data");
const installedPluginsDir = path.join(dataDir, "installed-plugins");
const pluginDataDir = path.join(dataDir, "plugin-data");
const localPluginCatalogDir = path.join(dataDir, "plugin-catalog");
const localPluginCatalogPath = path.join(localPluginCatalogDir, "catalog.json");
const pluginRegistry = createPluginRegistry({
  homesteadRoot: __dirname,
  pluginsRoot: installedPluginsDir,
  pluginDataBase: pluginDataDir,
});
const pluginInstaller = createPluginInstaller({
  registry: pluginRegistry,
  defaultCatalogUrl: fs.existsSync(localPluginCatalogPath)
    ? `http://127.0.0.1:${PORT}/api/plugin-catalog/catalog.json`
    : "",
});
const loadedServerPlugins = new Set();

app.use(cors());

function pluginDescriptor(plugin) {
  const hasClient = Boolean(plugin.clientEntryPath);
  const hasServer = Boolean(plugin.serverEntryPath);
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    type: plugin.type,
    description: plugin.description,
    installed: plugin.installed,
    valid: plugin.valid,
    enabled: plugin.enabled,
    loaded: loadedServerPlugins.has(plugin.id),
    errors: plugin.errors,
    permissions: Array.isArray(plugin.manifest?.permissions) ? plugin.manifest.permissions : [],
    navigation: plugin.manifest?.navigation || null,
    hasClient,
    hasServer,
    clientUrl: plugin.valid && plugin.enabled && hasClient
      ? `/plugins/${encodeURIComponent(plugin.id)}/`
      : "",
    installedAt: plugin.install?.installedAt || "",
    installSource: plugin.install?.source || "",
  };
}

function sendPluginError(res, error, status = 400) {
  console.error("Plugin operation failed:", error);
  res.status(status).json({
    ok: false,
    message: error.message || "Plugin operation failed.",
  });
}

app.post(
  "/api/plugins/stage/upload",
  express.raw({ type: () => true, limit: "512mb" }),
  (req, res) => {
    try {
      const staged = pluginInstaller.stageUpload(req.body, {
        fileName: req.get("x-plugin-filename") || "Local package",
        expectedSha256: req.get("x-plugin-sha256") || "",
      });
      res.json({ ok: true, staged });
    } catch (error) {
      sendPluginError(res, error);
    }
  }
);

app.use(express.json({ limit: "32mb" }));

app.get("/api/plugin-catalog/catalog.json", (req, res) => {
  if (!fs.existsSync(localPluginCatalogPath)) {
    return res.status(404).json({ ok: false, message: "No local plugin catalog is installed." });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(localPluginCatalogPath);
});

app.get("/api/plugin-catalog/packages/:fileName", (req, res) => {
  const fileName = String(req.params.fileName || "");
  if (!fileName || path.basename(fileName) !== fileName || !/\.(zip|homestead-plugin)$/i.test(fileName)) {
    return res.status(400).json({ ok: false, message: "Invalid plugin package name." });
  }
  const packagePath = path.join(localPluginCatalogDir, "packages", fileName);
  if (!fs.existsSync(packagePath) || !fs.statSync(packagePath).isFile()) {
    return res.status(404).json({ ok: false, message: "Plugin package not found." });
  }
  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(packagePath);
});

app.get("/api/plugins", (req, res) => {
  try {
    const plugins = pluginRegistry.scan().map(pluginDescriptor);

    res.json({
      ok: true,
      plugins,
      count: plugins.length,
    });
  } catch (error) {
    console.error("Plugin registry status failed:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Unable to read plugin registry.",
    });
  }
});

app.get("/api/plugins/catalog/settings", (req, res) => {
  try {
    res.json({ ok: true, settings: pluginInstaller.readCatalogSettings() });
  } catch (error) {
    sendPluginError(res, error, 500);
  }
});

app.put("/api/plugins/catalog/settings", (req, res) => {
  try {
    const settings = pluginInstaller.writeCatalogSettings({ url: req.body?.url || "" });
    res.json({ ok: true, settings });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.get("/api/plugins/catalog", async (req, res) => {
  try {
    res.json({ ok: true, catalog: await pluginInstaller.getCatalog() });
  } catch (error) {
    sendPluginError(res, error, 502);
  }
});

app.post("/api/plugins/stage/catalog", async (req, res) => {
  try {
    const staged = await pluginInstaller.stageCatalogPlugin(String(req.body?.pluginId || ""));
    res.json({ ok: true, staged });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.post("/api/plugins/install/confirm", (req, res) => {
  try {
    const result = pluginInstaller.confirmInstall(req.body?.stageId, {
      enable: req.body?.enable === true,
      allowUpdate: req.body?.allowUpdate === true,
    });
    res.json({
      ok: true,
      plugin: result.plugin ? pluginDescriptor(result.plugin) : null,
      restartRequired: result.restartRequired,
      previousVersionBackedUp: Boolean(result.backupPath),
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.post("/api/plugins/:pluginId/enabled", (req, res) => {
  try {
    const result = pluginInstaller.setPluginEnabled(req.params.pluginId, req.body?.enabled === true);
    res.json({
      ok: true,
      plugin: pluginDescriptor(result.plugin),
      restartRequired: result.restartRequired,
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.delete("/api/plugins/:pluginId", (req, res) => {
  try {
    const result = pluginInstaller.uninstallPlugin(req.params.pluginId);
    res.json({
      ok: true,
      pluginId: result.id,
      dataPreserved: result.dataPreserved,
      restartRequired: result.restartRequired,
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.use("/plugins/:pluginId", (req, res) => {
  try {
    const filePath = pluginInstaller.resolveClientRequest(req.params.pluginId, req.path);
    if (!filePath) return res.status(404).send("Plugin client not found.");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; connect-src 'self' http: https:; frame-ancestors 'self';");
    if (path.extname(filePath).toLowerCase() === ".html") res.setHeader("Cache-Control", "no-store");
    return res.sendFile(filePath);
  } catch (error) {
    return sendPluginError(res, error, 404);
  }
});

const watchlistPath = path.join(dataDir, "watchlist.json");
const namedWatchlistsPath = path.join(dataDir, "named-watchlists.json");
const requestsPath = path.join(dataDir, "requests.json");
const { Readable } = require("stream");

const { searchBookMetadata } = require("./scripts/metadata/fetch-book-metadata.cjs");
const { searchMusicMetadata } = require("./scripts/metadata/fetch-music-metadata.cjs");
const { searchYouTubeMetadata } = require("./scripts/metadata/fetch-youtube-metadata.cjs");
const { searchAdultMetadata, normalizeAdultCandidateForMetadata } = require("./scripts/metadata/fetch-adult-metadata.cjs");
const {
  DEFAULT_ADULT_SOURCES,
  getConfiguredAdultSources,
  buildSourceSearchUrl,
  discoverAdultPerformer,
  discoverAdultBrowseMedia,
  requestSelectedAdultContent,
  sourceSupportsAdultBrowse,
} = require("./scripts/metadata/adult-sources.cjs");


const HOMESTEAD_ADULT_BROWSE_SOURCES = [
  {
    id: "baldpussypics",
    name: "Bald Pussy Pics",
    enabled: true,
    status: "active",
    priority: 46,
    category: "General browse · photo galleries",
    role: "both",
    baseUrl: "https://baldpussypics.com/",
    searchUrlTemplate: "https://baldpussypics.com/?s={queryPlus}",
    supports: ["photos", "galleries", "images"],
    searchModes: ["general", "media", "artwork"],
    supportsArtwork: true,
    supportsImport: false,
    supportsScenes: false,
    requiresSession: false,
    externalOnly: true,
    badges: ["Browse", "Photo galleries", "External"],
  },
  {
    id: "niceasspics",
    name: "Nice Ass Pics",
    enabled: true,
    status: "active",
    priority: 47,
    category: "General browse · photo galleries",
    role: "both",
    baseUrl: "https://niceass.pics/",
    searchUrlTemplate: "https://niceass.pics/?s={queryPlus}",
    supports: ["photos", "galleries", "images"],
    searchModes: ["general", "media", "artwork"],
    supportsArtwork: true,
    supportsImport: false,
    supportsScenes: false,
    requiresSession: false,
    externalOnly: true,
    badges: ["Browse", "Photo galleries", "External"],
  },
];

function mergeHomesteadAdultBrowseSources(sources = []) {
  const merged = Array.isArray(sources)
    ? sources.map((source) => ({ ...source }))
    : [];
  const known = new Set(
    merged.flatMap((source) => [
      String(source.id || "").trim().toLowerCase(),
      String(source.baseUrl || "").trim().toLowerCase(),
    ]).filter(Boolean)
  );

  HOMESTEAD_ADULT_BROWSE_SOURCES.forEach((source) => {
    const id = String(source.id || "").toLowerCase();
    const baseUrl = String(source.baseUrl || "").toLowerCase();
    if (known.has(id) || known.has(baseUrl)) return;
    merged.push({ ...source });
    known.add(id);
    known.add(baseUrl);
  });

  return merged;
}

function setupConfigWithHomesteadAdultBrowseSources(setupConfig = {}) {
  const configured = getConfiguredAdultSources(setupConfig);
  const sources = mergeHomesteadAdultBrowseSources(configured);

  return {
    ...setupConfig,
    adultMetadataSources: sources,
    libraryPreferences: {
      ...(setupConfig.libraryPreferences || {}),
      adult: {
        ...(setupConfig.libraryPreferences?.adult || {}),
        metadataSources: sources,
      },
    },
  };
}

const setupConfigPath = path.join(dataDir, "setup-config.json");
const brandingDir = path.join(dataDir, "branding");
const brandingIconPath = path.join(brandingDir, "app-icon.png");

const defaultSetupConfig = {
  completed: false,
  serverName: "Homestead",
  branding: {
    appIconUrl: "/api/branding/icon",
    appIconVersion: "default",
    hasCustomIcon: false,
  },
  adminAccount: {
    username: "",
    passwordConfigured: false,
  },
  enabledLibraries: {},
  familySublibraries: {},
  adultSublibraries: {},
  inventorySublibraries: {},
  libraryPreferences: {},
  folderMappings: {},
  integrations: {},
  integrationSettings: {},
  connectedAccounts: {},
  customMetadataSources: [],
  adultMetadataSources: DEFAULT_ADULT_SOURCES,
  adultWhisparrMode: "browse",
};


const adultRequestsPath = path.join(dataDir, "adult-discovery-requests.json");

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getBrandingIconState() {
  const hasCustomIcon = fs.existsSync(brandingIconPath);
  let updatedAt = "";
  let version = "default";

  if (hasCustomIcon) {
    try {
      const stats = fs.statSync(brandingIconPath);
      updatedAt = stats.mtime.toISOString();
      version = String(Math.floor(stats.mtimeMs));
    } catch {
      version = String(Date.now());
    }
  }

  return {
    appIconUrl: "/api/branding/icon",
    appIconVersion: version,
    hasCustomIcon,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function persistBrandingState(branding = getBrandingIconState()) {
  const current = readSetupConfig();
  const next = {
    ...current,
    branding: {
      ...(current.branding || {}),
      ...branding,
    },
  };
  fs.mkdirSync(path.dirname(setupConfigPath), { recursive: true });
  fs.writeFileSync(setupConfigPath, JSON.stringify(next, null, 2));
  return next.branding;
}

function getDefaultBrandIconPath() {
  const candidates = [
    path.join(__dirname, "public", "assets", "images", "homestead-icon.png"),
    path.join(__dirname, "dist", "assets", "images", "homestead-icon.png"),
    path.join(__dirname, "src", "assets", "images", "homestead-icon.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function sendHomesteadBrandIcon(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (fs.existsSync(brandingIconPath)) {
    res.type("image/png");
    res.sendFile(brandingIconPath);
    return;
  }

  const defaultIconPath = getDefaultBrandIconPath();
  if (defaultIconPath) {
    res.type("image/png");
    res.sendFile(defaultIconPath);
    return;
  }

  res.redirect(302, "/assets/images/homestead-icon.png");
}

function sendHomesteadManifest(req, res) {
  const setupConfig = readSetupConfig();
  const branding = getBrandingIconState();
  const name = String(setupConfig.serverName || "Homestead").trim() || "Homestead";
  const shortName = name.length > 24 ? name.slice(0, 24).trim() : name;
  const iconUrl = `/api/branding/icon?v=${encodeURIComponent(branding.appIconVersion)}`;

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.type("application/manifest+json").send(JSON.stringify({
    id: "/",
    name,
    short_name: shortName,
    description: "Your digital home for personal media, archives, collections, cloud, and profiles.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f1117",
    theme_color: "#11141d",
    icons: [
      { src: iconUrl, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  }));
}

function escapeHomesteadHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendHomesteadBrandedIndex(req, res) {
  try {
    const indexPath = path.join(__dirname, "dist", "index.html");
    if (!fs.existsSync(indexPath)) {
      return res.status(503).type("text/plain").send("Homestead frontend build is unavailable.");
    }

    const setupConfig = readSetupConfig();
    const branding = getBrandingIconState();
    const version = encodeURIComponent(branding.appIconVersion || "default");
    const appName = String(setupConfig.serverName || "Homestead").trim() || "Homestead";
    const escapedName = escapeHomesteadHtml(appName);
    const iconUrl = `/api/branding/icon?v=${version}`;
    const manifestUrl = `/api/branding/manifest.webmanifest?v=${version}`;

    let html = fs.readFileSync(indexPath, "utf8");

    // Vite's starter index normally contains /vite.svg. Remove every static
    // icon/manifest declaration so Edge sees Homestead branding before React
    // runs, rather than installing the purple Vite lightning icon.
    html = html.replace(/<link\b[^>]*>/gi, (tag) => {
      const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
      const rel = String(relMatch?.[1] || "").toLowerCase();
      return rel.includes("icon") || rel.includes("manifest") ? "" : tag;
    });

    const brandedHead = [
      `<link rel="icon" type="image/png" sizes="512x512" href="${iconUrl}">`,
      `<link rel="shortcut icon" type="image/png" href="${iconUrl}">`,
      `<link rel="apple-touch-icon" sizes="512x512" href="${iconUrl}">`,
      `<link rel="manifest" href="${manifestUrl}">`,
      `<meta name="application-name" content="${escapedName}">`,
      `<meta name="apple-mobile-web-app-title" content="${escapedName}">`,
      `<meta name="msapplication-TileImage" content="${iconUrl}">`,
      `<meta name="theme-color" content="#11141d">`,
    ].join("\n    ");

    if (/<title>[\s\S]*?<\/title>/i.test(html)) {
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapedName}</title>`);
    } else {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${escapedName}</title>`);
    }

    html = html.replace(/<\/head>/i, `    ${brandedHead}\n  </head>`);

    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.type("html").send(html);
  } catch (error) {
    console.error("Failed to serve branded Homestead index:", error);
    res.status(500).type("text/plain").send("Failed to load Homestead.");
  }
}

function readSetupConfig() {
  if (!fs.existsSync(setupConfigPath)) {
    return defaultSetupConfig;
  }

  try {
    return {
      ...defaultSetupConfig,
      ...JSON.parse(fs.readFileSync(setupConfigPath, "utf8")),
    };
  } catch {
    return defaultSetupConfig;
  }
}

function getCustomMetadataSourceUrls(setupConfig = readSetupConfig(), libraryType = "") {
  const normalizeLibrary = (value = "") => {
    const normalized = String(value || "").toLowerCase();
    if (["celebrity", "celebrities", "celeb"].includes(normalized)) return "celebrities";
    if (["performer", "performers"].includes(normalized)) return "performers";
    if (["personal", "girls"].includes(normalized)) return "personal";
    return normalized;
  };
  const wanted = normalizeLibrary(libraryType);
  const sources = [
    ...(Array.isArray(setupConfig.customMetadataSources) ? setupConfig.customMetadataSources : []),
    ...(Array.isArray(setupConfig?.libraryPreferences?.adult?.customMetadataSources) ? setupConfig.libraryPreferences.adult.customMetadataSources : []),
  ];

  return sources.filter((source) => {
    if (!source) return false;
    if (typeof source === "string") return true;
    if (source.enabled === false || !source.url) return false;
    const sourceLibrary = normalizeLibrary(source.libraryType || source.library || source.profileType || "");
    return !sourceLibrary || !wanted || sourceLibrary === wanted || sourceLibrary === "adult" || sourceLibrary === "all";
  });
}

const HOMESTEAD_DATA_DIR =
  process.env.HOMESTEAD_DATA_DIR || path.join(__dirname, "data");

const METADATA_MATCHES_FILE = path.join(
  HOMESTEAD_DATA_DIR,
  "metadata-matches.json"
);

function ensureHomesteadDataDir() {
  if (!fs.existsSync(HOMESTEAD_DATA_DIR)) {
    fs.mkdirSync(HOMESTEAD_DATA_DIR, { recursive: true });
  }
}

function readMetadataMatches() {
  try {
    ensureHomesteadDataDir();

    if (!fs.existsSync(METADATA_MATCHES_FILE)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(METADATA_MATCHES_FILE, "utf8"));
  } catch (error) {
    console.error("Failed to read metadata matches:", error);
    return {};
  }
}

function cleanMetadataQuery(value = "") {
  return String(value || "")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:720|1080|2160|480)p\b/gi, " ")
    .replace(/\b(?:x264|x265|h264|h265|hevc|bluray|blu-ray|brrip|webrip|web-dl|webdl|dvdrip|remux|proper|repack|hdr|uhd|4k)\b/gi, " ")
    .replace(/[()[\]{}._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeMetadataMatchAlias(value = "") {
  return String(value || "")
    .replaceAll("\\", "/")
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, "")
    .replace(/\/metadata\.json$/i, "")
    .replace(/\/poster\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/\/banner\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/\/folder\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/\/cover\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function slugMetadataMatchAlias(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueMetadataMatchAliases(values = []) {
  const seen = new Set();
  const aliases = [];
  for (const value of values.flat(Infinity)) {
    if (value === undefined || value === null) continue;
    const raw = String(value || "").trim();
    if (!raw) continue;
    const normalized = normalizeMetadataMatchAlias(raw);
    const slug = slugMetadataMatchAlias(raw.split("/").pop() || raw);
    for (const candidate of [raw, normalized, slug]) {
      const clean = String(candidate || "").trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      aliases.push(clean);
    }
  }
  return aliases;
}

function buildMetadataMatchAliases({ localId = "", localItem = null, metadata = null } = {}) {
  const item = localItem || {};
  const original = item.originalItem || {};
  const meta = metadata || item.metadata || original.metadata || {};
  const names = [
    localId,
    ...(Array.isArray(meta.aliases) ? meta.aliases : []),
    ...(Array.isArray(item.aliases) ? item.aliases : []),
    item.localId, item.id, item.path, item.filePath, item.folderPath, item.sourcePath, item.name, item.title, item.displayTitle, item.folderName, item.fileName, item.filename,
    original.localId, original.id, original.path, original.filePath, original.folderPath, original.sourcePath, original.name, original.title, original.folderName, original.fileName, original.filename,
    meta.title, meta.name, meta.sortTitle,
    meta.tmdbId && `tmdb:${meta.tmdbId}`,
    meta.providerId && `provider:${meta.providerId}`,
  ];

  for (const value of [item.path, item.filePath, item.folderPath, item.sourcePath, original.path, original.filePath, original.folderPath, original.sourcePath].filter(Boolean)) {
    const parts = String(value || "").replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.length) names.push(parts[parts.length - 1]);
    if (parts.length > 1) names.push(parts.slice(-2).join("/"));
  }

  return uniqueMetadataMatchAliases(names);
}

function writeMetadataMatches(matches) {
  ensureHomesteadDataDir();
  fs.writeFileSync(METADATA_MATCHES_FILE, JSON.stringify(matches, null, 2));
}

function getMetadataMatchStats(matches = readMetadataMatches()) {
  const canonical = Object.entries(matches).filter(([, match]) => !match?.aliasOf);
  const byLibrary = {};
  for (const [, match] of canonical) {
    const libraryType = match?.libraryType || "unknown";
    byLibrary[libraryType] = (byLibrary[libraryType] || 0) + 1;
  }
  return { total: canonical.length, aliasKeys: Object.keys(matches).length - canonical.length, byLibrary };
}


function firstAdultBodyValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = typeof value === "string" ? value.trim() : value;
    if (text !== "") return text;
  }
  return "";
}

function augmentAdultBodyMetadata(candidate = {}, base = {}) {
  const existingBody = base.body || base.bodyDetails || {};
  const candidateBody = candidate.body || candidate.bodyDetails || candidate.physicalDetails || {};
  const rawMeasurements = candidate.measurements || candidate.measurementsRaw || candidateBody.measurements || candidateBody.measurementsRaw || {};
  const measurementsRaw = typeof rawMeasurements === "string"
    ? rawMeasurements
    : firstAdultBodyValue(candidate.measurementsRaw, candidateBody.measurementsRaw, base.measurementsRaw, existingBody.measurementsRaw);
  const bust = firstAdultBodyValue(candidate.bust, candidateBody.bust, rawMeasurements?.bust, base.bust, existingBody.bust);
  const waist = firstAdultBodyValue(candidate.waist, candidateBody.waist, rawMeasurements?.waist, base.waist, existingBody.waist);
  const hips = firstAdultBodyValue(candidate.hips, candidateBody.hips, rawMeasurements?.hips, base.hips, existingBody.hips);
  const composedMeasurements = measurementsRaw || [bust, waist, hips].filter(Boolean).join("-");
  const sourceName = firstAdultBodyValue(candidate.source, candidate.provider, candidateBody.sourceName, existingBody.sourceName);
  const sourceUrl = firstAdultBodyValue(candidate.url, candidate.sourceUrl, candidateBody.sourceUrl, existingBody.sourceUrl);

  const bodyDetails = {
    height: firstAdultBodyValue(candidate.height, candidateBody.height, base.height, existingBody.height),
    weight: firstAdultBodyValue(base.weight, base.weightValue, existingBody.weight, candidate.weight, candidateBody.weight),
    weightUnit: firstAdultBodyValue(base.weightUnit, existingBody.weightUnit, candidate.weightUnit, candidateBody.weightUnit),
    measurementsRaw: composedMeasurements,
    bust,
    waist,
    hips,
    braSize: firstAdultBodyValue(candidate.braSize, candidate.cupSize, candidateBody.braSize, candidateBody.cupSize, base.braSize, base.cupSize, existingBody.braSize, existingBody.cupSize),
    pantySize: firstAdultBodyValue(candidate.pantySize, candidate.underwearSize, candidateBody.pantySize, candidateBody.underwearSize, base.pantySize, base.underwearSize, existingBody.pantySize, existingBody.underwearSize),
    shoeSize: firstAdultBodyValue(candidate.shoeSize, candidateBody.shoeSize, base.shoeSize, existingBody.shoeSize),
    dressSize: firstAdultBodyValue(candidate.dressSize, candidateBody.dressSize, base.dressSize, existingBody.dressSize),
    clothingSize: firstAdultBodyValue(candidate.clothingSize, candidateBody.clothingSize, base.clothingSize, existingBody.clothingSize),
    hairColor: firstAdultBodyValue(candidate.hairColor, candidate.hair, candidateBody.hairColor, candidateBody.hair, base.hairColor, base.hair, existingBody.hairColor, existingBody.hair),
    eyeColor: firstAdultBodyValue(candidate.eyeColor, candidate.eyes, candidateBody.eyeColor, candidateBody.eyes, base.eyeColor, base.eyes, existingBody.eyeColor, existingBody.eyes),
    tattoos: Array.isArray(candidate.tattoos) ? candidate.tattoos : (Array.isArray(candidateBody.tattoos) ? candidateBody.tattoos : (Array.isArray(base.tattoos) ? base.tattoos : (Array.isArray(existingBody.tattoos) ? existingBody.tattoos : []))),
    piercings: Array.isArray(candidate.piercings) ? candidate.piercings : (Array.isArray(candidateBody.piercings) ? candidateBody.piercings : (Array.isArray(base.piercings) ? base.piercings : (Array.isArray(existingBody.piercings) ? existingBody.piercings : []))),
    sourceName,
    sourceUrl,
    confidence: firstAdultBodyValue(candidate.bodyConfidence, candidate.confidence, candidateBody.confidence, existingBody.confidence),
  };

  const compactBody = Object.fromEntries(
    Object.entries(bodyDetails).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  );

  if (!Object.keys(compactBody).length) return base;

  const confidence = compactBody.confidence || "low";
  compactBody.confidence = confidence;
  compactBody.lastFetchedAt = new Date().toISOString();

  return {
    ...base,
    height: compactBody.height || base.height || "",
    weight: compactBody.weight || base.weight || "",
    weightUnit: compactBody.weightUnit || base.weightUnit || "",
    measurements: compactBody.measurementsRaw || base.measurements || "",
    measurementsRaw: compactBody.measurementsRaw || base.measurementsRaw || "",
    bust: compactBody.bust || base.bust || "",
    waist: compactBody.waist || base.waist || "",
    hips: compactBody.hips || base.hips || "",
    braSize: compactBody.braSize || base.braSize || "",
    pantySize: compactBody.pantySize || base.pantySize || "",
    shoeSize: compactBody.shoeSize || base.shoeSize || "",
    dressSize: compactBody.dressSize || base.dressSize || "",
    clothingSize: compactBody.clothingSize || base.clothingSize || "",
    hairColor: compactBody.hairColor || base.hairColor || "",
    eyeColor: compactBody.eyeColor || base.eyeColor || "",
    tattoos: compactBody.tattoos?.length ? compactBody.tattoos : (base.tattoos || []),
    piercings: compactBody.piercings?.length ? compactBody.piercings : (base.piercings || []),
    clothingSizes: {
      ...(base.clothingSizes || {}),
      bra: compactBody.braSize || base.clothingSizes?.bra || base.braSize || "",
      panty: compactBody.pantySize || base.clothingSizes?.panty || base.pantySize || "",
      shoe: compactBody.shoeSize || base.clothingSizes?.shoe || base.shoeSize || "",
      dress: compactBody.dressSize || base.clothingSizes?.dress || base.dressSize || "",
      size: compactBody.clothingSize || base.clothingSizes?.size || base.clothingSize || "",
      source: compactBody.sourceName || base.clothingSizes?.source || "",
      confidence: compactBody.confidence || base.clothingSizes?.confidence || "low",
    },
    body: compactBody,
    bodyDetails: compactBody,
  };
}

function strictEncodeQuery(value = "") {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function searchOpenLibrary(query) {
  const encodedQuery = strictEncodeQuery(query);
  const url = `https://openlibrary.org/search.json?q=${encodedQuery}&limit=12`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Homestead/1.0",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `OpenLibrary returned ${response.status}`);
  }

  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs.map((book) => ({
    id: book.key,
    providerId: book.key,
    provider: "openlibrary",
    mediaType: "book",
    title: book.title || "Untitled",
    year: book.first_publish_year || null,
    releaseDate: book.first_publish_year
      ? String(book.first_publish_year)
      : "",
    authors: book.author_name || [],
    description: "",
    genres: book.subject ? book.subject.slice(0, 12) : [],
    poster: book.cover_i
      ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
      : "",
    backdrop: "",
    identifiers: {
      openLibraryId: book.key || null,
      isbn10: Array.isArray(book.isbn)
        ? book.isbn.find((isbn) => String(isbn).length === 10) || null
        : null,
      isbn13: Array.isArray(book.isbn)
        ? book.isbn.find((isbn) => String(isbn).length === 13) || null
        : null,
    },
    raw: book,
  }));
}

function getSeerrConfig() {
  const setupConfig = readSetupConfig();
  const seerr =
    setupConfig?.integrationSettings?.jellyseerr ||
    setupConfig?.integrations?.seerr ||
    {};

  return {
    baseUrl: seerr.url || process.env.SEERR_URL,
    apiKey: seerr.apiKey || process.env.SEERR_API_KEY,
  };
}

function getTubeArchivistConfig() {
  const setupConfig = readSetupConfig();

  const ta =
    setupConfig?.integrationSettings?.tubearchivist ||
    {};

  return {
    baseUrl: ta.url || process.env.TUBEARCHIVIST_URL || "",
    apiKey: ta.apiKey || process.env.TUBEARCHIVIST_API_KEY || "",
  };
}

async function downloadTubeArchivistAsset(assetPath, destinationPath) {
  if (!assetPath) return false;

  const { baseUrl, apiKey } = getTubeArchivistConfig();
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const assetUrl = assetPath.startsWith("http")
    ? assetPath
    : `${cleanBaseUrl}${assetPath}`;

  const response = await fetch(assetUrl, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  });

  if (!response.ok) {
    console.warn(`Failed to download TubeArchivist asset: ${assetUrl}`);
    return false;
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(destinationPath, buffer);

  return true;
}

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }

  if (!fs.existsSync(watchlistPath)) {
    fs.writeFileSync(
      watchlistPath,
      JSON.stringify(
        {
          movies: [],
          tv: [],
          books: [],
          music: [],
          youtube: [],
        },
        null,
        2
      )
    );
  }

  if (!fs.existsSync(namedWatchlistsPath)) {
    fs.writeFileSync(
      namedWatchlistsPath,
      JSON.stringify({ watchlists: [{ id: "my-watchlist", name: "My Watchlist", items: [] }] }, null, 2)
    );
  }

  if (!fs.existsSync(requestsPath)) {
    fs.writeFileSync(
      requestsPath,
      JSON.stringify(
        {
          movies: [],
          tv: [],
          books: [],
          music: [],
          youtube: [],
        },
        null,
        2
      )
    );
  }
}

function getLidarrConfig() {
  const setupConfig = readSetupConfig();

  return (
    setupConfig?.integrationSettings?.lidarr ||
    setupConfig?.integrations?.lidarr ||
    {}
  );
}

ensureDataFiles();


function normalizeNamedWatchlistId(value = "") {
  return String(value || "watchlist")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "watchlist";
}

function readNamedWatchlists() {
  try {
    const data = JSON.parse(fs.readFileSync(namedWatchlistsPath, "utf8"));
    return { watchlists: Array.isArray(data.watchlists) ? data.watchlists : [] };
  } catch {
    return { watchlists: [{ id: "my-watchlist", name: "My Watchlist", items: [] }] };
  }
}

function writeNamedWatchlists(data) {
  fs.writeFileSync(namedWatchlistsPath, JSON.stringify(data, null, 2));
}

app.get("/api/watchlists/named", (req, res) => {
  res.json({ ok: true, ...readNamedWatchlists() });
});

app.post("/api/watchlists/named", (req, res) => {
  try {
    const existing = readNamedWatchlists();
    const incoming = req.body || {};
    const name = String(incoming.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, message: "Watchlist name is required." });
    const id = String(incoming.id || normalizeNamedWatchlistId(name));
    const watchlist = {
      ...incoming,
      id,
      name,
      items: Array.isArray(incoming.items) ? incoming.items : [],
      updatedAt: new Date().toISOString(),
      createdAt: incoming.createdAt || new Date().toISOString(),
    };
    const index = existing.watchlists.findIndex((entry) => String(entry.id) === id);
    if (index >= 0) existing.watchlists[index] = watchlist;
    else existing.watchlists.push(watchlist);
    writeNamedWatchlists(existing);
    res.json({ ok: true, watchlist });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to save watchlist." });
  }
});

app.delete("/api/watchlists/named/:id", (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "Watchlist ID is required." });
    if (id === "my-watchlist") {
      return res.status(400).json({ ok: false, message: "The default My Watchlist cannot be deleted." });
    }

    const existing = readNamedWatchlists();
    const previousCount = existing.watchlists.length;
    existing.watchlists = existing.watchlists.filter((entry) => String(entry?.id) !== id);

    if (existing.watchlists.length === previousCount) {
      return res.status(404).json({ ok: false, message: "Watchlist not found." });
    }

    writeNamedWatchlists(existing);
    res.json({ ok: true, deletedId: id, watchlists: existing.watchlists });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to delete watchlist." });
  }
});

app.get("/api/watchlist", (req, res) => {
  const watchlist = JSON.parse(
    fs.readFileSync(watchlistPath, "utf8")
  );
  res.json(watchlist);
});

app.post("/api/watchlist", (req, res) => {
  fs.writeFileSync(
    watchlistPath,
    JSON.stringify(req.body, null, 2)
  );
  res.json(req.body);
});

function readRequests() {
  if (!fs.existsSync(requestsPath)) {
    return {
      movies: [],
      tv: [],
      books: [],
      music: [],
      youtube: [],
    };
  }

  try {
    return JSON.parse(fs.readFileSync(requestsPath, "utf8"));
  } catch {
    return {
      movies: [],
      tv: [],
      books: [],
      music: [],
      youtube: [],
    };
  }
}

app.get("/api/requests", (req, res) => {
  res.json(readRequests());
});

app.post("/api/requests", (req, res) => {
  const data = {
    movies: req.body.movies || [],
    tv: req.body.tv || [],
    books: req.body.books || [],
    music: req.body.music || [],
    youtube: req.body.youtube || [],
  };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(requestsPath, JSON.stringify(data, null, 2));

  res.json(data);
});

function resolveCaseInsensitivePath(candidate = "") {
  const normalized = path.normalize(String(candidate || ""));
  if (!normalized) return "";
  if (fs.existsSync(normalized)) return normalized;

  const parsed = path.parse(normalized);
  const parts = normalized
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);

  let current = parsed.root || path.sep;

  for (const part of parts) {
    if (!fs.existsSync(current)) return "";
    let entries = [];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return "";
    }

    const exact = entries.find((entry) => entry === part);
    const insensitive =
      exact ||
      entries.find(
        (entry) =>
          String(entry).toLowerCase() === String(part).toLowerCase()
      );

    if (!insensitive) return "";
    current = path.join(current, insensitive);
  }

  return fs.existsSync(current) ? current : "";
}

function resolveHomesteadFilePath(requestedPath = "") {
  const raw = String(requestedPath || "").trim();
  if (!raw) return "";

  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  const normalizedWebPath = decoded.replace(/\\/g, "/");
  const setupConfig = readSetupConfig();
  const mappings = setupConfig?.folderMappings || {};
  const mediaRoot = process.env.MEDIA_ROOT || "/media";
  const candidates = new Set([
    decoded,
    path.resolve(decoded),
  ]);

  const mediaMatch = normalizedWebPath.match(
    /^\/?media\/([^/]+)\/(.+)$/i
  );

  if (mediaMatch) {
    const librarySegment = String(mediaMatch[1] || "").trim();
    const relativePath = String(mediaMatch[2] || "").trim();
    const aliases = {
      performer: "performers",
      performers: "performers",
      personal: "personal",
      girls: "girls",
      celebrity: "celebrities",
      celebrities: "celebrities",
      movie: "movies",
      movies: "movies",
      tv: "tv",
      photo: "photos",
      photos: "photos",
    };
    const libraryKey =
      aliases[librarySegment.toLowerCase()] ||
      librarySegment;

    candidates.add(path.join(mediaRoot, librarySegment, relativePath));
    candidates.add(path.join(mediaRoot, libraryKey, relativePath));
    candidates.add(path.join(__dirname, "media", librarySegment, relativePath));
    candidates.add(path.join(__dirname, "media", libraryKey, relativePath));

    for (const mappedRoot of normalizeFolderList(mappings[libraryKey])) {
      candidates.add(path.join(mappedRoot, relativePath));
    }

    for (const adultRoot of normalizeFolderList(mappings.adult)) {
      candidates.add(
        path.join(adultRoot, librarySegment, relativePath)
      );
      candidates.add(path.join(adultRoot, libraryKey, relativePath));
    }
  } else if (/^\/?media\//i.test(normalizedWebPath)) {
    const relativePath = normalizedWebPath.replace(/^\/?media\//i, "");
    candidates.add(path.join(mediaRoot, relativePath));
    candidates.add(path.join(__dirname, "media", relativePath));
  }

  for (const candidate of candidates) {
    const resolved = resolveCaseInsensitivePath(candidate);
    if (resolved && fs.statSync(resolved).isFile()) return resolved;
  }

  return "";
}

function sendImagePlaceholder(res) {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720">
      <rect width="480" height="720" fill="#0d1119"/>
      <rect x="28" y="28" width="424" height="664" rx="24" fill="#151b27" stroke="#30384a" stroke-width="4"/>
      <circle cx="240" cy="290" r="78" fill="#252d3d"/>
      <path d="M112 594c18-104 82-164 128-164s110 60 128 164" fill="#252d3d"/>
      <text x="240" y="650" text-anchor="middle" fill="#7f8aa0" font-family="Arial,sans-serif" font-size="24">Image unavailable</text>
    </svg>`
  );
}

app.get("/api/file", (req, res) => {
  const filePath = String(req.query.path || "").trim();

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.setHeader("Cache-Control", "private, max-age=300");
  return res.sendFile(path.resolve(filePath));
});

const SCAN_LIBRARY_ALIASES = {
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
  personal: "personal",
  performer: "performers",
  performers: "performers",
  celebrity: "celebrities",
  celebrities: "celebrities",
  adult: "adult",
  adultphotos: "adultPhotos",
  "adult-photos": "adultPhotos",
  adultvideos: "adultVideos",
  "adult-videos": "adultVideos",
  all: "all",
  media: "all",
  bulk: "all",
};

function normalizeScanLibraryId(value = "") {
  const key = String(value || "")
    .trim()
    .replace(/^scan:/i, "")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();

  return SCAN_LIBRARY_ALIASES[key] || key || "all";
}

function normalizeScanFolders(folder, folders) {
  const list = [];

  if (folder) list.push(folder);

  if (Array.isArray(folders)) {
    list.push(...folders);
  } else if (typeof folders === "string") {
    list.push(...folders.split(/[\n;,]/));
  }

  return Array.from(
    new Set(
      list
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function buildScanCommands({ libraryId = "all", folder = "", folders = [], mode = "" } = {}) {
  const requestedLibrary = normalizeScanLibraryId(libraryId || mode || "all");
  const requestedMode = normalizeScanLibraryId(mode || "");
  const requestedFolders = normalizeScanFolders(folder, folders);
  const isBulkScan = requestedLibrary === "all" || requestedMode === "all" || requestedMode === "bulk";
  const commands = [];

  const addMediaScan = (args = []) => {
    commands.push({
      script: "scan-media.cjs",
      args,
    });
  };

  if (isBulkScan) {
    // Keep the dedicated YouTube index fresh before the shared media index imports it.
    commands.push({ script: "scan-youtube.js", args: [] });
    addMediaScan(["--all"]);
    return commands;
  }

  if (requestedLibrary === "youtube") {
    // YouTube has its own scanner, then scan-media syncs the generated youtube-index into media-index.
    commands.push({ script: "scan-youtube.js", args: [] });
    addMediaScan(["--library", "youtube"]);
    return commands;
  }

  const args = ["--library", requestedLibrary];
  for (const requestedFolder of requestedFolders) {
    args.push("--folder", requestedFolder);
  }

  addMediaScan(args);
  return commands;
}

function runScannerCommands(commands = [], callback) {
  const results = [];

  const runNext = (index = 0) => {
    const command = commands[index];
    if (!command) return callback(null, results);

    const scriptPath = path.join(__dirname, "scripts", "scanners", command.script);
    const nodeArgs = [scriptPath, ...(command.args || [])];

    console.log("Running scanner:", command.script, command.args || []);

    execFile("node", nodeArgs, (error, stdout = "", stderr = "") => {
      const result = {
        script: command.script,
        args: command.args || [],
        stdout,
        stderr,
      };
      results.push(result);

      if (error) {
        error.scannerResult = result;
        return callback(error, results);
      }

      runNext(index + 1);
    });
  };

  runNext(0);
}

app.post("/api/scan-library", (req, res) => {
  const { libraryId, folder, folders, mode } = req.body || {};
  const normalizedLibraryId = normalizeScanLibraryId(libraryId || mode || "all");
  const requestedFolders = normalizeScanFolders(folder, folders);
  const commands = buildScanCommands({ libraryId, folder, folders, mode });

  console.log("Scan requested:", {
    libraryId,
    normalizedLibraryId,
    folder,
    folders,
    requestedFolders,
    mode,
    commands,
  });

  runScannerCommands(commands, (scanErr, results = []) => {
    if (scanErr) {
      console.error("Media scan failed:", scanErr);

      return res.status(500).json({
        ok: false,
        error: scanErr.message,
        libraryId: normalizedLibraryId,
        folder,
        folders: requestedFolders,
        mode,
        results,
      });
    }

    const mediaIndex = readJsonFile(path.join(dataDir, "media-index.json"), {});

    res.json({
      ok: true,
      message: "Scan completed",
      libraryId: normalizedLibraryId,
      folder,
      folders: requestedFolders,
      mode,
      commands,
      results,
      scanHistory: mediaIndex.scanHistory || {},
      generatedAt: mediaIndex.generatedAt || null,
      mediaIndex: {
        generatedAt: mediaIndex.generatedAt || null,
        scanHistory: mediaIndex.scanHistory || {},
      },
    });
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "test route works"
  });
});

app.get("/api/integrations/seerr/debug", (req, res) => {
  res.json({
    ok: true,
    seerrUrl: process.env.SEERR_URL || null,
    hasApiKey: !!process.env.SEERR_API_KEY,
  });
});

app.get("/api/integrations/tubearchivist/status", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getTubeArchivistConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing TubeArchivist URL or API key",
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");

    const response = await fetch(`${cleanBaseUrl}/api/ping/`, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.detail ||
          data.message ||
          `TubeArchivist returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      app: "TubeArchivist",
      message: "Connected to TubeArchivist",
      data,
    });
  } catch (error) {
    console.error("TubeArchivist status failed:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/tubearchivist/channels", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getTubeArchivistConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing TubeArchivist URL or API key",
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");

    const response = await fetch(`${cleanBaseUrl}/api/channel/`, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.detail ||
          data.message ||
          `TubeArchivist returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      channels: data.data || data.results || [],
      data,
    });
  } catch (error) {
    console.error("TubeArchivist channels failed:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/youtube/search/channels", async (req, res) => {
  try {
    const query = req.query.q;

    const config = readSetupConfig();

    const youtubeApiKey =
      config?.integrationSettings?.tubearchivist?.youtubeApiKey || "";

    if (!youtubeApiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing YouTube API key",
      });
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=10&q=${encodeURIComponent(
        query
      )}&key=${youtubeApiKey}`
    );

    const data = await response.json();

    res.json({
      ok: true,
      results: (data.items || []).map((item) => ({
        id: item.id.channelId,
        title: item.snippet.title,
        thumbnail:
          item.snippet.thumbnails?.default?.url || "",
        subtitle: "YouTube Creator",
        type: "youtube-discover",
      })),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/youtube/channel/:channelId/playlists", async (req, res) => {
  try {
    const { channelId } = req.params;

    const config = readSetupConfig();

console.log(
  "TUBEARCHIVIST SETTINGS:",
  JSON.stringify(config?.integrationSettings?.tubearchivist, null, 2)
);

    const youtubeApiKey =
      config?.integrationSettings?.tubearchivist?.youtubeApiKey ||
      process.env.YOUTUBE_API_KEY ||
      "";

    if (!youtubeApiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing YouTube API key",
      });
    }

    let playlists = [];
    let pageToken = "";

    do {
      const url =
        "https://www.googleapis.com/youtube/v3/playlists" +
        `?part=snippet,contentDetails` +
        `&channelId=${encodeURIComponent(channelId)}` +
        `&maxResults=50` +
        (pageToken ? `&pageToken=${pageToken}` : "") +
        `&key=${encodeURIComponent(youtubeApiKey)}`;

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          message:
            data?.error?.message ||
            `YouTube returned ${response.status}`,
          data,
        });
      }

      playlists = playlists.concat(
        (data.items || []).map((item) => ({
          playlistId: item.id,
          title: item.snippet?.title || "Untitled Playlist",
          description: item.snippet?.description || "",
          thumbnail:
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            "",
          videoCount: item.contentDetails?.itemCount || 0,
          channelId,
          source: "youtube",
          playlistUrl: `https://www.youtube.com/playlist?list=${item.id}`,
        }))
      );

      pageToken = data.nextPageToken || "";
    } while (pageToken);

    res.json({
      ok: true,
      channelId,
      playlists,
    });
  } catch (error) {
    console.error("Failed to fetch YouTube playlists:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get(
  "/api/integrations/tubearchivist/channel/:channelId/playlists",
  async (req, res) => {
    try {
      const { channelId } = req.params;

      const { baseUrl, apiKey } =
        getTubeArchivistConfig();

      const cleanBaseUrl =
        baseUrl.replace(/\/$/, "");

      const response = await fetch(
        `${cleanBaseUrl}/api/playlist/`,
        {
          headers: {
            Authorization: `Token ${apiKey}`,
          },
        }
      );

      const data =
        await response.json();

      res.json({
        ok: true,
        data,
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        message: error.message,
      });
    }
  }
);

app.post("/api/integrations/tubearchivist/playlist/:playlistId/wanted", async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { baseUrl, apiKey } = getTubeArchivistConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing TubeArchivist URL or API key",
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");

    const response = await fetch(`${cleanBaseUrl}/api/playlist/${playlistId}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({
        playlist_subscribed: true,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.detail ||
          data.message ||
          `TubeArchivist returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      playlistId,
      data,
    });
  } catch (error) {
    console.error("Failed to mark playlist wanted:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/tubearchivist/download-playlist", async (req, res) => {
  try {
    const { playlistUrl, playlist } = req.body || {};
    const { baseUrl, apiKey } = getTubeArchivistConfig();

    if (!playlistUrl) {
      return res.status(400).json({
        ok: false,
        message: "Missing playlist URL",
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");

    const payload = {
      data: [
        {
          youtube_id: playlistUrl,
          status: "pending",
        },
      ],
    };

    console.log("Sending playlist to TubeArchivist:", {
      title: playlist?.title,
      playlistUrl,
      payload,
    });

    const response = await fetch(`${cleanBaseUrl}/api/download/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    console.log("TubeArchivist download response:", {
      status: response.status,
      ok: response.ok,
      data,
    });

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.detail ||
          data.message ||
          `TubeArchivist returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      playlistUrl,
      playlistTitle: playlist?.title,
      data,
    });
  } catch (error) {
    console.error("Failed to send playlist to TubeArchivist:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/tubearchivist/start-download", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getTubeArchivistConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing TubeArchivist URL or API key",
      });
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");

    const response = await fetch(
      `${cleanBaseUrl}/api/task/by-name/download_pending/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${apiKey}`,
        },
        body: JSON.stringify({}),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.detail ||
          data.message ||
          `TubeArchivist returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      message: "TubeArchivist download task started",
      data,
    });
  } catch (error) {
    console.error("Failed to start TubeArchivist download:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/tubearchivist/start-download-delayed", async (req, res) => {
  try {
    const delayMinutes = Number(req.body?.delayMinutes || 5);
    const delayMs = delayMinutes * 60 * 1000;

    setTimeout(async () => {
      try {
        const { baseUrl, apiKey } = getTubeArchivistConfig();
        const cleanBaseUrl = baseUrl.replace(/\/$/, "");

        await fetch(`${cleanBaseUrl}/api/task/by-name/download_pending/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${apiKey}`,
          },
          body: JSON.stringify({}),
        });

        console.log(`TubeArchivist delayed download started after ${delayMinutes} minutes.`);
      } catch (error) {
        console.error("Delayed TubeArchivist download failed:", error);
      }
    }, delayMs);

    res.json({
      ok: true,
      message: `Download will start in ${delayMinutes} minutes.`,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/tubearchivist/import-channel", async (req, res) => {
  try {
    const channel = req.body?.channel;

    if (!channel?.channel_name) {
      return res.status(400).json({
        ok: false,
        message: "Missing channel data",
      });
    }

    const safeName = channel.channel_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

const config = readSetupConfig();

const youtubeFolders =
  config?.folderMappings?.youtube || [];

const youtubeRoot = Array.isArray(youtubeFolders)
  ? youtubeFolders[0]
  : youtubeFolders;

const creatorDir = path.join(
  youtubeRoot,
  "creators",
  channel.channel_name
);

    fs.mkdirSync(creatorDir, {
      recursive: true,
    });

const metadata = {
  name: channel.channel_name,
  displayName: channel.channel_name,
  channelId: channel.channel_id || "",
  description: channel.channel_description || "",
  subscribers: channel.channel_subs || 0,
  videoCount: channel.channel_vids || 0,
  tags: channel.channel_tags || [],
  source: "tubearchivist",
  youtubeUrl: channel.channel_id
    ? `https://www.youtube.com/channel/${channel.channel_id}`
    : "",
  importRules: {
    creatorMetadata: true,
    importMode: "selectedPlaylistsOnly",
    importAllVideos: false,
    selectedPlaylists: [],
  },
  importedAt: new Date().toISOString(),
};

    fs.writeFileSync(
      path.join(creatorDir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

const posterDownloaded = await downloadTubeArchivistAsset(
  channel.channel_thumb_url,
  path.join(creatorDir, "poster.jpg")
);

const bannerDownloaded = await downloadTubeArchivistAsset(
  channel.channel_banner_url,
  path.join(creatorDir, "banner.jpg")
);

res.json({
  ok: true,
  creator: safeName,
  folder: creatorDir,
  metadata,
  artwork: {
    poster: posterDownloaded,
    banner: bannerDownloaded,
  },
});
  } catch (error) {
    console.error(
      "TubeArchivist import failed:",
      error
    );

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/tubearchivist/save-playlists", async (req, res) => {
  try {
    const { channel, playlists } = req.body || {};

    if (!channel?.channel_name) {
      return res.status(400).json({
        ok: false,
        message: "Missing channel data",
      });
    }

    if (!Array.isArray(playlists)) {
      return res.status(400).json({
        ok: false,
        message: "Missing playlists",
      });
    }

    const config = readSetupConfig();

    const youtubeFolders =
      config?.folderMappings?.youtube || [];

    const youtubeRoot = Array.isArray(youtubeFolders)
      ? youtubeFolders[0]
      : youtubeFolders;

    const creatorDir = path.join(
      youtubeRoot,
      "creators",
      channel.channel_name
    );

    fs.mkdirSync(creatorDir, {
      recursive: true,
    });

    const metadataPath = path.join(
      creatorDir,
      "metadata.json"
    );

    let existingMetadata = {};

    if (fs.existsSync(metadataPath)) {
      existingMetadata = JSON.parse(
        fs.readFileSync(metadataPath, "utf8")
      );
    }

    const updatedMetadata = {
      ...existingMetadata,

      name:
        existingMetadata.name ||
        channel.channel_name,

      displayName:
        existingMetadata.displayName ||
        channel.channel_name,

      channelId:
        channel.channel_id ||
        existingMetadata.channelId ||
        "",

      description:
        existingMetadata.description ||
        channel.channel_description ||
        "",

      subscribers:
        channel.channel_subs || 0,

      videoCount:
        channel.channel_vids || 0,

      source: "tubearchivist",

      youtubeUrl:
        existingMetadata.youtubeUrl ||
        (channel.channel_id
          ? `https://www.youtube.com/channel/${channel.channel_id}`
          : ""),

      importRules: {
        creatorMetadata: true,
        importMode: "selectedPlaylistsOnly",
        importAllVideos: false,

        selectedPlaylists: playlists.map(
          (playlist) => ({
            id: playlist.playlist_id,
            name: playlist.playlist_name,
            videoCount:
              playlist.playlist_entries?.length || 0,
          })
        ),
      },

      updatedAt: new Date().toISOString(),
      ownerProfileId: profileId || null,
      ownerProfileName: profileName,
      ownershipStatus: "assigned",
    };

    fs.writeFileSync(
      metadataPath,
      JSON.stringify(updatedMetadata, null, 2)
    );

    res.json({
      ok: true,
      creator: channel.channel_name,
      metadataPath,
      selectedPlaylists:
        updatedMetadata.importRules.selectedPlaylists,
    });
  } catch (error) {
    console.error(
      "Failed to save TubeArchivist playlists:",
      error
    );

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/status", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing SEERR_URL or SEERR_API_KEY",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: `Seerr returned ${response.status}`,
      });
    }

    const data = await response.json();

console.log(
  "RAW JELLYSEERR RESULT",
  JSON.stringify(data.results?.[0], null, 2)
);

    res.json({
      ok: true,
      app: data.appData?.appTitle || data.appTitle || "Seerr",
      version: data.version || data.commitTag || "unknown",
      data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/requests", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing SEERR_URL or SEERR_API_KEY",
      });
    }

    const response = await fetch(
      `${baseUrl}/api/v1/request?take=20&skip=0&sort=added`,
      {
        headers: {
          "X-Api-Key": apiKey,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: `Seerr returned ${response.status}`,
      });
    }

    const data = await response.json();

    const enrichedRequests = await Promise.all(
      (data.results || []).map(async (r) => {
        const tmdbId = r.media?.tmdbId;
        const type = r.type || r.media?.mediaType;

        let details = {};

        if (tmdbId && (type === "movie" || type === "tv")) {
          try {
            const detailResponse = await fetch(
              `${baseUrl}/api/v1/${type}/${tmdbId}`,
              {
                headers: {
                  "X-Api-Key": apiKey,
                },
              }
            );

            if (detailResponse.ok) {
              details = await detailResponse.json();
            }
          } catch (detailError) {
            console.warn(
              `Failed to fetch Seerr ${type} details for ${tmdbId}:`,
              detailError.message
            );
          }
        }

        const title =
          details.title ||
          details.name ||
          details.originalTitle ||
          details.originalName ||
          r.media?.title ||
          r.media?.name ||
          r.media?.tmdbId ||
          tmdbId;

        const posterPath =
          details.posterPath ||
          details.poster_path ||
          r.media?.posterPath ||
          r.media?.poster_path;

        const backdropPath =
          details.backdropPath ||
          details.backdrop_path ||
          r.media?.backdropPath ||
          r.media?.backdrop_path;

        return {
          id: r.id,
          type,
          status: r.status,
          tmdbId,
          serviceUrl: r.media?.serviceUrl,
          createdAt: r.createdAt,

          title,

          poster: posterPath
            ? `https://image.tmdb.org/t/p/w500${posterPath}`
            : "/placeholder-poster.jpg",

          backdrop: backdropPath
            ? `https://image.tmdb.org/t/p/original${backdropPath}`
            : null,

          overview: details.overview || "",
          year:
            (details.releaseDate ||
              details.firstAirDate ||
              details.release_date ||
              details.first_air_date ||
              "").slice(0, 4),
        };
      })
    );

    res.json({
      ok: true,
      total: data.pageInfo?.results || data.results?.length || 0,
      requests: enrichedRequests,
      data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/seerr/request/movie", async (req, res) => {
  try {
    const { tmdbId } = req.body;
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    if (!tmdbId) {
      return res.status(400).json({
        ok: false,
        message: "Missing tmdbId",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        mediaType: "movie",
        mediaId: Number(tmdbId),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || data.error || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      message: "Movie request sent",
      data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/integrations/seerr/request/tv", async (req, res) => {
  try {
    const { tmdbId } = req.body;
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    if (!tmdbId) {
      return res.status(400).json({
        ok: false,
        message: "Missing tmdbId",
      });
    }

const tvDetailsResponse = await fetch(`${baseUrl}/api/v1/tv/${tmdbId}`, {
  headers: {
    "X-Api-Key": apiKey,
  },
});

const tvDetails = await tvDetailsResponse.json().catch(() => ({}));

const seasons = (tvDetails.seasons || [])
  .map((season) => season.seasonNumber ?? season.season_number)
  .filter((seasonNumber) => Number(seasonNumber) > 0);

const response = await fetch(`${baseUrl}/api/v1/request`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
  },
  body: JSON.stringify({
    mediaType: "tv",
    mediaId: Number(tmdbId),
    seasons,
  }),
});

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message:
          data.message ||
          data.error ||
          `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      message: "TV request sent",
      data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/profiles/personal", (req, res) => {
  try {
    const profile = req.body;

    if (!profile.name || !profile.name.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Name is required",
      });
    }

    const safeId = profile.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const profileDir = path.join(
      __dirname,
      "media",
      "personal",
      safeId
    );

    fs.mkdirSync(profileDir, { recursive: true });

    [
      "photos",
      "videos",
      "documents",
      "notes",
      "nude",
      "sex/photos",
      "sex/videos",
      "keepsakes",
      "places",
      "ai"
    ].forEach((folder) => {
      fs.mkdirSync(path.join(profileDir, folder), { recursive: true });
    });

    const metadata = {
      id: safeId,
      name: profile.name,
      library: "personal",
      status: "Unassigned",
      poster: `/media/personal/${safeId}/poster.jpg`,
      banner: `/media/personal/${safeId}/banner.jpg`,
      headshot: `/media/personal/${safeId}/headshot.jpg`,
      summary: "Created from Homestead add profile form.",

      metadata: {
        relationshipStatus: "Unassigned",
        birthday: profile.birthday || "",
        braSize: profile.braSize || "",
        pantySize: profile.pantySize || "",
        notes: "",
      },

      relationships: {
        children: [],
      },

    };

    fs.writeFileSync(
      path.join(profileDir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

runMediaScan("adult");

    res.json({
      ok: true,
      id: safeId,
      folder: profileDir,
      metadata,
    });
  } catch (err) {
    console.error("Failed to create girl profile:", err);

    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});


function sanitizeAdultLooseMediaSegment(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120) || "New Folder";
}

function getAdultLooseMediaRoot(library = "adultPhotos") {
  const safeLibrary = library === "adultVideos" ? "adultVideos" : "adultPhotos";
  const setup = readSetupConfig();
  const mapped = setup?.folderMappings?.[safeLibrary];
  const first = Array.isArray(mapped) ? mapped.find(Boolean) : mapped;
  const fallback = safeLibrary === "adultVideos" ? "/media/adult/videos" : "/media/adult/photos";
  return path.resolve(String(first || fallback));
}

function getAdultLooseMediaFolder(library, folderName) {
  const root = getAdultLooseMediaRoot(library);
  const safeFolder = sanitizeAdultLooseMediaSegment(folderName);
  const target = path.resolve(root, safeFolder);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid adult media folder path.");
  }
  return { root, target, safeFolder };
}

const ADULT_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic", ".heif"]);
const ADULT_VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi", ".wmv", ".ts", ".m2ts"]);

function listAdultLooseMediaFiles(folderPath, library) {
  const expectedType = library === "adultVideos" ? "video" : "image";
  const files = [];

  function walk(currentPath) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      const type = ADULT_IMAGE_EXTENSIONS.has(extension)
        ? "image"
        : ADULT_VIDEO_EXTENSIONS.has(extension)
          ? "video"
          : "file";
      if (type !== expectedType) continue;

      let stats = null;
      try { stats = fs.statSync(absolutePath); } catch {}
      files.push({
        id: absolutePath,
        name: entry.name,
        type,
        sourcePath: absolutePath,
        path: absolutePath,
        size: stats?.size || 0,
        modifiedAt: stats?.mtime?.toISOString?.() || "",
      });
    }
  }

  walk(folderPath);
  return files.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
}

app.get("/api/adult/media-folders", (req, res) => {
  try {
    const library = req.query?.library === "adultVideos" ? "adultVideos" : "adultPhotos";
    const root = getAdultLooseMediaRoot(library);
    fs.mkdirSync(root, { recursive: true });

    const folders = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const folderPath = path.join(root, entry.name);
        const files = listAdultLooseMediaFiles(folderPath, library);
        return {
          id: folderPath,
          name: entry.name,
          title: entry.name,
          sourcePath: folderPath,
          folderPath,
          path: folderPath,
          files,
          itemCount: files.length,
          counts: {
            images: files.filter((file) => file.type === "image").length,
            videos: files.filter((file) => file.type === "video").length,
          },
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));

    res.json({ ok: true, library, root, folders });
  } catch (error) {
    console.error("Failed to list adult media folders:", error);
    res.status(500).json({ ok: false, error: error.message || "Unable to list adult media folders." });
  }
});

app.post("/api/adult/media-folders", (req, res) => {
  try {
    const library = req.body?.library === "adultVideos" ? "adultVideos" : "adultPhotos";
    const { target, safeFolder } = getAdultLooseMediaFolder(library, req.body?.folderName);
    fs.mkdirSync(target, { recursive: true });
    runMediaScan(library);
    res.json({ ok: true, library, folderName: safeFolder, path: target });
  } catch (error) {
    console.error("Failed to create adult media folder:", error);
    res.status(400).json({ ok: false, error: error.message || "Unable to create folder." });
  }
});

app.post("/api/adult/media-upload", (req, res) => {
  try {
    const library = req.body?.library === "adultVideos" ? "adultVideos" : "adultPhotos";
    const { target } = getAdultLooseMediaFolder(library, req.body?.folderName);
    const fileName = sanitizeAdultLooseMediaSegment(req.body?.fileName || "upload");
    const extension = path.extname(String(req.body?.fileName || ""));
    const safeBase = sanitizeAdultLooseMediaSegment(path.basename(fileName, path.extname(fileName)) || "upload");
    const normalizedExtension = extension && /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : "";
    const finalName = `${safeBase}${normalizedExtension}`;
    const base64 = String(req.body?.base64 || "").replace(/^data:[^;]+;base64,/, "");

    if (!base64) return res.status(400).json({ ok: false, error: "No file data was supplied." });

    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) return res.status(400).json({ ok: false, error: "The uploaded file was empty." });
    if (buffer.length > 20 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: "Each imported file must be 20 MB or smaller." });
    }

    fs.mkdirSync(target, { recursive: true });
    let destination = path.join(target, finalName);
    if (fs.existsSync(destination)) {
      const suffix = Date.now();
      destination = path.join(target, `${safeBase}-${suffix}${normalizedExtension}`);
    }
    fs.writeFileSync(destination, buffer);
    runMediaScan(library);
    res.json({ ok: true, library, path: destination, size: buffer.length });
  } catch (error) {
    console.error("Failed to upload adult media:", error);
    res.status(400).json({ ok: false, error: error.message || "Unable to import media." });
  }
});



const LIBRARY_IMPORT_KEYS = new Set([
  "movies", "tvshows", "music", "books", "youtube", "photos",
  "family", "inventory", "cloud", "adultPhotos", "adultVideos",
]);

function sanitizeLibraryImportSegment(value = "") {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 180);
}

function getConfiguredLibraryRoots(library) {
  if (!LIBRARY_IMPORT_KEYS.has(library)) throw new Error("Unsupported library import target.");
  const setup = readSetupConfig();
  const mapped = setup?.folderMappings?.[library];
  const roots = (Array.isArray(mapped) ? mapped : mapped ? [mapped] : [])
    .map((value) => path.resolve(String(value || "")))
    .filter(Boolean);
  if (!roots.length) throw new Error(`No folder is configured for ${library}.`);
  return [...new Set(roots)];
}

function resolveLibraryImportDestination({ library, rootPath, subfolder = "" }) {
  const roots = getConfiguredLibraryRoots(library);
  const requestedRoot = rootPath ? path.resolve(String(rootPath)) : roots[0];
  const root = roots.find((candidate) => candidate === requestedRoot);
  if (!root) throw new Error("The selected destination is not a configured library folder.");

  const parts = String(subfolder || "")
    .split(/[\\/]+/)
    .map(sanitizeLibraryImportSegment)
    .filter(Boolean);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid library destination.");
  }
  return { root, target, relativePath: parts.join("/") };
}

app.post("/api/library/import-folder", (req, res) => {
  try {
    const library = String(req.body?.library || "");
    const destination = resolveLibraryImportDestination({
      library,
      rootPath: req.body?.rootPath,
      subfolder: req.body?.subfolder,
    });
    if (!destination.relativePath) return res.status(400).json({ ok: false, error: "Enter a subfolder name." });
    fs.mkdirSync(destination.target, { recursive: true });
    runMediaScan(library);
    res.json({ ok: true, library, path: destination.target, relativePath: destination.relativePath });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Unable to create library folder." });
  }
});

app.post("/api/library/import-file", express.raw({ type: "application/octet-stream", limit: "10gb" }), (req, res) => {
  try {
    const library = String(req.query?.library || "");
    const destination = resolveLibraryImportDestination({
      library,
      rootPath: req.query?.rootPath,
      subfolder: req.query?.subfolder,
    });
    const originalName = String(req.query?.fileName || "upload");
    const extension = path.extname(originalName).replace(/[^.a-z0-9]/gi, "").slice(0, 12);
    const baseName = sanitizeLibraryImportSegment(path.basename(originalName, path.extname(originalName))) || "upload";
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!buffer.length) return res.status(400).json({ ok: false, error: "The uploaded file was empty." });

    fs.mkdirSync(destination.target, { recursive: true });
    let finalName = `${baseName}${extension}`;
    let finalPath = path.join(destination.target, finalName);
    if (fs.existsSync(finalPath)) {
      finalName = `${baseName}-${Date.now()}${extension}`;
      finalPath = path.join(destination.target, finalName);
    }
    fs.writeFileSync(finalPath, buffer);
    runMediaScan(library);
    res.json({ ok: true, library, path: finalPath, size: buffer.length, relativePath: destination.relativePath });
  } catch (error) {
    console.error("Library import failed:", error);
    res.status(400).json({ ok: false, error: error.message || "Unable to import file." });
  }
});


app.post("/api/adult/photos/move-to-profile", async (req, res) => {
  try {
    const { sourceFolder, library, profileId } = req.body;

    if (!sourceFolder || !library || !profileId) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields.",
      });
    }

    const destination = path.join(
      "/media/adult",
      library,
      profileId,
      "photos",
      path.basename(sourceFolder)
    );

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    fs.renameSync(sourceFolder, destination);

    runMediaScan("adult");

    res.json({
      ok: true,
      destination,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

function safeProfileLibrary(library) {
  const allowed = ["personal", "performers", "celebrities"];
  return allowed.includes(library) ? library : null;
}

function runMediaScan(libraryId = "all", options = {}) {
  const commands = buildScanCommands({
    libraryId,
    folder: options.folder || "",
    folders: options.folders || [],
    mode: options.mode || "",
  });

  runScannerCommands(commands, (scanErr) => {
    if (scanErr) console.error("Media scan failed:", scanErr);
  });
}

app.post("/api/adult/photos/move-to-profile", (req, res) => {
  try {
    const { sourcePath, targetLibrary, profileName } = req.body;

    const safeLibrary = safeProfileLibrary(targetLibrary);

    if (!sourcePath || !safeLibrary || !profileName) {
      return res.status(400).json({
        ok: false,
        error: "Missing sourcePath, targetLibrary, or profileName.",
      });
    }

    const albumName = path.basename(sourcePath);

    const destination = path.join(
      "/media/adult",
      safeLibrary,
      profileName,
      "photos",
      albumName
    );

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(sourcePath, destination);

    runMediaScan();

    res.json({ ok: true, sourcePath, destination });
  } catch (err) {
    console.error("Failed to move adult photo album:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/adult/videos/move-to-profile", (req, res) => {
  try {
    const { sourcePath, targetLibrary, profileName } = req.body;

    const safeLibrary = safeProfileLibrary(targetLibrary);

    if (!sourcePath || !safeLibrary || !profileName) {
      return res.status(400).json({
        ok: false,
        error: "Missing sourcePath, targetLibrary, or profileName.",
      });
    }

    const fileName = path.basename(sourcePath);

    const destination = path.join(
      "/media/adult",
      safeLibrary,
      profileName,
      "scenes",
      fileName
    );

    fs.mkdirSync(path.dirname(destination), { recursive: true });
	
	if (!fs.existsSync(sourcePath)) {
  return res.status(404).json({
    ok: false,
    error: `Source file no longer exists: ${sourcePath}`,
  });
}
    fs.renameSync(sourcePath, destination);

    runMediaScan();

    res.json({ ok: true, sourcePath, destination });
  } catch (err) {
    console.error("Failed to move adult video:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve the active Homestead branding before static Vite/PWA assets so an
// installed desktop/mobile app never falls back to the default Vite lightning icon.
app.get([
  "/vite.svg",
  "/vite.png",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
], sendHomesteadBrandIcon);
app.get([
  "/manifest.webmanifest",
  "/site.webmanifest",
  "/manifest.json",
], sendHomesteadManifest);

app.use("/media", express.static("/media"));
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
app.use("/icons", express.static(path.join(__dirname, "public", "icons")));

function normalizeProfileIdentity(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function profileIdentityKeys(profile = {}) {
  const keys = new Set();

  const pathCandidates = [
    profile.profileDir,
    profile.folderPath,
    profile.sourcePath,
    profile.path,
    profile.metadataPath
      ? path.dirname(profile.metadataPath)
      : "",
  ];

  pathCandidates
    .filter(Boolean)
    .forEach((candidate) =>
      keys.add(`path:${normalizeProfileIdentity(candidate)}`)
    );

  const idCandidates = [
    profile.id,
    profile.folderName,
    profile.slug,
  ];

  idCandidates
    .filter(Boolean)
    .forEach((candidate) =>
      keys.add(`id:${slugifyAdultProfileName(candidate)}`)
    );

  const nameCandidates = [
    profile.name,
    profile.title,
    profile.displayName,
  ];

  nameCandidates
    .filter(Boolean)
    .forEach((candidate) =>
      keys.add(`name:${slugifyAdultProfileName(candidate)}`)
    );

  return [...keys].filter(
    (key) => !key.endsWith(":")
  );
}


function resolveProfilePosterCandidate(profileDir = "", value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) {
    return raw;
  }

  if (/^\/media\//i.test(raw)) {
    const resolved = resolveHomesteadFilePath(raw);
    return resolved || raw;
  }

  const candidates = [
    raw,
    path.isAbsolute(raw) ? raw : "",
    profileDir ? path.join(profileDir, raw) : "",
    profileDir ? path.join(profileDir, path.basename(raw)) : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = resolveCaseInsensitivePath(candidate);
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  return "";
}

function discoverProfilePoster(profileDir = "") {
  if (!profileDir || !fs.existsSync(profileDir)) return "";

  const preferredNames = [
    "poster.jpg",
    "poster.jpeg",
    "poster.png",
    "poster.webp",
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",
    "profile.jpg",
    "profile.jpeg",
    "profile.png",
    "profile.webp",
    "headshot.jpg",
    "headshot.jpeg",
    "headshot.png",
    "headshot.webp",
  ];

  for (const name of preferredNames) {
    const resolved = resolveCaseInsensitivePath(path.join(profileDir, name));
    if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  const candidateFolders = [
    profileDir,
    path.join(profileDir, "photos"),
    path.join(profileDir, "images"),
    path.join(profileDir, "nudes"),
  ];

  for (const folder of candidateFolders) {
    if (!fs.existsSync(folder)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }

    const firstImage = entries.find(
      (entry) =>
        entry.isFile() &&
        /\.(jpe?g|png|webp|gif|avif)$/i.test(entry.name)
    );

    if (firstImage) return path.join(folder, firstImage.name);
  }

  return "";
}

function chooseProfilePoster(profileDir = "", ...values) {
  for (const value of values) {
    const resolved = resolveProfilePosterCandidate(profileDir, value);
    if (resolved) return resolved;
  }

  return discoverProfilePoster(profileDir);
}

function mergeProfileRecords(primary = {}, incoming = {}) {
  return {
    ...incoming,
    ...primary,
    id:
      primary.id ||
      incoming.id ||
      primary.folderName ||
      incoming.folderName ||
      slugifyAdultProfileName(
        primary.name ||
          incoming.name ||
          primary.title ||
          incoming.title ||
          ""
      ),
    name:
      primary.name ||
      incoming.name ||
      primary.title ||
      incoming.title ||
      "",
    title:
      primary.title ||
      incoming.title ||
      primary.name ||
      incoming.name ||
      "",
    profileDir:
      primary.profileDir ||
      primary.folderPath ||
      primary.sourcePath ||
      primary.path ||
      incoming.profileDir ||
      incoming.folderPath ||
      incoming.sourcePath ||
      incoming.path ||
      "",
    folderPath:
      primary.folderPath ||
      primary.profileDir ||
      incoming.folderPath ||
      incoming.profileDir ||
      "",
    sourcePath:
      primary.sourcePath ||
      primary.profileDir ||
      incoming.sourcePath ||
      incoming.profileDir ||
      "",
    path:
      primary.path ||
      primary.profileDir ||
      incoming.path ||
      incoming.profileDir ||
      "",
    metadataPath:
      primary.metadataPath ||
      primary.metadataFile ||
      incoming.metadataPath ||
      incoming.metadataFile ||
      "",
    poster: chooseProfilePoster(
      primary.profileDir ||
        primary.folderPath ||
        primary.sourcePath ||
        primary.path ||
        incoming.profileDir ||
        incoming.folderPath ||
        incoming.sourcePath ||
        incoming.path ||
        "",
      primary.poster,
      primary.posterPath,
      primary.image,
      primary.thumbnail,
      incoming.poster,
      incoming.posterPath,
      incoming.image,
      incoming.thumbnail
    ),
    updatedAt:
      primary.updatedAt ||
      incoming.updatedAt ||
      "",
  };
}

function dedupeProfileLibrary(records = {}) {
  const output = {};
  const identityToKey = new Map();

  Object.entries(
    records && typeof records === "object" ? records : {}
  ).forEach(([recordKey, rawRecord]) => {
    const record =
      rawRecord && typeof rawRecord === "object"
        ? { ...rawRecord }
        : {};
    const candidate = {
      ...record,
      id: record.id || recordKey,
    };
    const identities = profileIdentityKeys(candidate);

    let existingKey = "";
    for (const identity of identities) {
      if (identityToKey.has(identity)) {
        existingKey = identityToKey.get(identity);
        break;
      }
    }

    if (!existingKey) {
      const canonicalKey =
        candidate.id ||
        candidate.folderName ||
        slugifyAdultProfileName(
          candidate.name || candidate.title || recordKey
        ) ||
        recordKey;

      output[canonicalKey] = candidate;
      identities.forEach((identity) =>
        identityToKey.set(identity, canonicalKey)
      );
      return;
    }

    output[existingKey] = mergeProfileRecords(
      output[existingKey],
      candidate
    );

    profileIdentityKeys(output[existingKey]).forEach(
      (identity) => identityToKey.set(identity, existingKey)
    );
  });

  return output;
}

function buildLiveMediaIndex() {
  const indexPath = path.join(
    __dirname,
    "data",
    "media-index.json"
  );
  const index = readJsonFile(indexPath, {});
  const libraries = {
    ...(index.libraries || {}),
  };

  for (const libraryType of [
    "personal",
    "performers",
    "celebrities",
  ]) {
    const combined = {
      ...(libraries[libraryType] || {}),
    };

    for (const row of listAdultProfileDirs(libraryType)) {
      const id =
        row.folderName ||
        slugifyAdultProfileName(row.name || "");
      if (!id) continue;

      const metadataPath = path.join(
        row.profileDir,
        "metadata.json"
      );
      const metadata =
        row.file && typeof row.file === "object"
          ? row.file
          : row.metadata || {};

      const existing = combined[id] || {};

      combined[id] = mergeProfileRecords(
        {
          ...metadata,
          ...existing,
          id,
          name:
            metadata.name ||
            existing.name ||
            row.name ||
            id,
          title:
            metadata.title ||
            metadata.name ||
            existing.title ||
            existing.name ||
            row.name ||
            id,
          library: libraryType,
          profileDir: row.profileDir,
          folderPath: row.profileDir,
          sourcePath: row.profileDir,
          path: row.profileDir,
          metadataPath,
          metadataFile: metadataPath,
          poster: chooseProfilePoster(
            row.profileDir,
            metadata.poster,
            metadata.posterPath,
            metadata.image,
            metadata.thumbnail,
            existing.poster,
            existing.posterPath,
            existing.image,
            existing.thumbnail
          ),
          updatedAt:
            metadata.updatedAt ||
            metadata.metadataUpdatedAt ||
            existing.updatedAt ||
            "",
        },
        existing
      );
    }

    libraries[libraryType] =
      dedupeProfileLibrary(combined);
  }

  return {
    ...index,
    libraries,
    personal: libraries.personal || {},
    performers: libraries.performers || {},
    celebrities: libraries.celebrities || {},
    liveProfilesAt: new Date().toISOString(),
  };
}

app.get("/data/media-index.json", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(buildLiveMediaIndex());
});

app.get("/data/youtube-index.json", (req, res) => {
  res.sendFile(path.join(__dirname, "data", "youtube-index.json"));
});

app.get("/media-index.json", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(buildLiveMediaIndex());
});

app.get("/youtube-index.json", (req, res) => {
  res.sendFile(path.join(__dirname, "data", "youtube-index.json"));
});

function hashSetupPassword(password = "") {
  const rawPassword = String(password || "");
  if (!rawPassword) return null;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(rawPassword, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function sanitizeSetupConfigForClient(config = {}) {
  const safeConfig = JSON.parse(JSON.stringify(config || {}));
  const adminAccount = { ...(safeConfig.adminAccount || {}) };
  const passwordConfigured = Boolean(
    adminAccount.passwordConfigured ||
    adminAccount.passwordHash ||
    adminAccount.password
  );
  delete adminAccount.password;
  delete adminAccount.passwordHash;
  delete adminAccount.confirmPassword;
  safeConfig.adminAccount = {
    ...adminAccount,
    passwordConfigured,
  };
  safeConfig.branding = {
    ...(safeConfig.branding || {}),
    ...getBrandingIconState(),
  };
  return safeConfig;
}

function prepareSetupConfigForStorage(incomingConfig = {}) {
  const existingConfig = readSetupConfig();
  const incomingAdmin = incomingConfig.adminAccount || {};
  const existingAdmin = existingConfig.adminAccount || {};
  const passwordHash = incomingAdmin.password
    ? hashSetupPassword(incomingAdmin.password)
    : existingAdmin.passwordHash || null;

  const storedConfig = {
    ...existingConfig,
    ...incomingConfig,
    branding: {
      ...(existingConfig.branding || {}),
      ...(incomingConfig.branding || {}),
      ...getBrandingIconState(),
    },
    adminAccount: {
      ...existingAdmin,
      ...incomingAdmin,
      username: String(incomingAdmin.username ?? existingAdmin.username ?? "").trim(),
      passwordConfigured: Boolean(passwordHash || existingAdmin.passwordConfigured),
      ...(passwordHash ? { passwordHash } : {}),
    },
  };

  delete storedConfig.adminAccount.password;
  delete storedConfig.adminAccount.confirmPassword;
  return storedConfig;
}

function normalizeSetupFolderPaths(value) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map((entry) => String(entry || "").trim()).filter(Boolean)));
}

function runScannerCommandsAsync(commands = []) {
  return new Promise((resolve, reject) => {
    runScannerCommands(commands, (error, results = []) => {
      if (error) {
        error.results = results;
        reject(error);
        return;
      }
      resolve(results);
    });
  });
}

app.post("/api/setup/create-folders", (req, res) => {
  const enabledLibraries = req.body?.enabledLibraries || {};
  const adultSublibraries = req.body?.adultSublibraries || {};
  const libraryPreferences = req.body?.libraryPreferences || {};
  const folderMappings = req.body?.folderMappings || {};
  const results = [];
  const errors = [];

  for (const [libraryId, enabled] of Object.entries(enabledLibraries)) {
    if (!enabled) continue;
    const folderPaths = normalizeSetupFolderPaths(folderMappings[libraryId]);

    if (!folderPaths.length) {
      const result = { libraryId, path: "", status: "error", message: "No folder path configured." };
      results.push(result);
      errors.push(result);
      continue;
    }

    for (const folderPath of folderPaths) {
      try {
        if (!path.isAbsolute(folderPath)) {
          throw new Error("Folder paths must be absolute inside the Homestead container.");
        }
        const existed = fs.existsSync(folderPath);
        fs.mkdirSync(folderPath, { recursive: true });
        results.push({
          libraryId,
          label: libraryId,
          path: folderPath,
          status: existed ? "exists" : "created",
        });
      } catch (error) {
        const result = { libraryId, path: folderPath, status: "error", message: error.message };
        results.push(result);
        errors.push(result);
      }
    }
  }

  if (
    enabledLibraries.adult &&
    enabledLibraries.liveTV &&
    adultSublibraries.adultTVChannels
  ) {
    const adultRecordingsPath = String(
      libraryPreferences?.adultTV?.recordingsPath || "/media/adult/tv/recordings"
    ).trim();

    try {
      if (!path.isAbsolute(adultRecordingsPath)) {
        throw new Error("Adult TV recordings path must be absolute inside the Homestead container.");
      }
      const existed = fs.existsSync(adultRecordingsPath);
      fs.mkdirSync(adultRecordingsPath, { recursive: true });
      results.push({
        libraryId: "adultTV",
        label: "Adult TV Recordings",
        path: adultRecordingsPath,
        status: existed ? "exists" : "created",
      });
    } catch (error) {
      const result = {
        libraryId: "adultTV",
        label: "Adult TV Recordings",
        path: adultRecordingsPath,
        status: "error",
        message: error.message,
      };
      results.push(result);
      errors.push(result);
    }
  }

  const internalDirectories = [
    dataDir,
    path.join(dataDir, "collections"),
    path.join(dataDir, "collections", "custom"),
    path.join(dataDir, "collections", "order-overrides"),
    path.join(dataDir, "collections", "appearance-overrides"),
    path.join(dataDir, "collections", "watch-orders"),
  ];

  for (const internalPath of internalDirectories) {
    try {
      const existed = fs.existsSync(internalPath);
      fs.mkdirSync(internalPath, { recursive: true });
      results.push({
        libraryId: "homestead-data",
        label: "Homestead Data",
        path: internalPath,
        status: existed ? "exists" : "created",
      });
    } catch (error) {
      const result = { libraryId: "homestead-data", label: "Homestead Data", path: internalPath, status: "error", message: error.message };
      results.push(result);
      errors.push(result);
    }
  }

  if (!fs.existsSync(namedWatchlistsPath)) {
    writeJsonFile(namedWatchlistsPath, { version: 1, watchlists: [{ id: "my-watchlist", name: "My Watchlist", items: [] }] });
  }

  res.json({
    ok: errors.length === 0,
    message: errors.length ? `${errors.length} folder operation${errors.length === 1 ? "" : "s"} failed.` : "Folder structure is ready.",
    results,
    errors,
  });
});

app.post("/api/setup/initial-scan", async (req, res) => {
  const enabledLibraries = req.body?.enabledLibraries || {};
  const folderMappings = req.body?.folderMappings || {};
  const scanLibraryMap = {
    movies: "movies",
    tvshows: "tv",
    books: "books",
    music: "music",
    youtube: "youtube",
    photos: "photos",
    adult: "adult",
  };
  const results = [];
  const skipped = [];

  for (const [setupLibraryId, enabled] of Object.entries(enabledLibraries)) {
    if (!enabled) continue;
    const scannerLibraryId = scanLibraryMap[setupLibraryId];
    if (!scannerLibraryId) {
      skipped.push({
        libraryId: setupLibraryId,
        reason: "This module does not use the shared local media scanner yet.",
      });
      continue;
    }

    const folders = normalizeSetupFolderPaths(folderMappings[setupLibraryId]);
    const commands = buildScanCommands({ libraryId: scannerLibraryId, folders });

    try {
      const commandResults = await runScannerCommandsAsync(commands);
      results.push({
        setupLibraryId,
        libraryId: scannerLibraryId,
        status: "success",
        message: `${commandResults.length} scanner command${commandResults.length === 1 ? "" : "s"} completed.`,
        commandResults,
      });
    } catch (error) {
      results.push({
        setupLibraryId,
        libraryId: scannerLibraryId,
        status: "error",
        message: error.message || "Scanner failed.",
        commandResults: error.results || [],
      });
    }
  }

  const failures = results.filter((result) => result.status === "error");
  res.json({
    ok: failures.length === 0,
    message: failures.length ? `${failures.length} librar${failures.length === 1 ? "y" : "ies"} failed to scan.` : "Initial scan completed.",
    results,
    skipped,
  });
});


app.get("/api/branding", (req, res) => {
  res.json({ ok: true, branding: getBrandingIconState() });
});

app.get("/api/branding/icon", sendHomesteadBrandIcon);
app.get("/apple-touch-icon.png", sendHomesteadBrandIcon);
app.get("/favicon.png", sendHomesteadBrandIcon);
app.get("/favicon.ico", (req, res) => {
  res.redirect(302, `/api/branding/icon?v=${encodeURIComponent(getBrandingIconState().appIconVersion)}`);
});

app.post("/api/branding/icon", (req, res) => {
  try {
    const { contentType, buffer } = parseImageDataUrl(req.body?.imageData || "");
    if (contentType !== "image/png") {
      throw new Error("The prepared app icon must be a PNG image.");
    }
    fs.mkdirSync(brandingDir, { recursive: true });
    fs.writeFileSync(brandingIconPath, buffer);
    const branding = getBrandingIconState();
    persistBrandingState(branding);
    res.json({ ok: true, branding });
  } catch (error) {
    console.error("Failed to save Homestead app icon:", error);
    res.status(400).json({ ok: false, message: error.message || "Failed to save the app icon." });
  }
});

app.delete("/api/branding/icon", (req, res) => {
  try {
    if (fs.existsSync(brandingIconPath)) fs.unlinkSync(brandingIconPath);
    const branding = getBrandingIconState();
    persistBrandingState(branding);
    res.json({ ok: true, branding });
  } catch (error) {
    console.error("Failed to reset Homestead app icon:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to restore the default app icon." });
  }
});

app.get("/api/branding/manifest.webmanifest", sendHomesteadManifest);

app.post("/api/setup-config", (req, res) => {
  try {
    const storedConfig = prepareSetupConfigForStorage(req.body || {});
    fs.mkdirSync(path.dirname(setupConfigPath), { recursive: true });
    fs.writeFileSync(setupConfigPath, JSON.stringify(storedConfig, null, 2));
    res.json({ ok: true, config: sanitizeSetupConfigForClient(storedConfig) });
  } catch (error) {
    console.error("Failed to save setup config:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to save setup configuration." });
  }
});

app.get("/api/setup-config", (req, res) => {
  res.json(sanitizeSetupConfigForClient(readSetupConfig()));
});

async function discoverIntegrationIcon(baseUrl) {
  if (!baseUrl) {
    return null;
  }

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");

  const candidatePaths = [
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
    "/apple-touch-icon.png",
    "/favicon.png",
    "/favicon.ico",
  ];

  for (const path of candidatePaths) {
    try {
      const iconUrl = `${normalizedBaseUrl}${path}`;

      const response = await fetch(iconUrl, {
        method: "GET",
      });

      const contentType = response.headers.get("content-type") || "";

      if (
        response.ok &&
        (contentType.includes("image/") ||
          contentType.includes("x-icon") ||
          contentType.includes("octet-stream"))
      ) {
        return iconUrl;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

app.post("/api/integrations/:id/settings", (req, res) => {
  try {
    const { id } = req.params;
    const settings = req.body || {};

    const config = readSetupConfig();

    const updatedConfig = {
      ...config,

      integrations: {
        ...(config.integrations || {}),
        [id]: true,
      },

      integrationSettings: {
        ...(config.integrationSettings || {}),

[id]: {
  ...(config.integrationSettings?.[id] || {}),
  ...settings,
  url: settings.url ?? config.integrationSettings?.[id]?.url ?? "",
  apiKey: settings.apiKey ?? config.integrationSettings?.[id]?.apiKey ?? "",
  youtubeApiKey: settings.youtubeApiKey ?? config.integrationSettings?.[id]?.youtubeApiKey ?? "",
  enabled: settings.enabled ?? true,
},
      },
    };

    fs.writeFileSync(
      setupConfigPath,
      JSON.stringify(updatedConfig, null, 2)
    );

    res.json({
      ok: true,
      integration: id,
      hasApiKey: !!settings.apiKey,
    });
  } catch (error) {
    console.error("Failed to save integration settings:", error);

    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/icon", async (req, res) => {
  try {
    const { baseUrl } = getSeerrConfig();

    if (!baseUrl) {
      return res.json({
        ok: false,
        iconUrl: null,
        message: "Missing Seerr URL",
      });
    }

    const iconUrl = await discoverIntegrationIcon(baseUrl);

    res.json({
      ok: !!iconUrl,
      iconUrl,
      fallbackIcon: "/integrations/jellyseerr.png",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      iconUrl: null,
      fallbackIcon: "/integrations/jellyseerr.png",
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/discover/trending-movies", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/discover/movies`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      results: data.results || data || [],
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/discover/upcoming-movies", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/discover/movies/upcoming`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      results: data.results || data || [],
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/discover/trending-tv", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/discover/tv`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      results: data.results || data || [],
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/discover/upcoming-tv", async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/discover/tv/upcoming`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      results: data.results || data || [],
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});


function getWhisparrConfig() {
  const setupConfig = readSetupConfig();
  const whisparr =
    setupConfig?.integrationSettings?.whisparr ||
    setupConfig?.integrations?.whisparr ||
    {};

  return {
    baseUrl: whisparr.url || whisparr.baseUrl || process.env.WHISPARR_URL || "",
    apiKey: whisparr.apiKey || whisparr.key || process.env.WHISPARR_API_KEY || "",
  };
}

async function fetchWhisparrApi(apiPath, options = {}) {
  const { baseUrl, apiKey } = getWhisparrConfig();

  if (!baseUrl || !apiKey) {
    const error = new Error("Missing Whisparr URL or API key");
    error.code = "WHISPARR_NOT_CONFIGURED";
    throw error;
  }

  const base = String(baseUrl).replace(/\/+$/, "");
  const pathWithSlash = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  const response = await fetch(`${base}${pathWithSlash}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  let data = null;
  const text = await response.text();

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Whisparr returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function slugifyAdultProfileName(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";
}

function normalizeFolderList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : entry?.path || entry?.folder || ""))
      .filter(Boolean);
  }
  if (typeof value === "string") return [value];
  if (typeof value === "object") {
    return Object.values(value)
      .map((entry) => (typeof entry === "string" ? entry : entry?.path || entry?.folder || ""))
      .filter(Boolean);
  }
  return [];
}

function getAdultProfileRootCandidates(libraryType = "personal") {
  const setupConfig = readSetupConfig();
  const mappings = setupConfig?.folderMappings || {};
  const mediaRoot = process.env.MEDIA_ROOT || "/media";
  const requestedLibrary = String(libraryType || "personal");
  const normalizedLibrary = requestedLibrary === "girls" ? "personal" : requestedLibrary;
  const roots = [
    ...normalizeFolderList(mappings[normalizedLibrary]),
    ...normalizeFolderList(mappings.adult).map((basePath) => path.join(basePath, normalizedLibrary)),
    path.join(mediaRoot, normalizedLibrary),
    path.join(mediaRoot, "adult", normalizedLibrary),
  ];

  // Legacy/private personal profiles were sometimes stored under /girls.
  // Keep that root in the lookup list so Biography/Profile Facts saves land
  // in the same folder the UI loaded instead of disappearing after refresh.
  if (["personal", "girls", "personalProfiles", "personalprofiles"].includes(requestedLibrary) || normalizedLibrary === "personal") {
    roots.push(
      ...normalizeFolderList(mappings.girls),
      ...normalizeFolderList(mappings.adult).map((basePath) => path.join(basePath, "girls")),
      path.join(mediaRoot, "girls"),
      path.join(mediaRoot, "adult", "girls")
    );
  }

  return [...new Set(roots.filter(Boolean))];
}

function findAdultProfileDir({ libraryType = "personal", profileId = "", profileName = "", profileDir = "", folderPath = "", sourcePath = "", filePath = "" }) {
  const explicitCandidates = [profileDir, folderPath, sourcePath, filePath]
    .filter(Boolean)
    .map((value) => String(value));

  for (const candidate of explicitCandidates) {
    const normalized = path.normalize(candidate);
    const asDir = fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()
      ? normalized
      : path.dirname(normalized);
    if (asDir && fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
      return asDir;
    }
  }

  const roots = getAdultProfileRootCandidates(libraryType);
  const ids = [profileId, slugifyAdultProfileName(profileName), profileName]
    .filter(Boolean)
    .map((value) => String(value));

  for (const root of roots) {
    for (const id of ids) {
      const direct = path.join(root, id);
      if (fs.existsSync(direct)) return direct;
    }
  }

  const normalizedName = slugifyAdultProfileName(profileName || profileId);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const match = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .find((entryName) => slugifyAdultProfileName(entryName) === normalizedName);
    if (match) return path.join(root, match);
  }

  return null;
}

function listAdultProfileDirs(libraryType = "personal") {
  const roots = getAdultProfileRootCandidates(libraryType);
  const seen = new Set();
  const rows = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(root, entry.name);
      const real = fs.realpathSync.native?.(profileDir) || fs.realpathSync(profileDir);
      if (seen.has(real)) continue;
      seen.add(real);
      const file = readAdultProfileMetadataFile(profileDir);
      const metadata = file.metadata || file || {};
      rows.push({
        profileDir,
        folderName: entry.name,
        name: metadata.name || file.name || entry.name.replace(/[-_]+/g, " "),
        metadata,
        file,
      });
    }
  }

  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
}

function readAdultProfileMetadataFile(profileDir) {
  const metadataPath = path.join(profileDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (error) {
    console.warn("Failed to read adult metadata file:", metadataPath, error.message);
    return {};
  }
}


function findAdultProfileHeadshotFile(profileDir) {
  if (!profileDir || !fs.existsSync(profileDir)) return "";
  const preferredNames = [
    "headshot.jpg",
    "headshot.jpeg",
    "headshot.png",
    "headshot.webp",
    "profile.jpg",
    "profile.jpeg",
    "profile.png",
    "profile.webp",
    "avatar.jpg",
    "avatar.jpeg",
    "avatar.png",
    "avatar.webp",
    "poster.jpg",
    "poster.jpeg",
    "poster.png",
    "poster.webp",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "folder.webp",
  ];

  for (const fileName of preferredNames) {
    const candidate = path.join(profileDir, fileName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  return "";
}

function addHeadshotManifestKey(target, key, url) {
  const normalized = slugifyAdultProfileName(key);
  if (!normalized || !url) return;
  target[normalized] = url;
}

app.get("/api/adult/profile-headshots", (req, res) => {
  try {
    const libraryType = String(req.query.library || req.query.libraryType || "personal");
    const profiles = listAdultProfileDirs(libraryType);
    const headshots = {};
    const rows = [];

    for (const profile of profiles) {
      const metadata = profile.metadata || {};
      const file = profile.file || {};
      const headshotPath = findAdultProfileHeadshotFile(profile.profileDir);
      const headshot = headshotPath ? `/api/file?path=${encodeURIComponent(headshotPath)}` : "";
      const keys = [
        profile.folderName,
        profile.name,
        profile.id,
        metadata.id,
        metadata.slug,
        metadata.name,
        metadata.displayName,
        metadata.title,
        file.id,
        file.slug,
        file.name,
        file.title,
      ].filter(Boolean);

      keys.forEach((key) => addHeadshotManifestKey(headshots, key, headshot));

      rows.push({
        id: slugifyAdultProfileName(metadata.id || file.id || profile.folderName || profile.name),
        name: profile.name,
        folderName: profile.folderName,
        profileDir: profile.profileDir,
        headshot,
        hasHeadshot: Boolean(headshot),
        keys: Array.from(new Set(keys.map((key) => slugifyAdultProfileName(key)).filter(Boolean))),
      });
    }

    res.json({ ok: true, libraryType, headshots, profiles: rows });
  } catch (error) {
    console.error("Failed to build adult profile headshot manifest:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to build adult profile headshot manifest" });
  }
});

function getAdultMetadataMatchFromCandidate(sourceCandidate = null) {
  if (!sourceCandidate) return null;
  return {
    provider: sourceCandidate.provider || "manual",
    providerId: sourceCandidate.id || sourceCandidate.wikidataId || sourceCandidate.whisparrId || sourceCandidate.url || "",
    matchedName: sourceCandidate.name || sourceCandidate.title || "",
    source: sourceCandidate.source || sourceCandidate.provider || "",
    url: sourceCandidate.url || "",
    confidence: sourceCandidate.confidence || null,
    matchedAt: new Date().toISOString(),
  };
}


const ADULT_PROFILE_METADATA_MIRROR_KEYS = [
  "privateNotes",
  "profilePrivateNotes",
  "profileNotes",
  "privateNoteCards",
  "profileNotesUpdatedAt",
  "biography",
  "description",
  "notes",
  "profileFacts",
  "profileFactsUpdatedAt",
  "timeline",
  "timelineEntries",
  "profileTimeline",
  "height",
  "weight",
  "weightUnit",
  "measurements",
  "measurementsRaw",
  "bodyMeasurements",
  "bust",
  "waist",
  "hips",
  "braSize",
  "pantySize",
  "pantySizeSystem",
  "shoeSize",
  "dressSize",
  "clothingSize",
  "hairColor",
  "eyeColor",
  "body",
  "bodyDetails",
  "clothingSizes",
  "manualMetadataEditedAt",
  "manualMetadataFields",
];

function mirrorAdultProfileMetadataFields(target = {}, source = {}) {
  for (const key of ADULT_PROFILE_METADATA_MIRROR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      target[key] = source[key];
    }
  }
  return target;
}

function writeAdultProfileMetadataFile(profileDir, patch = {}, sourceCandidate = null, options = {}) {
  fs.mkdirSync(profileDir, { recursive: true });
  const metadataPath = path.join(profileDir, "metadata.json");
  const existing = readAdultProfileMetadataFile(profileDir);
  const envelopeKeys = new Set(["metadata", "metadataCandidates", "updatedAt", "createdAt"]);
  const topLevelMetadata = Object.fromEntries(
    Object.entries(existing || {}).filter(([key]) => !envelopeKeys.has(key))
  );
  const existingMetadata = { ...topLevelMetadata, ...(existing.metadata || {}) };
  const overwrite = options.overwrite !== false;
  const match = patch.metadataMatch || getAdultMetadataMatchFromCandidate(sourceCandidate) || existingMetadata.metadataMatch || null;
  const cleanPatch = Object.fromEntries(
    Object.entries(patch || {}).filter(([, value]) => !isEmptyAdultMetadataValue(value))
  );
  const nextMetadata = overwrite
    ? { ...existingMetadata, ...cleanPatch }
    : { ...cleanPatch, ...existingMetadata };

  if (match) nextMetadata.metadataMatch = match;

  const next = mirrorAdultProfileMetadataFields({
    ...existing,
    metadata: nextMetadata,
    metadataCandidates: {
      ...(existing.metadataCandidates || {}),
      adultAutoFetch: sourceCandidate ? [sourceCandidate] : (existing.metadataCandidates?.adultAutoFetch || []),
    },
    updatedAt: new Date().toISOString(),
  }, nextMetadata);

  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));
  return { metadataPath, metadata: next.metadata, file: next };
}


function normalizeAdultPersonProfileType(value = "") {
  const normalized = String(value || "").toLowerCase().trim();
  if (["celebrity", "celebrities", "celeb"].includes(normalized)) return "celebrity";
  if (["performer", "performers", "adult-performer"].includes(normalized)) return "performer";
  if (["personal", "girls", "person"].includes(normalized)) return "personal";
  return normalized || "performer";
}

function adultPersonLibraryFromProfileType(value = "") {
  const normalized = normalizeAdultPersonProfileType(value);
  if (normalized === "celebrity") return "celebrities";
  if (normalized === "performer") return "performers";
  if (normalized === "personal") return "personal";
  return String(value || "").toLowerCase().includes("celeb") ? "celebrities" : "performers";
}

function adultPersonProfileTypeFromLibrary(value = "") {
  const normalized = String(value || "").toLowerCase().trim();
  if (["celebrity", "celebrities", "celeb"].includes(normalized)) return "celebrity";
  if (["personal", "girls"].includes(normalized)) return "personal";
  return "performer";
}

function getAdultPersonCandidateProviderKey(candidate = {}) {
  return String(candidate.provider || candidate.source || "").toLowerCase().trim();
}

function adultPersonCandidateDisplayName(candidate = {}) {
  return cleanMetadataQuery(candidate.name || candidate.title || "");
}

function isJunkAdultPersonCandidate(candidate = {}) {
  const name = adultPersonCandidateDisplayName(candidate).toLowerCase();
  const title = String(candidate.title || "").toLowerCase().trim();
  const source = String(candidate.source || candidate.provider || "").toLowerCase();
  const url = String(candidate.url || candidate.externalUrl || candidate.sourceUrl || "").toLowerCase();
  const text = `${name} ${title} ${source} ${url}`.trim();
  if (!text) return true;

  const junkNames = new Set([
    "invalid",
    "model not found",
    "not found",
    "page not found",
    "404 not found",
    "access denied",
    "just a moment",
    "cloudflare",
  ]);

  if (junkNames.has(name) || junkNames.has(title)) return true;

  return [
    /\binvalid\b/,
    /\bmodel not found\b/,
    /\b404 not found\b/,
    /\bpage not found\b/,
    /\baccess denied\b/,
    /\bjust a moment\b/,
    /\bcloudflare\b/,
  ].some((pattern) => pattern.test(text));
}

function isSearchOnlyAdultPersonCandidate(candidate = {}) {
  const provider = getAdultPersonCandidateProviderKey(candidate);
  const url = String(candidate.url || candidate.externalUrl || candidate.sourceUrl || "").toLowerCase();
  const searchOnlyProvider = /(^|[-_])(search|lookup)$/.test(provider) || provider.endsWith("-search") || provider.endsWith("-lookup");
  const searchOnlyUrl = /\/search\b|[?&](q|query|search)=|\/tags?\//.test(url);
  return Boolean(searchOnlyProvider || searchOnlyUrl || candidate.searchOnly || candidate.isProviderSearchLink);
}

function normalizedAdultNameDistance(a = "", b = "") {
  const left = slugifyAdultProfileName(a);
  const right = slugifyAdultProfileName(b);
  if (!left || !right) return 999;
  if (left === right) return 0;
  if (left.includes(right) || right.includes(left)) return 1;
  return Math.abs(left.length - right.length) + (left[0] === right[0] ? 1 : 4);
}

function hasUsefulAdultPersonAnchor(candidate = {}) {
  return Boolean(
    candidate.wikidataId ||
    candidate.tmdbId ||
    candidate.imdbId ||
    candidate.providerIds ||
    candidate.externalIds ||
    candidate.url ||
    candidate.externalUrl ||
    candidate.sourceUrl ||
    candidate.poster ||
    candidate.profileImage ||
    candidate.image
  );
}

function isAdultOnlyPersonProvider(candidate = {}) {
  const provider = getAdultPersonCandidateProviderKey(candidate);
  return [
    "definebabe-search",
    "freeones-search",
    "iafd",
    "boobpedia",
    "whisparr",
    "tpdb-stashbox",
    "stashbox",
  ].includes(provider);
}

function isMainstreamCelebrityProvider(candidate = {}) {
  const provider = getAdultPersonCandidateProviderKey(candidate);
  return ["tmdb", "wikidata", "wikipedia", "imdb", "musicbrainz", "models-com", "fashion-model-directory"].includes(provider);
}

function isStrongCelebrityCandidate(candidate = {}) {
  if (candidate.profileType !== "celebrity" && candidate.libraryType !== "celebrities") return false;
  if (!isMainstreamCelebrityProvider(candidate)) return false;
  const priority = Number(candidate.sourcePriority);
  const confidence = Number(candidate.confidence || 0);
  const score = Number(candidate.matchScore || 0);
  return (Number.isFinite(priority) && priority <= 3) || confidence >= 0.6 || score >= 70;
}

function isLowConfidenceAdultPersonFallback(candidate = {}) {
  const provider = getAdultPersonCandidateProviderKey(candidate);
  const confidence = Number(candidate.confidence || 0);
  return [
    "definebabe-search",
    "freeones-search",
    "iafd",
    "boobpedia",
    "celebrity-body-details",
    "models-com",
    "fashion-model-directory",
  ].includes(provider) && confidence > 0 && confidence < 0.5;
}

function shouldKeepAdultPersonCandidate(candidate = {}, context = {}) {
  if (!candidate || isJunkAdultPersonCandidate(candidate)) return false;

  const confidence = Number(candidate.confidence || 0);
  const query = cleanMetadataQuery(context.query || "");
  const candidateName = adultPersonCandidateDisplayName(candidate);
  const provider = getAdultPersonCandidateProviderKey(candidate);

  if (!candidateName || isJunkAdultPersonCandidate({ name: candidateName })) return false;
  if (query && normalizedAdultNameDistance(candidateName, query) > 7 && confidence < 0.72) return false;
  if (!hasUsefulAdultPersonAnchor(candidate) && confidence < 0.55) return false;

  // Search pages are useful as provider links, but they are not safe enough to treat
  // as profile-create candidates unless the provider gave a strong exact match.
  if (isSearchOnlyAdultPersonCandidate(candidate) && confidence < 0.62) return false;

  // IAFD occasionally returns placeholder rows like "invalid" or weak person stubs.
  // Keep IAFD only when it is clearly a usable candidate.
  if (provider === "iafd" && confidence < 0.62) return false;

  if (context.hasStrongCelebrityMatch && isAdultOnlyPersonProvider(candidate)) {
    return false;
  }

  if (context.hasStrongCelebrityMatch && candidate.profileType === "performer" && isLowConfidenceAdultPersonFallback(candidate)) {
    return false;
  }

  // When the same public identity provider finds a strong mainstream celebrity
  // match, do not mirror that exact Wikidata/Wikipedia/TMDB/IMDb identity row
  // into Performer results. Real performer-specific sources can still surface,
  // but a mainstream actor should not appear as both a Celebrity and Performer
  // just because the provider is shared between source profiles.
  if (context.hasStrongCelebrityMatch && candidate.profileType === "performer" && isMainstreamCelebrityProvider(candidate)) {
    return false;
  }

  return true;
}

function finalizeAdultPersonCandidates(query = "", candidates = [], options = {}) {
  const hasStrongCelebrityMatch = candidates.some(isStrongCelebrityCandidate);
  const seen = new Set();

  return candidates
    .filter((candidate) => shouldKeepAdultPersonCandidate(candidate, { ...options, query, hasStrongCelebrityMatch }))
    .map((candidate) => ({
      ...candidate,
      lowConfidenceFallback: Boolean(candidate.lowConfidenceFallback || isLowConfidenceAdultPersonFallback(candidate)),
      adultOnlyProvider: Boolean(candidate.adultOnlyProvider || isAdultOnlyPersonProvider(candidate)),
      resultGroup: candidate.profileType === "celebrity" ? "celebrity" : candidate.profileType === "personal" ? "personal" : "performer",
    }))
    .filter((candidate) => {
      const nameKey = slugifyAdultProfileName(candidate.name || candidate.title || query);
      const key = `${candidate.libraryType}:${candidate.provider || candidate.source}:${candidate.sourceCandidateId || candidate.url || nameKey}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const groupRank = { celebrity: 0, personal: 1, performer: hasStrongCelebrityMatch ? 3 : 2 };
      const groupA = groupRank[a.resultGroup] ?? 9;
      const groupB = groupRank[b.resultGroup] ?? 9;
      if (groupA !== groupB) return groupA - groupB;

      const lowA = a.lowConfidenceFallback ? 1 : 0;
      const lowB = b.lowConfidenceFallback ? 1 : 0;
      if (lowA !== lowB) return lowA - lowB;

      const scoreDiff = Number(b.matchScore || 0) - Number(a.matchScore || 0);
      if (Math.abs(scoreDiff) > 8) return scoreDiff;

      const priorityA = Number.isFinite(Number(a.sourcePriority)) ? Number(a.sourcePriority) : 99;
      const priorityB = Number.isFinite(Number(b.sourcePriority)) ? Number(b.sourcePriority) : 99;
      return priorityA - priorityB;
    });
}

function normalizeAdultPersonCandidateForUi(candidate = {}, fallbackQuery = "", profileType = "performer") {
  const normalizedType = normalizeAdultPersonProfileType(candidate.profileType || profileType);
  const libraryType = adultPersonLibraryFromProfileType(normalizedType);
  const idParts = [libraryType, candidate.provider || candidate.source || "source", candidate.id || candidate.wikidataId || candidate.tmdbId || candidate.imdbId || candidate.url || candidate.name || fallbackQuery]
    .filter(Boolean)
    .join("-");
  const candidateName = adultPersonCandidateDisplayName(candidate) || fallbackQuery;
  const confidence = Number(candidate.confidence || 0);
  const sourceLabel = candidate.source || candidate.provider || "External source";
  const typeLabel = normalizedType === "celebrity" ? "Celebrity" : normalizedType === "personal" ? "Personal" : "Performer";

  return {
    ...candidate,
    id: slugifyAdultProfileName(idParts),
    sourceCandidateId: candidate.id || candidate.wikidataId || candidate.tmdbId || candidate.imdbId || candidate.url || "",
    title: candidateName,
    name: candidateName,
    profileType: normalizedType,
    libraryType,
    icon: normalizedType === "celebrity" ? "Ã°Å¸Å’Å¸" : normalizedType === "personal" ? "Ã°Å¸â€˜Â¤" : "Ã°Å¸â€Å½",
    subtitle: `${typeLabel} Ã¢â‚¬Â¢ ${sourceLabel}${confidence ? ` Ã¢â‚¬Â¢ ${confidence.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} confidence` : ""}`,
    sourceLabel,
    typeLabel,
    poster: candidate.profileImage || candidate.image || candidate.poster || "",
    externalUrl: candidate.url || candidate.sourceUrl || "",
    matchKey: `${libraryType}:${slugifyAdultProfileName(candidateName)}`,
  };
}

async function searchAdultPersonCandidates(query, options = {}) {
  const setupConfig = options.setupConfig || readSetupConfig();
  const wantedType = normalizeAdultPersonProfileType(options.profileType || options.libraryType || "both");
  const targetLibraries = wantedType === "celebrity"
    ? ["celebrities"]
    : wantedType === "performer"
      ? ["performers"]
      : wantedType === "personal"
        ? ["personal"]
        : ["celebrities", "performers"];

  const combined = [];
  for (const libraryType of targetLibraries) {
    const candidates = await searchAdultMetadata(query, {
      libraryType,
      whisparr: libraryType === "performers" ? getWhisparrConfig() : {},
      customSourceUrls: getCustomMetadataSourceUrls(setupConfig, libraryType),
      limit: options.limit || 8,
    });

    for (const candidate of candidates || []) {
      combined.push(normalizeAdultPersonCandidateForUi(candidate, query, adultPersonProfileTypeFromLibrary(libraryType)));
    }
  }

  return finalizeAdultPersonCandidates(query, combined, options).slice(0, options.limit || 12);
}

function getAdultPersonCandidateImageUrl(candidate = {}) {
  return candidate?.profileImage || candidate?.image || candidate?.poster || candidate?.thumbnail || candidate?.still || "";
}

function getAdultPersonCandidateSourceUrl(candidate = {}) {
  return candidate?.url || candidate?.externalUrl || candidate?.sourceUrl || candidate?.profileUrl || "";
}

function buildAdultProfileMetadataDocument({ name, profileType, libraryType, metadata = {}, candidate = null, sourceUrls = [] }) {
  const now = new Date().toISOString();
  const normalizedLibrary = libraryType || adultPersonLibraryFromProfileType(profileType);
  const normalizedProfileType = adultPersonProfileTypeFromLibrary(normalizedLibrary);
  const autoNormalizedMetadata = augmentAdultBodyMetadata(candidate || {}, normalizeAdultCandidateForMetadata(candidate || {}, metadata || {}));
  const manualMetadataFields = Array.isArray(metadata.manualMetadataFields)
    ? [...new Set(metadata.manualMetadataFields.map((field) => String(field || "").trim()).filter(Boolean))]
    : [];
  const preservedManualMetadata = {};
  for (const field of manualMetadataFields) {
    if (!isEmptyAdultMetadataValue(metadata[field])) preservedManualMetadata[field] = metadata[field];
  }
  const normalizedMetadata = {
    ...autoNormalizedMetadata,
    ...preservedManualMetadata,
    ...(manualMetadataFields.length ? {
      manualMetadataFields,
      manualMetadataUpdatedAt: metadata.manualMetadataUpdatedAt || now,
      manualMetadataSource: "manual-create-form",
    } : {}),
  };
  const referenceLinks = [
    ...(Array.isArray(metadata.referenceLinks) ? metadata.referenceLinks : []),
    ...(getAdultPersonCandidateSourceUrl(candidate) ? [{ label: candidate.source || candidate.provider || "Source", url: getAdultPersonCandidateSourceUrl(candidate) }] : []),
    ...(Array.isArray(sourceUrls) ? sourceUrls.map((url) => (typeof url === "string" ? { label: "Custom source", url } : url)).filter((entry) => entry?.url) : []),
  ];

  return {
    id: slugifyAdultProfileName(name),
    name,
    title: name,
    library: normalizedLibrary,
    profileType: normalizedProfileType,
    poster: getAdultPersonCandidateImageUrl(candidate) || "poster.jpg",
    banner: "banner.jpg",
    headshot: getAdultPersonCandidateImageUrl(candidate) || "headshot.jpg",
    metadata: {
      ...normalizedMetadata,
      name,
      profileType: normalizedProfileType,
      metadataMatch: normalizedMetadata.metadataMatch || getAdultMetadataMatchFromCandidate(candidate),
    },
    referenceLinks,
    metadataCandidates: candidate ? { adultPersonFullFetch: [candidate] } : {},
    createdAt: now,
    updatedAt: now,
  };
}


function getAdultFaceUploadDir() {
  return path.join(HOMESTEAD_DATA_DIR, "adult-face-search-uploads");
}

function parseImageDataUrl(imageData = "") {
  const raw = String(imageData || "");
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Upload a valid image data URL.");
  }

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new Error("Uploaded image was empty.");
  if (buffer.length > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB.");

  const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  return { contentType, buffer, extension };
}

function getProfileImageCandidates(profileDir = "") {
  const candidates = [
    "poster.jpg",
    "poster.png",
    "headshot.jpg",
    "headshot.png",
    "banner.jpg",
    "artwork/poster.jpg",
    "photos/profile.jpg",
    "nudes/profile.jpg",
  ];

  const found = [];
  for (const relativePath of candidates) {
    const fullPath = path.join(profileDir, relativePath);
    if (fs.existsSync(fullPath)) found.push({ relativePath, fullPath });
  }

  for (const folderName of ["photos", "nudes"]) {
    const folderDir = path.join(profileDir, folderName);
    if (!fs.existsSync(folderDir)) continue;
    for (const entry of fs.readdirSync(folderDir, { withFileTypes: true }).slice(0, 12)) {
      if (!entry.isFile()) continue;
      if (!/\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
      found.push({ relativePath: `${folderName}/${entry.name}`, fullPath: path.join(folderDir, entry.name) });
      if (found.length >= 16) break;
    }
    if (found.length >= 16) break;
  }

  return found;
}

function buildAdultFaceProfileIndex(libraries = ["performers", "celebrities", "personal"]) {
  const rows = [];
  for (const libraryType of libraries) {
    const normalizedLibrary = String(libraryType || "").toLowerCase() === "celebrities" ? "celebrities" : String(libraryType || "").toLowerCase() === "personal" ? "personal" : "performers";
    for (const profile of listAdultProfileDirs(normalizedLibrary)) {
      const imageCandidates = getProfileImageCandidates(profile.profileDir);
      if (!imageCandidates.length) continue;
      rows.push({
        id: profile.folderName || slugifyAdultProfileName(profile.name),
        name: profile.name,
        title: profile.name,
        libraryType: normalizedLibrary,
        profileType: adultPersonProfileTypeFromLibrary(normalizedLibrary),
        profileDir: profile.profileDir,
        metadata: profile.metadata || {},
        imageCandidates,
      });
    }
  }
  return rows;
}

function normalizeAdultFaceServiceResult(result = {}, profileIndex = []) {
  const matchedProfile = result.profileId || result.id
    ? profileIndex.find((profile) => String(profile.id) === String(result.profileId || result.id))
    : null;
  const libraryType = result.libraryType || matchedProfile?.libraryType || adultPersonLibraryFromProfileType(result.profileType || "performer");
  const name = result.name || result.title || matchedProfile?.name || "Possible face match";
  const confidence = Number(result.confidence || result.score || result.distanceScore || 0);

  return {
    id: `face-${libraryType}-${slugifyAdultProfileName(name)}-${String(result.profileId || result.id || Date.now()).slice(0, 32)}`,
    name,
    title: name,
    subtitle: `${adultPersonProfileTypeFromLibrary(libraryType) === "celebrity" ? "Celebrity" : adultPersonProfileTypeFromLibrary(libraryType) === "personal" ? "Personal" : "Performer"} Ã¢â‚¬Â¢ Face search${confidence ? ` Ã¢â‚¬Â¢ ${confidence.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} confidence` : ""}`,
    profileType: adultPersonProfileTypeFromLibrary(libraryType),
    libraryType,
    source: "Local face search",
    provider: "local-face-search",
    confidence,
    reliabilityTier: confidence >= 0.85 ? "verified" : confidence >= 0.65 ? "likely" : confidence >= 0.45 ? "possible" : "weak",
    reliabilityLabel: confidence >= 0.85 ? "Likely face match" : confidence >= 0.65 ? "Possible face match" : "Review needed",
    isPersonCandidate: true,
    canCreateProfile: true,
    actionLabel: "Review/Match",
    resultGroup: "Best metadata matches",
    icon: "Ã°Å¸â€œÂ·",
    poster: result.poster || result.image || result.thumbnail || matchedProfile?.metadata?.poster || "",
    profileId: matchedProfile?.id || result.profileId || result.id || "",
    matchedProfile: matchedProfile ? { id: matchedProfile.id, name: matchedProfile.name, libraryType: matchedProfile.libraryType } : null,
  };
}


function getBabeWikiFaceSearchUrl() {
  return String(
    process.env.HOMESTEAD_BABEWIKI_FACE_SEARCH_URL
    || process.env.BABEWIKI_FACE_SEARCH_URL
    || "https://www.babewiki.com/face-search"
  ).trim();
}

function getBabeWikiFaceSearchApiUrl() {
  return String(
    process.env.HOMESTEAD_BABEWIKI_FACE_SEARCH_API_URL
    || process.env.BABEWIKI_FACE_SEARCH_API_URL
    || ""
  ).replace(/\/+$/, "");
}

function normalizeBabeWikiFaceResult(result = {}) {
  const name = cleanMetadataQuery(result.name || result.title || result.performerName || "") || "Possible BabeWiki face match";
  const confidence = Number(result.confidence || result.score || result.matchScore || 0);
  const url = result.url || result.profileUrl || result.sourceUrl || getBabeWikiFaceSearchUrl();
  const id = result.id || result.providerId || `babewiki-face-${slugifyAdultProfileName(name)}-${String(url || Date.now()).slice(0, 32)}`;

  return {
    id: String(id),
    name,
    title: name,
    subtitle: `Performer Ã¢â‚¬Â¢ BabeWiki Face Search${confidence ? ` Ã¢â‚¬Â¢ ${confidence.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} confidence` : ""}`,
    profileType: "performer",
    libraryType: "performers",
    source: "BabeWiki Face Search",
    provider: "babewiki-face-search",
    url,
    confidence,
    reliabilityTier: confidence >= 0.85 ? "verified" : confidence >= 0.65 ? "likely" : confidence >= 0.45 ? "possible" : "weak",
    reliabilityLabel: confidence >= 0.85 ? "Likely BabeWiki face match" : confidence >= 0.65 ? "Possible BabeWiki face match" : "Review needed",
    isPersonCandidate: true,
    canCreateProfile: true,
    actionLabel: confidence >= 0.65 ? "Match/Create" : "Review/Create",
    resultGroup: "Best metadata matches",
    icon: "Ã°Å¸Â§Â ",
    poster: result.poster || result.image || result.thumbnail || "",
    providerLinks: { babewiki: url },
    externalLinks: { babewiki: url },
  };
}

function buildBabeWikiFaceSearchProviderCard({ query = "", uploaded = null, apiConfigured = false } = {}) {
  const url = getBabeWikiFaceSearchUrl();
  const cleanQuery = cleanMetadataQuery(query);
  return {
    id: `babewiki-face-search-${uploaded?.fileName || Date.now()}`,
    title: "BabeWiki Face Search",
    name: "BabeWiki Face Search",
    source: "BabeWiki Face Search",
    provider: "babewiki-face-search",
    url,
    subtitle: apiConfigured
      ? "External performer face-search provider is configured."
      : "Default performer photo lookup provider. Open it and upload the same image for external identification.",
    adaptationNote: apiConfigured
      ? "BabeWiki API/provider hook ran first."
      : "BabeWiki is first in the photo-search workflow; local AI matching can be added later.",
    category: "face search provider",
    type: "face-search-provider",
    resultGroup: "Face search providers",
    icon: "BW",
    badges: ["BabeWiki first", "Performer lookup", apiConfigured ? "API hook" : "Manual upload"].filter(Boolean),
    requiresSession: false,
    canCreateProfile: false,
    canAttachToProfile: false,
    uploaded,
    query: cleanQuery,
  };
}

async function downloadAdultProfileImage(url, destinationPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Image fetch returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error("URL did not return an image");
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > 12 * 1024 * 1024) throw new Error("Image is larger than 12 MB");
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, buffer);
  return { path: destinationPath, bytes: buffer.length, contentType };
}

app.get("/api/metadata/adult/person/search", async (req, res) => {
  try {
    const query = cleanMetadataQuery(req.query.q || req.query.query || "");
    const profileType = normalizeAdultPersonProfileType(req.query.profileType || req.query.libraryType || "both");

    if (!query) {
      return res.status(400).json({ ok: false, message: "Missing query" });
    }

    const setupConfig = readSetupConfig();
    const candidates = await searchAdultPersonCandidates(query, {
      setupConfig,
      profileType,
      limit: Number(req.query.limit) || 12,
    });

    res.json({
      ok: true,
      query,
      profileType,
      candidates,
      results: candidates,
      message: `${candidates.length} external person result${candidates.length === 1 ? "" : "s"} found.`,
    });
  } catch (error) {
    console.error("Adult person search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult person search failed" });
  }
});


app.post("/api/discovery/adult/face-search", async (req, res) => {
  try {
    const { imageData = "", fileName = "face-search.jpg", profileTypes = ["performers", "celebrities", "personal"], query = "" } = req.body || {};
    const parsed = parseImageDataUrl(imageData);
    const uploadDir = getAdultFaceUploadDir();
    fs.mkdirSync(uploadDir, { recursive: true });

    const safeBase = slugifyAdultProfileName(path.basename(fileName, path.extname(fileName)) || "face-search");
    const uploadName = `${Date.now()}-${safeBase}${parsed.extension}`;
    const uploadPath = path.join(uploadDir, uploadName);
    fs.writeFileSync(uploadPath, parsed.buffer);

    const wantedLibraries = (Array.isArray(profileTypes) ? profileTypes : [profileTypes])
      .map((entry) => adultPersonLibraryFromProfileType(entry))
      .filter(Boolean);
    const libraries = wantedLibraries.length ? [...new Set(wantedLibraries)] : ["performers", "celebrities", "personal"];
    const profileIndex = buildAdultFaceProfileIndex(libraries);
    const uploaded = { fileName: uploadName, path: uploadPath, contentType: parsed.contentType, bytes: parsed.buffer.length };
    const cleanQuery = cleanMetadataQuery(query);
    const babeWikiApiUrl = getBabeWikiFaceSearchApiUrl();
    const localServiceUrl = String(process.env.HOMESTEAD_FACE_RECOGNITION_URL || process.env.FACE_RECOGNITION_URL || "").replace(/\/+$/, "");
    const providerCards = [buildBabeWikiFaceSearchProviderCard({ query: cleanQuery, uploaded, apiConfigured: Boolean(babeWikiApiUrl) })];
    const results = [];
    const providerErrors = [];

    if (babeWikiApiUrl) {
      try {
        const babeWikiResponse = await fetch(`${babeWikiApiUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageData,
            fileName,
            query: cleanQuery,
            uploaded,
            provider: "babewiki-face-search",
            libraryType: "performers",
            profileType: "performer",
          }),
        });
        const babeWikiData = await babeWikiResponse.json().catch(() => ({}));
        if (!babeWikiResponse.ok) {
          providerErrors.push(babeWikiData.message || `BabeWiki Face Search adapter returned ${babeWikiResponse.status}`);
        } else {
          const rawBabeWikiResults = Array.isArray(babeWikiData.results)
            ? babeWikiData.results
            : Array.isArray(babeWikiData.matches)
              ? babeWikiData.matches
              : [];
          results.push(...rawBabeWikiResults.map(normalizeBabeWikiFaceResult));
        }
      } catch (error) {
        providerErrors.push(error.message || "BabeWiki Face Search adapter failed.");
      }
    }

    if (localServiceUrl) {
      try {
        const serviceResponse = await fetch(`${localServiceUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageData,
            fileName,
            query: cleanQuery,
            libraries,
            profiles: profileIndex.map((profile) => ({
              id: profile.id,
              name: profile.name,
              libraryType: profile.libraryType,
              profileType: profile.profileType,
              imagePaths: profile.imageCandidates.map((image) => image.fullPath),
            })),
          }),
        });

        const serviceData = await serviceResponse.json().catch(() => ({}));
        if (!serviceResponse.ok) {
          providerErrors.push(serviceData.message || `Local face search service returned ${serviceResponse.status}`);
        } else {
          const rawResults = Array.isArray(serviceData.results) ? serviceData.results : Array.isArray(serviceData.matches) ? serviceData.matches : [];
          results.push(...rawResults.map((result) => normalizeAdultFaceServiceResult(result, profileIndex)));
        }
      } catch (error) {
        providerErrors.push(error.message || "Local face search service failed.");
      }
    }

    const allResults = [...results, ...providerCards];
    const configured = Boolean(babeWikiApiUrl || localServiceUrl);
    const message = results.length
      ? `BabeWiki-first photo search returned ${results.length} possible match${results.length === 1 ? "" : "es"}.`
      : `Photo saved. BabeWiki Face Search is ready first; local AI matching can be added later. ${profileIndex.length} local profile image set(s) are available for future indexing.`;

    res.json({
      ok: true,
      configured,
      provider: "babewiki-first",
      query: cleanQuery,
      uploaded,
      indexedProfiles: profileIndex.length,
      results: allResults,
      providerErrors,
      services: {
        babewikiFaceSearch: getBabeWikiFaceSearchUrl(),
        babewikiApiConfigured: Boolean(babeWikiApiUrl),
        localFaceSearchConfigured: Boolean(localServiceUrl),
      },
      message: providerErrors.length ? `${message} ${providerErrors.join(" ")}` : message,
    });
  } catch (error) {
    console.error("Adult face search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult face search failed" });
  }
});



app.post("/api/adult/profiles/create", async (req, res) => {
  try {
    const { name: rawName = "", profileType = "performer", libraryType: rawLibraryType = "", metadata = {}, candidate = null, sourceUrls = [], overwrite = false } = req.body || {};
    const name = cleanMetadataQuery(rawName || candidate?.name || candidate?.title || "");
    const libraryType = rawLibraryType || adultPersonLibraryFromProfileType(profileType || candidate?.profileType);

    if (!name) {
      return res.status(400).json({ ok: false, message: "Missing profile name" });
    }

    const roots = getAdultProfileRootCandidates(libraryType);
    const root = roots.find((candidateRoot) => candidateRoot && fs.existsSync(candidateRoot)) || roots[0];
    if (!root) {
      return res.status(400).json({ ok: false, message: "No profile root is configured for this library." });
    }

    const folderName = slugifyAdultProfileName(name);
    const profileDir = path.join(root, folderName);
    const metadataPath = path.join(
      profileDir,
      "metadata.json"
    );

    if (fs.existsSync(metadataPath) && !overwrite) {
      return res.status(409).json({ ok: false, message: "A profile with this folder/name already exists.", profileDir, metadataPath });
    }

    const createdFolders = [
      "photos",
      "nudes",
      "videos",
      "scenes",
      "artwork",
      "references",
      "imports",
    ];

    fs.mkdirSync(profileDir, { recursive: true });
    for (const folder of createdFolders) {
      fs.mkdirSync(path.join(profileDir, folder), { recursive: true });
    }

    let document = buildAdultProfileMetadataDocument({ name, profileType, libraryType, metadata, candidate, sourceUrls });

    fs.writeFileSync(metadataPath, JSON.stringify(document, null, 2));

    const candidateImageUrl = getAdultPersonCandidateImageUrl(candidate);
    let downloadedPoster = false;

    if (candidateImageUrl) {
      try {
        await downloadAdultProfileImage(candidateImageUrl, path.join(profileDir, "poster.jpg"));
        downloadedPoster = true;
      } catch (imageError) {
        console.warn("Could not import profile poster:", imageError.message);
      }
    }

    const profileForUi = {
      ...document,
      id: folderName,
      name,
      title: name,
      library: libraryType,
      profileType: adultPersonProfileTypeFromLibrary(libraryType),
      poster: candidateImageUrl || (downloadedPoster ? `/media/${libraryType}/${folderName}/poster.jpg` : "/placeholder-poster.jpg"),
      metadata: document.metadata || {},
      referenceLinks: document.referenceLinks || [],
      createdFolders,
      profileDir,
      metadataPath,
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      profileDir,
      metadataPath,
      createdFolders,
      profile: {
        ...profileForUi,
        profileDir,
        folderPath: profileDir,
        sourcePath: profileDir,
        path: profileDir,
        metadataPath,
      },
      message: `${name} was created in ${libraryType}.`,
    });
  } catch (error) {
    console.error("Adult profile create failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult profile create failed" });
  }
});

function isEmptyAdultMetadataValue(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return String(value).trim() === "";
}

function normalizeAdultMetadataCompareValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean).sort().join("|");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isWeakAdultMetadataText(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return /open source search|custom metadata source|provider search|search for aliases|source search|not found|invalid/.test(text);
}

function adultMetadataSourceLabel(candidate = {}, index = 0) {
  return candidate.source || candidate.sourceLabel || candidate.provider || candidate.metadataSource || `Source ${index + 1}`;
}

function adultMetadataSourceUrl(candidate = {}) {
  return candidate.url || candidate.externalUrl || candidate.sourceUrl || candidate.profileUrl || candidate.providerLinks?.wikidata || candidate.providerLinks?.tmdb || "";
}

function adultMetadataCandidateWeight(candidate = {}, index = 0) {
  const confidence = Number(candidate.confidence || 0);
  const priority = Number.isFinite(Number(candidate.sourcePriority)) ? Number(candidate.sourcePriority) : 20 + index;
  const score = Number(candidate.matchScore || 0);
  const providerBonus = Math.max(0, 30 - priority * 2);
  const confidenceBonus = confidence ? confidence * 55 : 12;
  const scoreBonus = Math.min(35, Math.max(0, score / 6));
  const imageBonus = candidate.poster || candidate.image || candidate.profileImage ? 4 : 0;
  const idBonus = candidate.wikidataId || candidate.tmdbId || candidate.imdbId || candidate.providerIds || candidate.externalIds ? 6 : 0;
  const lowPenalty = candidate.lowConfidenceFallback ? -18 : 0;
  return Math.round(providerBonus + confidenceBonus + scoreBonus + imageBonus + idBonus + lowPenalty);
}

const ADULT_FULL_FETCH_FIELD_GROUPS = [
  {
    id: "identity",
    label: "Identity",
    fields: [
      ["name", "Name"],
      ["aliases", "Aliases"],
      ["alsoKnownAs", "Also known as"],
      ["birthday", "Birthday"],
      ["birthDate", "Birth date"],
      ["birthPlace", "Birthplace"],
      ["placeOfBirth", "Place of birth"],
      ["nationality", "Nationality"],
      ["occupation", "Occupation"],
      ["occupations", "Occupations"],
    ],
  },
  {
    id: "profile",
    label: "Profile",
    fields: [
      ["biography", "Biography"],
      ["description", "Description"],
      ["officialWebsite", "Official website"],
      ["knownFor", "Known for"],
      ["popularity", "Popularity"],
    ],
  },
  {
    id: "body",
    label: "Body details",
    fields: [
      ["height", "Height"],
      ["weight", "Weight"],
      ["measurements", "Measurements"],
      ["measurementsRaw", "Measurements raw"],
      ["bust", "Bust"],
      ["waist", "Waist"],
      ["hips", "Hips"],
      ["braSize", "Bra size"],
      ["cupSize", "Cup size"],
      ["shoeSize", "Shoe size"],
      ["dressSize", "Dress size"],
      ["clothingSize", "Clothing size"],
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    fields: [
      ["hairColor", "Hair color"],
      ["eyeColor", "Eye color"],
      ["tattoos", "Tattoos"],
      ["piercings", "Piercings"],
    ],
  },
  {
    id: "links",
    label: "External IDs / links",
    fields: [
      ["imdbId", "IMDb ID"],
      ["wikidataId", "Wikidata ID"],
      ["wikipediaTitle", "Wikipedia title"],
      ["providerIds", "Provider IDs"],
      ["providerLinks", "Provider links"],
      ["externalIds", "External IDs"],
      ["externalLinks", "External links"],
    ],
  },
];

const ADULT_FULL_FETCH_FIELDS = ADULT_FULL_FETCH_FIELD_GROUPS.flatMap((group) =>
  group.fields.map(([key, label]) => ({ key, label, group: group.id, groupLabel: group.label }))
);

function normalizeAdultIdentityName(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function adultCandidateLane(candidate = {}) {
  const declared = String(candidate.profileType || candidate.libraryType || candidate.type || "").toLowerCase();
  const provider = String(candidate.provider || candidate.source || candidate.sourceLabel || "").toLowerCase();
  if (/performer|pornstar|adult/.test(declared) || /thelordofporn|babepedia|freeones|iafd|nubil|whisparr/.test(provider)) return "performer";
  if (/celebrity|actor|actress/.test(declared) || /wikidata|wikipedia|tmdb/.test(provider)) return "celebrity";
  if (/personal/.test(declared)) return "personal";
  return "unknown";
}

function isMalformedAdultMetadataValue(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (text.length > 180 && !/^https?:/i.test(text)) return true;
  return /--wp-|wp-block|var\(|rgb\(|rgba\(|\d{3,}px|<\/?(?:style|script|div|span)|\{[^}]*:[^}]*\}/i.test(text);
}

function sanitizeAdultMetadataObject(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && isMalformedAdultMetadataValue(value)) continue;
    if (Array.isArray(value)) {
      const clean = value.filter((entry) => !(typeof entry === "string" && isMalformedAdultMetadataValue(entry)));
      if (clean.length) output[key] = clean;
      continue;
    }
    if (value && typeof value === "object") output[key] = sanitizeAdultMetadataObject(value);
    else output[key] = value;
  }
  return output;
}

function candidateMatchesAdultIdentityAnchor(candidate = {}, anchor = {}, profileType = "performer") {
  if (!candidate) return false;
  const wantedLane = String(profileType || anchor.profileType || "performer").toLowerCase();
  const lane = adultCandidateLane(candidate);
  if (wantedLane === "performer" && lane === "celebrity") return false;
  if (wantedLane === "celebrity" && lane === "performer") return false;
  const anchorName = normalizeAdultIdentityName(anchor.name || "");
  const candidateName = normalizeAdultIdentityName(candidate.name || candidate.title || "");
  if (!anchorName || !candidateName) return true;
  return candidateName === anchorName || candidateName.includes(anchorName) || anchorName.includes(candidateName);
}

function normalizeAdultMetadataCandidateForAggregation(candidate = {}, existingMetadata = {}) {
  const normalized = augmentAdultBodyMetadata(candidate || {}, normalizeAdultCandidateForMetadata(candidate || {}, existingMetadata || {}));
  return sanitizeAdultMetadataObject({ ...normalized, ...(candidate.metadata || {}) });
}

function buildAdultFullMetadataAggregation({ query = "", libraryType = "performers", profileType = "performer", person = {}, candidates = [], seedCandidate = null }) {
  const existingMetadata = person.metadata || person || {};
  const rows = [];
  if (existingMetadata && Object.keys(existingMetadata).length) {
    rows.push({
      id: "existing",
      provider: "existing",
      source: "Existing Homestead metadata",
      sourceLabel: "Existing Homestead metadata",
      confidence: 1,
      sourcePriority: -1,
      matchScore: 100,
      metadata: existingMetadata,
      candidate: { provider: "existing", source: "Existing Homestead metadata", name: person.name || person.title || query },
      weight: 58,
      existing: true,
    });
  }

  const allCandidates = [seedCandidate, ...(candidates || [])].filter(Boolean);
  const seenCandidateKeys = new Set();
  allCandidates.forEach((candidate, index) => {
    const key = `${candidate.provider || candidate.source || "source"}:${candidate.id || candidate.url || candidate.name || index}`.toLowerCase();
    if (seenCandidateKeys.has(key)) return;
    seenCandidateKeys.add(key);
    const metadata = normalizeAdultMetadataCandidateForAggregation(candidate, existingMetadata);
    rows.push({
      id: key,
      provider: candidate.provider || candidate.source || "provider",
      source: adultMetadataSourceLabel(candidate, index),
      sourceLabel: adultMetadataSourceLabel(candidate, index),
      sourceUrl: adultMetadataSourceUrl(candidate),
      confidence: candidate.confidence || 0,
      sourcePriority: candidate.sourcePriority,
      matchScore: candidate.matchScore,
      lowConfidenceFallback: Boolean(candidate.lowConfidenceFallback),
      metadata,
      candidate,
      weight: adultMetadataCandidateWeight(candidate, index),
      existing: false,
    });
  });

  const mergedMetadata = { ...(existingMetadata || {}) };
  const fieldSources = {};
  const conflicts = [];
  const filledFields = [];

  for (const spec of ADULT_FULL_FETCH_FIELDS) {
    const options = [];
    for (const row of rows) {
      const value = row.metadata?.[spec.key];
      if (isEmptyAdultMetadataValue(value)) continue;
      let fieldWeight = row.weight;
      if (typeof value === "string" && isWeakAdultMetadataText(value)) fieldWeight -= 28;
      if (spec.key === "description" && row.metadata?.biography && row.metadata.biography === value) fieldWeight -= 4;
      if (row.existing && typeof value === "string" && isWeakAdultMetadataText(value)) fieldWeight -= 36;
      options.push({
        value,
        valuePreview: Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value),
        source: row.sourceLabel,
        sourceUrl: row.sourceUrl || "",
        provider: row.provider,
        confidence: row.confidence,
        weight: fieldWeight,
        existing: row.existing,
        lowConfidenceFallback: row.lowConfidenceFallback,
      });
    }

    if (!options.length) continue;
    options.sort((a, b) => b.weight - a.weight);
    const chosen = options[0];
    mergedMetadata[spec.key] = chosen.value;
    fieldSources[spec.key] = { ...spec, chosen, options: options.slice(0, 5) };
    filledFields.push(spec.key);

    const uniqueValues = [...new Set(options.map((option) => normalizeAdultMetadataCompareValue(option.value)).filter(Boolean))];
    if (uniqueValues.length > 1) {
      conflicts.push({
        field: spec.key,
        label: spec.label,
        chosen: chosen.valuePreview,
        options: options.slice(0, 4).map((option) => ({ source: option.source, value: option.valuePreview, confidence: option.confidence })),
      });
    }
  }

  const providerIds = {};
  const providerLinks = {};
  const externalIds = {};
  const externalLinks = {};
  for (const row of rows) {
    Object.assign(providerIds, row.metadata?.providerIds || row.metadata?.externalIds || row.candidate?.providerIds || row.candidate?.externalIds || {});
    Object.assign(providerLinks, row.metadata?.providerLinks || row.metadata?.externalLinks || row.candidate?.providerLinks || row.candidate?.externalLinks || {});
  }
  if (Object.keys(providerIds).length) {
    mergedMetadata.providerIds = { ...(mergedMetadata.providerIds || {}), ...providerIds };
    mergedMetadata.externalIds = { ...(mergedMetadata.externalIds || {}), ...providerIds, ...(mergedMetadata.externalIds || {}) };
  }
  if (Object.keys(providerLinks).length) {
    mergedMetadata.providerLinks = { ...(mergedMetadata.providerLinks || {}), ...providerLinks };
    mergedMetadata.externalLinks = { ...(mergedMetadata.externalLinks || {}), ...providerLinks, ...(mergedMetadata.externalLinks || {}) };
  }

  const bestSource = rows.filter((row) => !row.existing).sort((a, b) => b.weight - a.weight)[0] || null;
  mergedMetadata.profileType = profileType;
  mergedMetadata.metadataSource = "full-fetch-aggregation";
  mergedMetadata.metadataFetchedAt = new Date().toISOString();
  mergedMetadata.metadataAggregation = {
    query,
    libraryType,
    profileType,
    sourceCount: rows.filter((row) => !row.existing).length,
    fieldCount: filledFields.length,
    conflictCount: conflicts.length,
    bestSource: bestSource ? { provider: bestSource.provider, source: bestSource.sourceLabel, url: bestSource.sourceUrl || "", confidence: bestSource.confidence } : null,
  };

  const sourceSummary = rows
    .filter((row) => !row.existing)
    .map((row) => ({
      provider: row.provider,
      source: row.sourceLabel,
      url: row.sourceUrl || "",
      confidence: row.confidence,
      priority: row.sourcePriority,
      score: row.matchScore,
      weight: row.weight,
      lowConfidenceFallback: row.lowConfidenceFallback,
      fields: ADULT_FULL_FETCH_FIELDS.filter((spec) => !isEmptyAdultMetadataValue(row.metadata?.[spec.key])).map((spec) => spec.key),
    }))
    .sort((a, b) => b.weight - a.weight);

  const coverage = {
    totalFields: ADULT_FULL_FETCH_FIELDS.length,
    filledFields: filledFields.length,
    percent: Math.round((filledFields.length / Math.max(1, ADULT_FULL_FETCH_FIELDS.length)) * 100),
    conflicts: conflicts.length,
    sources: sourceSummary.length,
  };

  const fieldGroups = ADULT_FULL_FETCH_FIELD_GROUPS.map((group) => ({
    ...group,
    fields: group.fields
      .map(([key, label]) => fieldSources[key] ? { key, label, ...fieldSources[key] } : null)
      .filter(Boolean),
  })).filter((group) => group.fields.length);

  const reviewNotes = [];
  if (!sourceSummary.length) reviewNotes.push("No external metadata sources returned a usable candidate yet.");
  if (conflicts.length) reviewNotes.push(`${conflicts.length} field${conflicts.length === 1 ? " has" : "s have"} conflicting values and should be reviewed before saving.`);
  if (sourceSummary.some((source) => source.lowConfidenceFallback)) reviewNotes.push("Some values came from low-confidence fallback sources; they are source-tagged for review.");

  return {
    metadata: Object.fromEntries(Object.entries(mergedMetadata).filter(([, value]) => !isEmptyAdultMetadataValue(value))),
    fieldSources,
    fieldGroups,
    conflicts,
    coverage,
    sourceSummary,
    reviewNotes,
  };
}

app.post("/api/metadata/adult/person/full-fetch", async (req, res) => {
  try {
    const { person = {}, query = "", profileType = "", libraryType = "", candidate = null, identityAnchor = null, saveToProfile = false } = req.body || {};
    const searchQuery = cleanMetadataQuery(query || person.name || person.title || candidate?.name || candidate?.title || "");
    const normalizedLibrary = libraryType || adultPersonLibraryFromProfileType(profileType || person.profileType || person.library || candidate?.profileType);
    const normalizedProfileType = adultPersonProfileTypeFromLibrary(normalizedLibrary);

    if (!searchQuery) {
      return res.status(400).json({ ok: false, message: "Missing person name/query" });
    }

    const setupConfig = readSetupConfig();
    const searchedCandidates = await searchAdultMetadata(searchQuery, {
      libraryType: normalizedLibrary,
      whisparr: normalizedLibrary === "performers" ? getWhisparrConfig() : {},
      customSourceUrls: getCustomMetadataSourceUrls(setupConfig, normalizedLibrary),
      limit: 20,
      wikidataLimit: normalizedLibrary === "celebrities" ? 8 : 0,
    });
    const anchor = identityAnchor || candidate || { name: searchQuery, profileType: normalizedProfileType, libraryType: normalizedLibrary };
    const compatibleCandidates = searchedCandidates.filter((entry) => candidateMatchesAdultIdentityAnchor(entry, anchor, normalizedProfileType));
    const candidates = [candidate, ...compatibleCandidates].filter(Boolean).filter((entry, index, list) => {
      const key = `${entry.provider || entry.source || "source"}:${entry.id || entry.url || entry.name || index}`.toLowerCase();
      return list.findIndex((other, otherIndex) => `${other.provider || other.source || "source"}:${other.id || other.url || other.name || otherIndex}`.toLowerCase() === key) === index;
    });

    const best = candidate || candidates[0] || null;
    const aggregation = buildAdultFullMetadataAggregation({
      query: searchQuery,
      libraryType: normalizedLibrary,
      profileType: normalizedProfileType,
      person,
      candidates,
      seedCandidate: candidate,
    });

    let saveResult = null;
    if (saveToProfile) {
      const profileDir = findAdultProfileDir({
        libraryType: normalizedLibrary,
        profileId: person.id || "",
        profileName: person.name || person.title || searchQuery,
      });
      if (profileDir) {
        saveResult = writeAdultProfileMetadataFile(profileDir, aggregation.metadata, best, { overwrite: true });
      }
    }

    res.json({
      ok: true,
      phase: 3,
      query: searchQuery,
      libraryType: normalizedLibrary,
      profileType: normalizedProfileType,
      best,
      candidate: best,
      anchorCandidate: candidate || best,
      candidates: candidates.map((entry) => normalizeAdultPersonCandidateForUi(entry, searchQuery, normalizedProfileType)),
      metadata: aggregation.metadata,
      mergedMetadata: aggregation.metadata,
      aggregation,
      fieldSources: aggregation.fieldSources,
      fieldGroups: aggregation.fieldGroups,
      conflicts: aggregation.conflicts,
      coverage: aggregation.coverage,
      sourceSummary: aggregation.sourceSummary,
      reviewNotes: aggregation.reviewNotes,
      saveResult,
      message: aggregation.sourceSummary.length
        ? `Aggregated ${aggregation.coverage.filledFields} metadata fields from ${aggregation.sourceSummary.length} source${aggregation.sourceSummary.length === 1 ? "" : "s"}.`
        : "No metadata candidates found yet; saved source links remain available for manual review.",
    });
  } catch (error) {
    console.error("Adult person full fetch failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult person full fetch failed" });
  }
});


function normalizeAdultPhotoDestination(value = "photos") {
  const normalized = String(value || "photos").trim().toLowerCase();
  if (["nude", "nudes", "adult", "explicit", "adult-set", "adultset"].includes(normalized)) return "nudes";
  if (["poster", "profile-poster", "profileposter"].includes(normalized)) return "poster";
  if (["banner", "hero", "profile-banner", "profilebanner"].includes(normalized)) return "banner";
  if (["art", "artwork"].includes(normalized)) return "artwork";
  if (["reference", "references", "source"].includes(normalized)) return "references";
  return "photos";
}

function buildAdultImportedMediaRecord({ type = "photo", destination = "photos", source = "external", sourceUrl = "", filename = "", relativeDestination = "", contentType = "", bytes = 0 }) {
  return {
    id: `adult-media-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    destination,
    source,
    sourceUrl,
    filename,
    relativeDestination,
    contentType,
    bytes,
    importedAt: new Date().toISOString(),
  };
}

function adultImportRecordTypeForDestination(destination = "photos") {
  if (destination === "nudes") return "nude";
  if (destination === "poster") return "poster";
  if (destination === "banner") return "banner";
  if (destination === "references") return "reference";
  if (destination === "artwork") return "artwork";
  return "photo";
}

function adultLibraryIdFromProfileLibrary(libraryType = "performers") {
  const normalized = String(libraryType || "performers").trim().toLowerCase();
  if (normalized === "celebrities") return "celebrities";
  if (normalized === "personal" || normalized === "girls") return "personal";
  return "performers";
}

function appendAdultMediaImportRecords(profileDir, records = []) {
  const cleanRecords = records.filter(Boolean);
  if (!cleanRecords.length) return null;

  const metadataPath = path.join(profileDir, "metadata.json");
  const existing = readJsonIfExists(metadataPath, { metadata: {} });
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
  const mediaImports = Array.isArray(metadata.mediaImports) ? metadata.mediaImports : [];
  const imports = Array.isArray(metadata.imports) ? metadata.imports : [];
  const next = {
    ...(existing.metadata ? existing : { metadata }),
    metadata: {
      ...metadata,
      mediaImports: [...cleanRecords, ...mediaImports].slice(0, 500),
      imports: [...cleanRecords, ...imports].slice(0, 500),
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));
  return { metadataPath, count: cleanRecords.length };
}

app.post("/api/metadata/adult/person/import-photos", async (req, res) => {
  try {
    const {
      person = {},
      profileType = "",
      libraryType: rawLibraryType = "",
      photos = [],
      imageUrls = [],
      destination: rawDestination = "photos",
      importDestination = "",
      sourceName = "external",
    } = req.body || {};
    const libraryType = rawLibraryType || adultPersonLibraryFromProfileType(profileType || person.profileType || person.library);
    const profileDir = findAdultProfileDir({
      libraryType,
      profileId: person.id || "",
      profileName: person.name || person.title || "",
      profileDir: person.profileDir || "",
      folderPath: person.folderPath || "",
      sourcePath: person.sourcePath || person.path || "",
      filePath: person.filePath || "",
    });

    if (!profileDir) {
      return res.status(404).json({ ok: false, message: "Could not find profile folder for photo import." });
    }

    const defaultDestination = normalizeAdultPhotoDestination(importDestination || rawDestination || "photos");
    const inputs = [...photos, ...imageUrls]
      .map((entry) => (typeof entry === "string" ? { url: entry } : entry))
      .filter((entry) => entry?.url)
      .slice(0, 40);

    if (!inputs.length) {
      return res.status(400).json({ ok: false, message: "No selected photo URLs were provided." });
    }

    const imported = [];
    const failed = [];

    for (const [index, photo] of inputs.entries()) {
      try {
        const destination = normalizeAdultPhotoDestination(photo.destination || photo.importDestination || defaultDestination);
        if (!ADULT_PHOTO_IMPORT_DESTINATIONS.has(destination)) {
          throw new Error(`Unsupported destination: ${destination}`);
        }
        const parsed = new URL(photo.url);
        const ext = path.extname(parsed.pathname).replace(/[^.a-z0-9]/gi, "").slice(0, 6) || ".jpg";
        const sourceBaseName = sanitizeAdultImportSegment(path.basename(parsed.pathname, path.extname(parsed.pathname)) || `image-${index + 1}`);
        const filename = ["poster", "banner"].includes(destination)
          ? `${destination}${ext}`
          : `${Date.now()}-${index + 1}-${sourceBaseName}${ext}`;
        const destinationPath = ["poster", "banner"].includes(destination)
          ? path.join(profileDir, filename)
          : path.join(profileDir, destination, filename);
        const result = await downloadAdultProfileImage(photo.url, destinationPath);
        const record = buildAdultImportedMediaRecord({
          type: adultImportRecordTypeForDestination(destination),
          destination,
          source: photo.source || photo.provider || sourceName || "external",
          sourceUrl: photo.url,
          filename,
          relativeDestination: path.relative(profileDir, destinationPath),
          contentType: result.contentType,
          bytes: result.bytes,
        });
        imported.push({ ...record, path: result.path });
      } catch (error) {
        failed.push({ url: photo.url, message: error.message });
      }
    }

    const metadataUpdate = appendAdultMediaImportRecords(profileDir, imported);
    runMediaScan();
    const scanLibrary = adultLibraryIdFromProfileLibrary(libraryType);

    res.json({
      ok: true,
      profileDir,
      destination: defaultDestination,
      imported,
      failed,
      metadataUpdate,
      scanRequested: true,
      scanLibrary,
      profileName: person.name || person.title || "",
      profileId: person.id || path.basename(profileDir),
      libraryType,
      message: `Imported ${imported.length} image${imported.length === 1 ? "" : "s"} to ${["poster", "banner"].includes(defaultDestination) ? defaultDestination + ".jpg" : `/${defaultDestination}`}${failed.length ? `; ${failed.length} failed.` : "."}`,
    });
  } catch (error) {
    console.error("Adult photo import failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult photo import failed" });
  }
});

app.get("/api/metadata/adult/search", async (req, res) => {
  try {
    const query = cleanMetadataQuery(req.query.query || req.query.q || "");
    const libraryType = req.query.libraryType || "personal";

    if (!query) {
      return res.status(400).json({ ok: false, message: "Missing query" });
    }

    const setupConfig = readSetupConfig();
    const candidates = await searchAdultMetadata(query, {
      libraryType,
      whisparr: getWhisparrConfig(),
      customSourceUrls: getCustomMetadataSourceUrls(setupConfig, libraryType),
    });

    res.json({ ok: true, query, libraryType, candidates });
  } catch (error) {
    console.error("Adult metadata search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult metadata search failed" });
  }
});

app.post("/api/metadata/adult/fetch", async (req, res) => {
  try {
    const { person = {}, query = "", libraryType = "" } = req.body || {};
    const searchQuery = cleanMetadataQuery(query || person.name || person.title || person.id || "");
    const normalizedLibrary = libraryType || person.library || "personal";

    if (!searchQuery) {
      return res.status(400).json({ ok: false, message: "Missing person name/query" });
    }

    const setupConfig = readSetupConfig();
    const candidates = await searchAdultMetadata(searchQuery, {
      libraryType: normalizedLibrary,
      whisparr: getWhisparrConfig(),
      customSourceUrls: getCustomMetadataSourceUrls(setupConfig, normalizedLibrary),
    });

    const best = candidates[0] || null;
    const metadata = best
      ? augmentAdultBodyMetadata(best, normalizeAdultCandidateForMetadata(best, person.metadata || {}))
      : { ...(person.metadata || {}) };

    res.json({
      ok: true,
      query: searchQuery,
      libraryType: normalizedLibrary,
      best,
      candidates,
      metadata,
      route: best?.provider || "none",
      message: best ? `Fetched ${best.source || best.provider} metadata for ${best.name || searchQuery}` : "No metadata candidates found",
    });
  } catch (error) {
    console.error("Adult metadata fetch failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult metadata fetch failed" });
  }
});


function normalizeSocialPlatformKey(value = "") {
  return String(value || "website")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "website";
}

function inferSocialPlatformFromUrl(url = "") {
  const value = String(url || "").toLowerCase();
  if (value.includes("instagram.com")) return "instagram";
  if (value.includes("threads.net")) return "threads";
  if (value.includes("tiktok.com")) return "tiktok";
  if (value.includes("twitter.com") || value.includes("x.com")) return "twitter";
  if (value.includes("facebook.com") || value.includes("fb.com")) return "facebook";
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube";
  if (value.includes("snapchat.com")) return "snapchat";
  if (value.includes("tumblr.com")) return "tumblr";
  if (value.includes("reddit.com")) return "reddit";
  if (value.includes("twitch.tv")) return "twitch";
  if (value.includes("patreon.com")) return "patreon";
  if (value.includes("onlyfans.com")) return "onlyfans";
  if (value.includes("fansly.com")) return "fansly";
  if (value.includes("spotify.com")) return "spotify";
  if (value.includes("music.apple.com") || value.includes("itunes.apple.com")) return "apple-music";
  if (value.includes("soundcloud.com")) return "soundcloud";
  if (value.includes("linktr.ee")) return "linktree";
  if (value.includes("beacons.ai")) return "beacons";
  if (value.includes("allmylinks.com") || value.includes("campsite.bio") || value.includes("bio.site")) return "linkhub";
  return "website";
}

function getHandleFromSocialProfileUrl(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    const parts = parsed.pathname.split("/").filter(Boolean);
    const first = parts[0] || "";
    if (!first) return "";
    const lowerHost = parsed.hostname.toLowerCase();
    const lowerFirst = first.toLowerCase();
    if (lowerHost.includes("spotify.com") && ["artist", "user", "show", "playlist", "album"].includes(lowerFirst)) {
      return parts[1] ? `@${String(parts[1]).replace(/^@/, "")}` : "";
    }
    if (lowerHost.includes("music.apple.com")) {
      const last = parts[parts.length - 1] || "";
      return last ? `@${String(last).replace(/^@/, "")}` : "";
    }
    if (["user", "channel", "c", "watch", "shorts", "reel", "p", "artist"].includes(lowerFirst)) {
      return parts[1] ? `@${String(parts[1]).replace(/^@/, "")}` : "";
    }
    return `@${String(first).replace(/^@/, "")}`;
  } catch {
    return "";
  }
}

function flattenSocialLinksBlock(source = {}) {
  const rows = [];
  if (!source) return rows;

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item) continue;
      const record = typeof item === "string" ? { url: item } : { ...item };
      const platform = normalizeSocialPlatformKey(record.platform || record.site || record.label || inferSocialPlatformFromUrl(record.url || ""));
      rows.push({ ...record, platform });
    }
    return rows;
  }

  if (typeof source === "object") {
    for (const [platformKey, value] of Object.entries(source)) {
      if (!value) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const record = typeof item === "string" ? { url: item } : { ...item };
        const url = record.url || record.href || record.link || record.profileUrl || "";
        if (!url) continue;
        const platform = normalizeSocialPlatformKey(record.platform || platformKey || inferSocialPlatformFromUrl(url));
        rows.push({ ...record, platform, url });
      }
    }
  }

  return rows;
}

function socialLinksArrayToBlockServer(links = []) {
  const block = {};
  for (const link of links) {
    const url = link.url || link.href || link.link || link.profileUrl || "";
    if (!url) continue;
    const platform = normalizeSocialPlatformKey(link.platform || inferSocialPlatformFromUrl(url));
    const record = {
      platform,
      url,
      handle: link.handle || link.username || getHandleFromSocialProfileUrl(url),
      avatar: link.avatar || link.avatarUrl || link.profileImage || link.image || link.poster || "",
      title: link.title || "",
      description: link.description || "",
      source: link.source || "metadata.json",
      status: link.status || "saved",
      fetchStatus: link.fetchStatus || "",
      fetchedAt: link.fetchedAt || "",
      note: link.note || "",
    };

    if (!block[platform]) block[platform] = record;
    else if (Array.isArray(block[platform])) block[platform].push(record);
    else block[platform] = [block[platform], record];
  }
  return block;
}

function decodeHtmlEntity(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getHtmlMetaContent(html = "", names = []) {
  for (const name of names) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const propertyFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
    const match = html.match(propertyFirst) || html.match(contentFirst);
    if (match?.[1]) return decodeHtmlEntity(match[1].trim());
  }
  return "";
}

function getHtmlTitle(html = "") {
  const match = String(html || "").match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntity(match[1].trim()) : "";
}

function absolutizeUrl(value = "", baseUrl = "") {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function getSafeImageExtension(contentType = "", imageUrl = "") {
  const lowerType = String(contentType || "").toLowerCase();
  const lowerUrl = String(imageUrl || "").toLowerCase().split("?")[0];
  if (lowerType.includes("png") || lowerUrl.endsWith(".png")) return ".png";
  if (lowerType.includes("webp") || lowerUrl.endsWith(".webp")) return ".webp";
  if (lowerType.includes("gif") || lowerUrl.endsWith(".gif")) return ".gif";
  return ".jpg";
}

async function fetchSocialPageMetadata(url = "") {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Homestead/1.0; +https://homestead.local)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`);
  }

  const html = await response.text();
  const image = absolutizeUrl(
    getHtmlMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image:src", "twitter:image", "thumbnail"]),
    url
  );

  return {
    title: getHtmlMetaContent(html, ["og:title", "twitter:title"]) || getHtmlTitle(html),
    description: getHtmlMetaContent(html, ["og:description", "twitter:description", "description"]),
    image,
    siteName: getHtmlMetaContent(html, ["og:site_name"]),
    canonicalUrl: absolutizeUrl(getHtmlMetaContent(html, ["og:url"]) || url, url),
  };
}

async function downloadSocialAvatar({ imageUrl = "", profileDir = "", platform = "website" }) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return "";

  const response = await fetch(imageUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Homestead/1.0; +https://homestead.local)",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Fetched avatar was not an image (${contentType})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) throw new Error("Fetched avatar was empty.");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("Fetched avatar was larger than 8 MB.");

  const socialDir = path.join(profileDir, "social");
  fs.mkdirSync(socialDir, { recursive: true });
  const extension = getSafeImageExtension(contentType, imageUrl);
  const safePlatform = normalizeSocialPlatformKey(platform);
  const destination = path.join(socialDir, `${safePlatform}${extension}`);
  fs.writeFileSync(destination, buffer);
  return destination;
}

app.post("/api/metadata/social/fetch", async (req, res) => {
  try {
    const { person = {}, links = null, downloadAvatars = true } = req.body || {};
    const libraryType = person.library || person.libraryType || "personal";
    const profileDir = findAdultProfileDir({
      libraryType,
      profileId: person.id || "",
      profileName: person.name || person.title || "",
    });

    if (!profileDir) {
      return res.status(404).json({
        ok: false,
        message: "Could not find the profile folder. Rescan or check folder mappings.",
      });
    }

    const file = readAdultProfileMetadataFile(profileDir);
    const existingMetadata = file.metadata || {};
    const requestedLinks = Array.isArray(links) && links.length
      ? links
      : flattenSocialLinksBlock(existingMetadata.socialLinks || person.metadata?.socialLinks || person.socialLinks || {});

    if (!requestedLinks.length) {
      return res.status(400).json({
        ok: false,
        message: "No social links found to fetch. Add or auto-detect links first.",
      });
    }

    const results = [];
    const updatedLinks = [];

    for (const link of requestedLinks) {
      const url = link.url || link.href || link.link || link.profileUrl || "";
      const platform = normalizeSocialPlatformKey(link.platform || inferSocialPlatformFromUrl(url));
      if (!url || !/^https?:\/\//i.test(url)) {
        results.push({ ...link, platform, fetchStatus: "skipped", fetchError: "Missing or unsupported URL." });
        updatedLinks.push({ ...link, platform, fetchStatus: "skipped" });
        continue;
      }

      try {
        const pageMeta = await fetchSocialPageMetadata(url);
        let avatar = link.avatar || link.avatarUrl || link.profileImage || link.image || link.poster || "";

        if (downloadAvatars && pageMeta.image) {
          try {
            avatar = await downloadSocialAvatar({ imageUrl: pageMeta.image, profileDir, platform });
          } catch (imageError) {
            avatar = avatar || pageMeta.image;
            results.push({ platform, url, imageFetchWarning: imageError.message });
          }
        } else if (pageMeta.image) {
          avatar = pageMeta.image;
        }

        const updated = {
          ...link,
          platform,
          url: pageMeta.canonicalUrl || url,
          handle: link.handle || link.username || getHandleFromSocialProfileUrl(url),
          avatar,
          title: pageMeta.title || link.title || "",
          description: pageMeta.description || link.description || "",
          source: "auto-fetched",
          status: "saved",
          fetchStatus: "ok",
          fetchedAt: new Date().toISOString(),
        };
        updatedLinks.push(updated);
        results.push(updated);
      } catch (error) {
        const updated = {
          ...link,
          platform,
          url,
          handle: link.handle || link.username || getHandleFromSocialProfileUrl(url),
          source: link.source || "metadata.json",
          fetchStatus: "failed",
          fetchError: error.message || "Fetch failed",
          fetchedAt: new Date().toISOString(),
        };
        updatedLinks.push(updated);
        results.push(updated);
      }
    }

    const nextMetadata = {
      ...existingMetadata,
      socialLinks: socialLinksArrayToBlockServer(updatedLinks),
      socialLinksFetchedAt: new Date().toISOString(),
    };

    const writeResult = writeAdultProfileMetadataFile(profileDir, nextMetadata, null);

    res.json({
      ok: true,
      profileDir,
      metadataPath: writeResult.metadataPath,
      metadata: writeResult.metadata,
      socialLinks: writeResult.metadata.socialLinks,
      results,
      message: `Fetched social metadata for ${results.length} link${results.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    console.error("Social metadata fetch failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Social metadata fetch failed" });
  }
});




app.post("/api/metadata/adult/apply", async (req, res) => {
  try {
    const { person = {}, metadata = {}, candidate = null, libraryType: bodyLibraryType = "" } = req.body || {};
    const libraryType = bodyLibraryType || person.library || "personal";
    const profileDir = findAdultProfileDir({
      libraryType,
      profileId: person.id || "",
      profileName: person.name || person.title || "",
    });

    if (!profileDir) {
      return res.status(404).json({
        ok: false,
        message: "Could not find the profile folder. Rescan or check folder mappings.",
      });
    }

    const result = writeAdultProfileMetadataFile(profileDir, augmentAdultBodyMetadata(candidate || {}, metadata), candidate);
    runMediaScan(adultLibraryIdFromProfileLibrary(libraryType));
    res.json({
      ok: true,
      profileDir,
      metadataPath: result.metadataPath,
      metadata: result.metadata,
      file: result.file,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(libraryType),
      message: "Metadata saved and this profile was queued for immediate reindexing.",
    });
  } catch (error) {
    console.error("Adult metadata apply failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult metadata apply failed" });
  }
});


app.post("/api/metadata/adult/match", async (req, res) => {
  try {
    const { person = {}, metadata = {}, candidate = null } = req.body || {};
    const libraryType = person.library || "personal";
    const profileDir = findAdultProfileDir({
      libraryType,
      profileId: person.id || "",
      profileName: person.name || person.title || "",
    });

    if (!profileDir) {
      return res.status(404).json({ ok: false, message: "Could not find the profile folder. Rescan or check folder mappings." });
    }

    const enrichedMetadata = augmentAdultBodyMetadata(candidate || {}, metadata);
    const match = enrichedMetadata.metadataMatch || getAdultMetadataMatchFromCandidate(candidate);
    if (!match) {
      return res.status(400).json({ ok: false, message: "No selected metadata match to save." });
    }

    const result = writeAdultProfileMetadataFile(profileDir, { metadataMatch: match }, candidate);
    runMediaScan(adultLibraryIdFromProfileLibrary(libraryType));
    res.json({
      ok: true,
      profileDir,
      metadataPath: result.metadataPath,
      metadata: result.metadata,
      file: result.file,
      message: "Fix Match saved and returned to the active profile view.",
    });
  } catch (error) {
    console.error("Adult metadata match save failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult metadata match save failed" });
  }
});

function adultMetadataNeedsUpdate(metadata = {}, overwrite = false) {
  if (overwrite) return true;
  const body = metadata.body || metadata.bodyDetails || {};
  const hasBody = metadata.height || metadata.measurements || metadata.measurementsRaw || body.height || body.measurementsRaw || metadata.tattoos?.length || metadata.piercings?.length;
  return !(metadata.birthday || metadata.birthDate) || !(metadata.biography || metadata.description) || !metadata.metadataMatch || !hasBody;
}

app.post("/api/metadata/adult/bulk-fetch", async (req, res) => {
  try {
    const { libraryType = "personal", overwrite = false, limit = 500 } = req.body || {};
    const profiles = listAdultProfileDirs(libraryType).slice(0, Number(limit) || 500);
    const report = [];
    let checked = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const profile of profiles) {
      checked += 1;
      try {
        if (!adultMetadataNeedsUpdate(profile.metadata || {}, overwrite)) {
          skipped += 1;
          report.push({ name: profile.name, status: "skipped", reason: "metadata already filled" });
          continue;
        }

        const setupConfig = readSetupConfig();
        const candidates = await searchAdultMetadata(profile.name, {
          libraryType,
          whisparr: getWhisparrConfig(),
          customSourceUrls: getCustomMetadataSourceUrls(setupConfig, libraryType),
          limit: 4,
        });
        const best = candidates[0] || null;

        if (!best) {
          skipped += 1;
          report.push({ name: profile.name, status: "no-match" });
          continue;
        }

        const patch = augmentAdultBodyMetadata(best, normalizeAdultCandidateForMetadata(best, overwrite ? {} : (profile.metadata || {})));
        writeAdultProfileMetadataFile(profile.profileDir, patch, best, { overwrite });
        updated += 1;
        report.push({ name: profile.name, status: "updated", provider: best.provider, matchedName: best.name || best.title });
      } catch (error) {
        failed += 1;
        report.push({ name: profile.name, status: "failed", message: error.message });
      }
    }

    res.json({ ok: true, libraryType, checked, updated, skipped, failed, report });
  } catch (error) {
    console.error("Adult metadata bulk fetch failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult metadata bulk fetch failed" });
  }
});



app.get("/api/integrations/whisparr/status", async (req, res) => {
  const { baseUrl, apiKey } = getWhisparrConfig();
  const configured = Boolean(baseUrl && apiKey);

  if (!configured) {
    return res.json({
      ok: true,
      configured: false,
      connected: false,
      baseUrl: baseUrl || "",
      apiKeyPresent: Boolean(apiKey),
      message: "Whisparr is not configured yet.",
    });
  }

  try {
    const system = await fetchWhisparrApi("/api/v3/system/status");
    res.json({
      ok: true,
      configured: true,
      connected: true,
      baseUrl,
      apiKeyPresent: true,
      version: system?.version || "",
      appName: system?.appName || "Whisparr",
      message: system?.version ? `Connected to Whisparr ${system.version}` : "Connected to Whisparr.",
      system,
    });
  } catch (error) {
    res.json({
      ok: false,
      configured: true,
      connected: false,
      baseUrl,
      apiKeyPresent: true,
      message: error.message || "Whisparr connection failed",
    });
  }
});

app.get("/api/discovery/adult/whisparr-search", async (req, res) => {
  try {
    const query = cleanMetadataQuery(req.query.q || req.query.query || "");

    if (!query) {
      return res.status(400).json({ ok: false, message: "Missing query" });
    }

    const { baseUrl, apiKey } = getWhisparrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        configured: false,
        connected: false,
        message: "Configure Whisparr URL/API key first.",
      });
    }

    const setupConfig = readSetupConfig();
    const discovery = await discoverAdultPerformer(query, {
      setupConfig,
      mode: "requestSelected",
      whisparr: { baseUrl, apiKey },
    });

    res.json({
      ok: true,
      configured: true,
      connected: true,
      query,
      scenes: discovery.scenes || [],
      discovery,
      message: `Whisparr search finished for ${query}.`,
    });
  } catch (error) {
    console.error("Whisparr adult discovery search failed:", error);
    res.status(error.status || 500).json({
      ok: false,
      configured: true,
      connected: false,
      message: error.message || "Whisparr search failed",
      data: error.data || null,
    });
  }
});

app.get("/api/adult/sources", (req, res) => {
  try {
    const setupConfig = setupConfigWithHomesteadAdultBrowseSources(
      readSetupConfig()
    );
    res.json({
      ok: true,
      sources: getConfiguredAdultSources(setupConfig),
      mode: setupConfig.adultWhisparrMode || setupConfig?.libraryPreferences?.adult?.whisparrMode || "browse",
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Could not load adult sources" });
  }
});

app.post("/api/adult/sources", (req, res) => {
  try {
    const setupConfig = readSetupConfig();
    const sources = mergeHomesteadAdultBrowseSources(
      Array.isArray(req.body?.sources)
        ? req.body.sources
        : getConfiguredAdultSources(setupConfig)
    );
    const adultWhisparrMode = req.body?.mode || setupConfig.adultWhisparrMode || "browse";
    const nextConfig = {
      ...setupConfig,
      adultMetadataSources: sources,
      adultWhisparrMode,
      libraryPreferences: {
        ...(setupConfig.libraryPreferences || {}),
        adult: {
          ...(setupConfig.libraryPreferences?.adult || {}),
          metadataSources: sources,
          whisparrMode: adultWhisparrMode,
        },
      },
    };

    writeJsonFile(setupConfigPath, nextConfig);
    res.json({ ok: true, sources, mode: adultWhisparrMode, config: nextConfig });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Could not save adult sources" });
  }
});

app.get("/api/discovery/adult/search", async (req, res) => {
  try {
    const query = cleanMetadataQuery(req.query.q || req.query.query || "");
    const mode = req.query.mode || "browse";

    if (!query) {
      return res.status(400).json({ ok: false, message: "Missing query" });
    }

    const setupConfig = readSetupConfig();
    const discovery = await discoverAdultPerformer(query, {
      setupConfig,
      mode,
      whisparr: getWhisparrConfig(),
    });

    res.json(discovery);
  } catch (error) {
    console.error("Adult discovery search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult discovery search failed" });
  }
});





const adultProviderProbeCache = new Map();

function decodeBasicHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function resolveProviderAssetUrl(value = "", baseUrl = "") {
  const cleaned = decodeBasicHtmlEntities(value).trim();
  if (!cleaned || /^data:/i.test(cleaned) || /^javascript:/i.test(cleaned)) return "";
  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return "";
  }
}

function stripProviderHtml(value = "") {
  return decodeBasicHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function extractProviderBrowseCards(html = "", pageUrl = "", limit = 16) {
  const cards = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) && cards.length < limit) {
    const href = resolveProviderAssetUrl(match[2], pageUrl);
    if (!href || seen.has(href)) continue;

    const body = match[4] || "";
    const imageMatch = body.match(/<img\b[^>]*(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["'][^>]*>/i);
    const titleAttrMatch = body.match(/<img\b[^>]*(?:alt|title)\s*=\s*["']([^"']+)["'][^>]*>/i);
    const headingMatch = body.match(/<(?:h[1-6]|strong|span|div)\b[^>]*>([^<]{2,120})<\/(?:h[1-6]|strong|span|div)>/i);
    const text = stripProviderHtml(body);
    const title = stripProviderHtml(titleAttrMatch?.[1] || headingMatch?.[1] || text).slice(0, 120);
    const imageUrl = resolveProviderAssetUrl(imageMatch?.[1] || "", pageUrl);

    if (!imageUrl && title.length < 2) continue;
    seen.add(href);
    cards.push({
      id: crypto.createHash("sha1").update(href).digest("hex").slice(0, 12),
      title: title || new URL(href).pathname.split("/").filter(Boolean).pop() || "Browse item",
      url: href,
      imageUrl,
    });
  }

  return cards;
}

function detectProviderPagination(html = "", pageUrl = "") {
  const patterns = [
    /<a\b[^>]*rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i,
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*(?:next|older|more|Ã¢â‚¬Âº|Ã‚Â»)\s*<\/a>/i,
    /<link\b[^>]*rel\s*=\s*["']next["'][^>]*href\s*=\s*["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return resolveProviderAssetUrl(match[1], pageUrl);
  }
  return "";
}

function getProviderProbeRecommendation({ fetchOk, cards = [], embedBlocked, challengeDetected, requiresSession }) {
  if (!fetchOk || challengeDetected) return "external-only";
  if (cards.length >= 4) return "internal-browse";
  if (cards.length > 0) return "internal-preview";
  if (!embedBlocked && !requiresSession) return "embed-preview";
  return "external-only";
}

async function probeAdultBrowseProvider(source = {}, { force = false } = {}) {
  const sourceId = String(source.id || source.name || source.baseUrl || "").trim();
  const targetUrl = source.baseUrl || source.searchUrlTemplate?.replaceAll("{query}", "").replaceAll("{queryPlus}", "").replaceAll("{querySlug}", "");
  if (!targetUrl) throw new Error("This provider does not have a browse URL.");

  const cacheKey = `${sourceId}:${targetUrl}`;
  const cached = adultProviderProbeCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.cachedAt < 15 * 60 * 1000) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;
  let html = "";
  let fetchError = "";

  try {
    response = await fetch(targetUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HomesteadProviderProbe/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    html = await response.text();
  } catch (error) {
    fetchError = error.name === "AbortError" ? "Provider request timed out." : (error.message || "Provider request failed.");
  } finally {
    clearTimeout(timeout);
  }

  const finalUrl = response?.url || targetUrl;
  const xFrame = String(response?.headers?.get("x-frame-options") || "").toLowerCase();
  const csp = String(response?.headers?.get("content-security-policy") || "").toLowerCase();
  const embedBlocked = Boolean(
    xFrame.includes("deny") ||
    xFrame.includes("sameorigin") ||
    /frame-ancestors\s+[^;]*(?:'none'|'self')/i.test(csp)
  );
  const challengeDetected = /cloudflare|captcha|access denied|checking your browser|enable javascript|bot verification/i.test(html.slice(0, 120000));
  const requiresSession = Boolean(source.requiresSession || /sign in|log in|members only|subscription required/i.test(html.slice(0, 120000)));
  const cards = response?.ok && !challengeDetected ? extractProviderBrowseCards(html, finalUrl, 160) : [];
  const nextPageUrl = detectProviderPagination(html, finalUrl);
  const firstImageUrl = cards.find((card) => card.imageUrl)?.imageUrl || "";
  const imageNeedsProxy = Boolean(firstImageUrl && new URL(firstImageUrl).hostname !== new URL(finalUrl).hostname);
  const recommendation = getProviderProbeRecommendation({
    fetchOk: Boolean(response?.ok),
    cards,
    embedBlocked,
    challengeDetected,
    requiresSession,
  });

  const result = {
    ok: Boolean(response?.ok),
    sourceId,
    sourceName: source.name || sourceId,
    requestedUrl: targetUrl,
    finalUrl,
    status: response?.status || 0,
    contentType: response?.headers?.get("content-type") || "",
    fetchError,
    embed: {
      blocked: embedBlocked,
      xFrameOptions: response?.headers?.get("x-frame-options") || "",
      contentSecurityPolicy: response?.headers?.get("content-security-policy") || "",
    },
    parsing: {
      working: cards.length > 0,
      cardCount: cards.length,
      sampleCards: cards.slice(0, 12),
      categoryCards: cards,
    },
    images: {
      sampleUrl: firstImageUrl,
      mode: !firstImageUrl ? "unknown" : imageNeedsProxy ? "proxy-recommended" : "direct",
    },
    pagination: {
      working: Boolean(nextPageUrl),
      nextPageUrl,
    },
    challengeDetected,
    requiresSession,
    recommendation,
    testedAt: new Date().toISOString(),
  };

  adultProviderProbeCache.set(cacheKey, { cachedAt: Date.now(), value: result });
  return result;
}




const ADULT_BROWSE_CATEGORY_DEFINITIONS = {
  teen: ["teen", "18+", "young", "college"],
  petite: ["petite", "small frame", "slim", "tiny"],
  ass: ["ass", "butt", "booty"],
  anal: ["anal"],
  blonde: ["blonde", "blondes"],
  brunette: ["brunette", "brunettes"],
  redhead: ["redhead", "redheads", "ginger"],
  amateur: ["amateur", "homemade"],
  lesbian: ["lesbian", "girl girl"],
  solo: ["solo", "masturbation"],
  lingerie: ["lingerie"],
  panties: ["panties", "panty", "underwear", "briefs", "thong", "g-string", "panty shot", "pantyshot", "upskirt"],
  bikini: ["bikini", "bikinis"],
  clothed: ["clothed", "clothes", "dressed"],
  cute: ["cute"],
  feet: ["feet", "foot"],
  girlfriend: ["girlfriend", "girlfriends"],
  hairy: ["hairy", "natural hair"],
  legs: ["legs", "leggy"],
  sexy: ["sexy"],
  skirt: ["skirt", "skirts"],
  "small-tits": ["small tits", "small breasts", "small boobs", "tiny tits"],
  "sugar-baby": ["sugar baby", "sugar babies"],
  undressing: ["undressing", "strip", "stripping"],
  white: ["white", "caucasian"],
  outdoor: ["outdoor", "public"],
  wife: ["wife", "wives"],
  mature: ["mature", "milf", "cougar"],
  asian: ["asian"],
  ebony: ["ebony", "black"],
  latina: ["latina", "latin"],
  tattoos: ["tattoo", "tattoos", "inked"],
  cosplay: ["cosplay", "costume"],
  vr: ["vr", "virtual reality"],
};

const ADULT_BROWSE_EXCLUDED_TERMS = [
  /\bunderage\b/i,
  /\bunder\s*18\b/i,
  /\bi\s+am\s+under\s*18\b/i,
  /\bminor\b/i,
  /\bchild\b/i,
  /\bkid\b/i,
  /\bpreteen\b/i,
];


function adultBrowseCategoryMatches(item = {}, aliases = []) {
  const haystack = [
    item.title,
    item.url,
    item.sourceName,
    item.sourceCategory,
  ].filter(Boolean).join(" ");

  if (ADULT_BROWSE_EXCLUDED_TERMS.some((pattern) => pattern.test(haystack))) return false;
  return aliases.some((term) => new RegExp(`\\b${String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack));
}

async function buildAdultBrowseCategory(categoryId = "") {
  const aliases = ADULT_BROWSE_CATEGORY_DEFINITIONS[categoryId];
  if (!aliases) throw new Error("Unknown Adult Browse category.");

  const setupConfig = readSetupConfig();
  const sources = getConfiguredAdultSources(setupConfig).filter(sourceSupportsAdultBrowse);
  const results = [];
  let testedCount = 0;

  const concurrency = 4;
  for (let index = 0; index < sources.length; index += concurrency) {
    const batch = sources.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(async (source) => {
      try {
        const probe = await probeAdultBrowseProvider(source, { force: false });
        testedCount += 1;
        const parsedCards = Array.isArray(probe?.parsing?.categoryCards)
          ? probe.parsing.categoryCards
          : Array.isArray(probe?.parsing?.sampleCards)
            ? probe.parsing.sampleCards
            : [];

        const matchedCards = parsedCards
          .map((card) => ({
            ...card,
            sourceId: source.id,
            sourceName: source.name,
            sourceCategory: source.category || "",
            recommendation: probe.recommendation,
          }))
          .filter((item) => adultBrowseCategoryMatches(item, aliases));
        return matchedCards;
      } catch {
        return [];
      }
    }));
    batchResults.flat().forEach((item) => results.push(item));
  }

  const seen = new Set();
  const items = results
    .filter((item) => {
      const key = String(item.url || `${item.sourceId}:${item.title}`).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.sourceName).localeCompare(String(b.sourceName)) || String(a.title).localeCompare(String(b.title)));

  return {
    id: categoryId,
    title: categoryId.replace(/(^|-)(\w)/g, (_, __, letter) => ` ${letter.toUpperCase()}`).trim(),
    providerCount: sources.length,
    testedCount,
    items,
    builtAt: new Date().toISOString(),
  };
}



app.post("/api/discovery/adult/browse-collection", async (req, res) => {
  try {
    const categoryId = String(req.body?.categoryId || "").trim();
    const collection = await buildAdultBrowseCategory(categoryId);
    res.json({ ok: true, collection });
  } catch (error) {
    console.error("Adult browse collection build failed:", error);
    const status = /Unknown Adult Browse category/i.test(error.message || "") ? 400 : 500;
    res.status(status).json({
      ok: false,
      message: error.message || "Unable to build Adult Browse collection.",
    });
  }
});


const INTERNAL_ADULT_BROWSE_ADAPTERS = new Set(["coedcherry"]);

function assertConfiguredInternalBrowseUrl(source = {}, rawUrl = "") {
  const url = new URL(String(rawUrl || source.baseUrl || ""));
  const sourceHost = new URL(source.baseUrl).hostname.replace(/^www\./, "");
  const targetHost = url.hostname.replace(/^www\./, "");

  if (targetHost !== sourceHost) {
    throw new Error("The requested page is outside this provider.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported provider URL.");
  }
  return url.toString();
}

function extractHtmlMetaContent(html = "", property = "") {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeBasicHtmlEntities(match[1]).trim();
  }
  return "";
}

function extractCoedCherryTags(html = "", pageUrl = "") {
  const tags = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']*\/(?:tags?|tag)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const title = stripProviderHtml(match[2]).trim();
    const url = resolveProviderAssetUrl(match[1], pageUrl);
    if (!title || !url || seen.has(title.toLowerCase())) continue;
    if (/schoolgirl|underage|minor|preteen|child/i.test(title)) continue;
    seen.add(title.toLowerCase());
    tags.push({ title, url });
  }
  return tags.slice(0, 40);
}

function extractCoedCherryGalleryCards(html = "", pageUrl = "", limit = 60) {
  const cards = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) && cards.length < limit) {
    const href = resolveProviderAssetUrl(match[2], pageUrl);
    if (!href || seen.has(href)) continue;
    if (!/coedcherry\.com/i.test(href)) continue;

    const body = match[4] || "";
    const imageMatch = body.match(/<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/i);
    if (!imageMatch?.[1]) continue;

    const imageUrl = resolveProviderAssetUrl(imageMatch[1], pageUrl);
    if (!imageUrl) continue;

    const altMatch = body.match(/<img\b[^>]*(?:alt|title)=["']([^"']+)["'][^>]*>/i);
    const captionMatch = body.match(/<(?:h[1-6]|span|div|strong|p)\b[^>]*>([^<]{2,180})<\/(?:h[1-6]|span|div|strong|p)>/i);
    const title = stripProviderHtml(altMatch?.[1] || captionMatch?.[1] || body).slice(0, 160);
    const path = new URL(href).pathname;
    const likelyGallery = /\/(?:gals?|gallery|pics?|models?|channels?)\//i.test(path);

    if (!likelyGallery) continue;
    seen.add(href);
    cards.push({
      id: crypto.createHash("sha1").update(href).digest("hex").slice(0, 14),
      type: "gallery",
      title: title || path.split("/").filter(Boolean).pop() || "Gallery",
      url: href,
      imageUrl,
    });
  }

  return cards;
}

function extractCoedCherryGalleryImages(html = "", pageUrl = "", limit = 160) {
  const images = [];
  const seen = new Set();
  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = imagePattern.exec(html)) && images.length < limit) {
    const imageUrl = resolveProviderAssetUrl(match[1], pageUrl);
    if (!imageUrl || seen.has(imageUrl)) continue;
    if (!/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(imageUrl)) continue;
    if (/logo|icon|avatar|sprite|flag|banner/i.test(imageUrl)) continue;

    let width = 0;
    let height = 0;
    const tagStart = html.lastIndexOf("<img", match.index);
    const tagEnd = html.indexOf(">", match.index);
    const tag = tagStart >= 0 && tagEnd >= 0 ? html.slice(tagStart, tagEnd + 1) : "";
    const widthMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const heightMatch = tag.match(/\bheight=["']?(\d+)/i);
    width = Number(widthMatch?.[1] || 0);
    height = Number(heightMatch?.[1] || 0);
    if ((width && width < 200) || (height && height < 200)) continue;

    seen.add(imageUrl);
    images.push({
      id: crypto.createHash("sha1").update(imageUrl).digest("hex").slice(0, 14),
      type: "image",
      title: `Photo ${images.length + 1}`,
      imageUrl,
      url: imageUrl,
      selected: false,
    });
  }

  return images;
}

async function fetchInternalAdultBrowsePage(source = {}, rawUrl = "") {
  if (!INTERNAL_ADULT_BROWSE_ADAPTERS.has(String(source.id || ""))) {
    throw new Error("This provider does not have an internal browsing adapter yet.");
  }

  const url = assertConfiguredInternalBrowseUrl(source, rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; HomesteadInternalBrowse/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    if (/cloudflare|captcha|checking your browser|access denied/i.test(html.slice(0, 100000))) {
      throw new Error("The provider returned an anti-bot challenge.");
    }

    const finalUrl = response.url || url;
    const pageTitle =
      extractHtmlMetaContent(html, "og:title") ||
      stripProviderHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
      source.name;

    const galleryImages = extractCoedCherryGalleryImages(html, finalUrl, 160);
    const galleryCards = extractCoedCherryGalleryCards(html, finalUrl, 80);
    const tags = extractCoedCherryTags(html, finalUrl);

    const isGalleryPage =
      galleryImages.length >= 4 &&
      (/\/(?:gals?|gallery|pics?)\//i.test(new URL(finalUrl).pathname) || galleryCards.length < 3);

    return {
      ok: true,
      adapter: source.id,
      sourceId: source.id,
      sourceName: source.name,
      title: pageTitle,
      url: finalUrl,
      mode: isGalleryPage ? "gallery" : "index",
      tags,
      items: isGalleryPage ? galleryImages : galleryCards,
      nextPageUrl: detectProviderPagination(html, finalUrl),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}



app.post("/api/discovery/adult/internal-browse", async (req, res) => {
  try {
    const setupConfig = readSetupConfig();
    const sourceId = String(req.body?.sourceId || "").trim();
    const url = String(req.body?.url || "").trim();
    const sources = getConfiguredAdultSources(setupConfig).filter(sourceSupportsAdultBrowse);
    const source = sources.find((entry) => String(entry.id) === sourceId);

    if (!source) {
      return res.status(404).json({ ok: false, message: "Browse provider was not found." });
    }

    const page = await fetchInternalAdultBrowsePage(source, url);
    res.json({ ok: true, page });
  } catch (error) {
    console.error("Internal Adult Browse failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Unable to browse this provider internally." });
  }
});

app.post("/api/discovery/adult/provider-probe", async (req, res) => {
  try {
    const setupConfig = readSetupConfig();
    const sourceId = String(req.body?.sourceId || "").trim();
    const force = Boolean(req.body?.force);
    const sources = getConfiguredAdultSources(setupConfig).filter(sourceSupportsAdultBrowse);
    const source = sources.find((entry) => String(entry.id) === sourceId);

    if (!source) {
      return res.status(404).json({
        ok: false,
        message: "Browse provider was not found or is not enabled for the Browse Sources lane.",
      });
    }

    const probe = await probeAdultBrowseProvider(source, { force });
    res.json({ ok: true, probe });
  } catch (error) {
    console.error("Adult provider capability probe failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Provider capability probe failed." });
  }
});

app.post("/api/discovery/adult/browse-media", async (req, res) => {
  try {
    const setupConfig = setupConfigWithHomesteadAdultBrowseSources(
      readSetupConfig()
    );
    const query = cleanMetadataQuery(req.body?.query || "");
    const filters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : {};
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];

    const hasRealFilters = Object.entries(filters).some(([key, value]) => key !== "profileType" && (Array.isArray(value) ? value.length > 0 : Boolean(value)));

    if (!query && !hasRealFilters) {
      return res.status(400).json({ ok: false, message: "Choose at least one browse filter or enter an optional search term." });
    }

    const discovery = discoverAdultBrowseMedia({
      setupConfig,
      query,
      filters,
      sourceIds,
    });

    res.json(discovery);
  } catch (error) {
    console.error("Adult browse media search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult browse media search failed" });
  }
});


function adultSourceHasPersonSearchValue(source = {}) {
  if (!source || source.enabled === false || source.status === "disabled") return false;

  const supports = Array.isArray(source.supports) ? source.supports.map((type) => String(type || "").toLowerCase()) : [];
  const modes = Array.isArray(source.searchModes) ? source.searchModes.map((mode) => String(mode || "").toLowerCase()) : [];
  const badges = Array.isArray(source.badges) ? source.badges.map((badge) => String(badge || "").toLowerCase()) : [];
  const category = String(source.category || "").toLowerCase();

  const hasIdentitySupport = supports.some((type) => [
    "performermetadata",
    "identifiers",
    "bio",
    "biography",
    "socials",
    "awards",
    "externallinks",
    "publicimage",
    "occupation",
    "credits",
    "timeline",
  ].includes(type));

  const hasPersonCategory = /metadata|bio|biography|profile|identity|agency|model|external id|credits|timeline|scene timeline/.test(category);
  const hasPersonBadge = badges.some((badge) => /metadata|bio|profile|id bridge|credits|timeline/.test(badge));
  const hasPersonMode = modes.some((mode) => ["performer", "celebrity", "metadata"].includes(mode));

  const isGeneralBrowseOnly = /general browse|photo galleries|media\/video only|anime|hentai|source directory/.test(category)
    && !source.supportsFixMatch
    && !source.supportsBulkMetadata
    && !hasIdentitySupport;

  if (isGeneralBrowseOnly) return false;

  return Boolean(
    source.supportsFixMatch ||
    source.supportsBulkMetadata ||
    source.providerIdKey ||
    hasIdentitySupport ||
    hasPersonCategory ||
    hasPersonBadge ||
    hasPersonMode
  );
}

function adultSourceMatchesAdvancedPersonProfile(source = {}, profileType = "performer") {
  if (!adultSourceHasPersonSearchValue(source)) return false;

  const wanted = normalizeAdultPersonProfileType(profileType || "performer");
  if (["both", "all"].includes(wanted)) return true;

  const modes = Array.isArray(source.searchModes) ? source.searchModes.map((mode) => String(mode || "").toLowerCase()) : [];
  const profileTypes = Array.isArray(source.profileTypes) ? source.profileTypes.map((mode) => normalizeAdultPersonProfileType(mode)) : [];
  const role = normalizeAdultPersonProfileType(source.role || "both");

  if (wanted === "performer") {
    return profileTypes.includes("performer") || role === "performer" || role === "both" || modes.includes("performer");
  }

  if (wanted === "celebrity") {
    return profileTypes.includes("celebrity") || role === "celebrity" || role === "both" || modes.includes("celebrity");
  }

  if (wanted === "personal") {
    return profileTypes.includes("personal") || role === "personal" || role === "both";
  }

  return true;
}

function classifyAdvancedAdultPersonProviderGroup(source = {}) {
  const category = String(source.category || "").toLowerCase();
  const supports = Array.isArray(source.supports) ? source.supports.map((type) => String(type || "").toLowerCase()) : [];

  if (source.requiresSession) return "Locked / session sources";

  // Provider search cards are launchers, not confirmed matches. Keep them out of
  // the top match bucket so users only see real candidates under Best metadata matches.
  if (source.supportsFixMatch || source.supportsBulkMetadata || /metadata|bio|biography|identity|external id|agency|model|profile|directory/.test(category)) {
    return "Profile / metadata provider searches";
  }

  if (source.supportsScenes || source.supportsImport || supports.some((type) => ["scenes", "videos", "timeline", "credits", "providerstats"].includes(type))) {
    return "Video / scene provider searches";
  }
  if (source.supportsArtwork || supports.some((type) => ["photos", "photosets", "images", "artwork"].includes(type))) {
    return "Artwork / photo provider searches";
  }
  return "General provider searches";
}

function getAdultPersonCandidateReliability(candidate = {}) {
  const confidence = Number(candidate.confidence || 0);
  const provider = getAdultPersonCandidateProviderKey(candidate);
  const hasStableId = Boolean(candidate.wikidataId || candidate.tmdbId || candidate.imdbId || candidate.providerIds || candidate.externalIds);
  const hasDirectProfileUrl = Boolean(candidate.url || candidate.externalUrl || candidate.sourceUrl) && !isSearchOnlyAdultPersonCandidate(candidate);
  const adultKnownDirect = ["nubiles", "pics-x", "picsx", "definebabe", "freeones", "babewiki"].includes(provider);

  if (hasStableId && confidence >= 0.82) {
    return { tier: "verified", label: "Verified identity", sortRank: 0, description: "Stable external ID and strong name match." };
  }

  if ((adultKnownDirect || hasDirectProfileUrl) && confidence >= 0.72) {
    return { tier: "probable", label: "Likely profile", sortRank: 1, description: "Direct profile/gallery mapping with a strong name match. Review before creating." };
  }

  if (confidence >= 0.62) {
    return { tier: "possible", label: "Possible profile", sortRank: 2, description: "Candidate has enough signal to review, but should not be treated as verified." };
  }

  return { tier: "weak", label: "Weak candidate", sortRank: 3, description: "Low-confidence candidate. Use as a lead only." };
}


function buildProvisionalAdultPersonCandidateFromProviderSearches({ query = "", profileType = "performer", providerSearchResults = [] } = {}) {
  const cleanName = cleanMetadataQuery(query);
  if (!cleanName) return null;

  const normalizedType = normalizeAdultPersonProfileType(profileType || "performer");
  const libraryType = adultPersonLibraryFromProfileType(normalizedType);
  const typeLabel = normalizedType === "celebrity" ? "Celebrity" : normalizedType === "personal" ? "Personal" : "Performer";

  const preferredProviderOrder = [
    "wikidata",
    "wikipedia",
    "definebabe",
    "freeones",
    "babewiki",
    "xxxbios",
    "iafd",
    "eporner",
    "pics-x",
    "xhamster",
    "tmdb",
    "imdb",
  ];

  const sourceRank = (result = {}) => {
    const provider = String(result.provider || result.source || "").toLowerCase();
    const preferredIndex = preferredProviderOrder.findIndex((key) => provider.includes(key));
    const preferred = preferredIndex >= 0 ? preferredIndex : 99;
    const group = String(result.resultGroup || "").toLowerCase();
    const groupBonus = group.includes("profile") || group.includes("metadata") ? 0 : group.includes("photo") || group.includes("scene") ? 20 : 40;
    const lockPenalty = result.requiresSession ? 50 : 0;
    return preferred + groupBonus + lockPenalty + Number(result.priority || 50) / 100;
  };

  const usefulProviderLinks = (Array.isArray(providerSearchResults) ? providerSearchResults : [])
    .filter((result) => result && result.url && !result.requiresSession)
    .filter((result) => {
      const group = String(result.resultGroup || "").toLowerCase();
      return group.includes("profile") || group.includes("metadata") || result.supportsFixMatch || result.supportsBulkMetadata;
    })
    .sort((a, b) => sourceRank(a) - sourceRank(b))
    .slice(0, 6);

  if (!usefulProviderLinks.length) return null;

  const primary = usefulProviderLinks[0];
  const linkSummary = usefulProviderLinks.map((result) => ({
    label: result.source || result.provider || "Provider search",
    url: result.url,
    provider: result.provider || "",
    category: result.category || "",
  }));

  return {
    id: `provisional-${libraryType}-${slugifyAdultProfileName(cleanName)}`,
    provider: "provider-search-bundle",
    source: `${typeLabel} provider searches`,
    title: cleanName,
    name: cleanName,
    subtitle: `${typeLabel} Ã¢â‚¬Â¢ Search-only provider bundle Ã¢â‚¬Â¢ review needed`,
    profileType: normalizedType,
    libraryType,
    resultGroup: "Best metadata matches",
    type: "personCandidate",
    isPersonCandidate: true,
    canCreateProfile: true,
    canMatchProfile: true,
    canAttachToProfile: true,
    icon: normalizedType === "celebrity" ? "Ã°Å¸Å’Å¸" : normalizedType === "personal" ? "Ã°Å¸â€˜Â¤" : "Ã°Å¸â€Å½",
    url: primary.url,
    externalUrl: primary.url,
    sourceUrl: primary.url,
    confidence: 0.58,
    matchScore: 58,
    searchOnly: true,
    isProviderSearchBundle: true,
    providerSearchLinks: linkSummary,
    referenceLinks: linkSummary,
    metadata: {
      sourceSearchLinks: linkSummary,
      metadataSource: "provider-search-bundle",
      metadataNote: "No direct profile candidate was parsed yet. Review provider links before creating this profile.",
    },
    reliabilityTier: "weak",
    reliabilityLabel: "Search-only candidate",
    reliabilityDescription: "No direct profile was parsed yet. This is a create/match helper built from person-specific provider searches.",
    reliabilitySortRank: 4,
    reviewRequired: true,
    actionLabel: "Review/Create",
    badges: ["Search bundle", "Review needed"],
    adaptationNote: "No verified profile candidate was parsed yet. Use this to review provider searches and create a draft profile if it is the right person.",
  };
}

app.post("/api/discovery/adult/advanced-search", async (req, res) => {
  try {
    const setupConfig = readSetupConfig();
    const query = cleanMetadataQuery(req.body?.query || "");
    const filters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : {};
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];
    const selectedProfileType = normalizeAdultPersonProfileType(filters?.profileType || "performer");
    const sources = getConfiguredAdultSources(setupConfig)
      .filter((source) => source.enabled !== false)
      .filter((source) => adultSourceMatchesAdvancedPersonProfile(source, selectedProfileType))
      .filter((source) => !sourceIds.length || sourceIds.includes(source.id))
      .sort((a, b) => (a.priority || 50) - (b.priority || 50));

    const hasRealFilters = Object.entries(filters).some(([key, value]) => key !== "profileType" && (Array.isArray(value) ? value.length > 0 : Boolean(value)));

    if (!query && !hasRealFilters) {
      return res.status(400).json({ ok: false, message: "Enter a search term or choose at least one filter." });
    }

    let wikidataCandidate = null;
    let providerIds = {};
    let providerLinks = {};

    if (query) {
      try {
        const metadataLibraryType = filters?.profileType === "celebrity" ? "celebrities" : "performers";
        const metadataCandidates = await searchAdultMetadata(query, {
          libraryType: metadataLibraryType,
          whisparr: {},
          customSourceUrls: getCustomMetadataSourceUrls(readSetupConfig(), metadataLibraryType),
        });
        wikidataCandidate = metadataCandidates.find((candidate) => candidate.provider === "wikidata") || metadataCandidates[0] || null;
        providerIds = wikidataCandidate?.providerIds || wikidataCandidate?.externalIds || {};
        providerLinks = wikidataCandidate?.providerLinks || wikidataCandidate?.externalLinks || {};
      } catch (metadataError) {
        console.warn("Adult advanced search Wikidata ID bridge failed:", metadataError.message);
      }
    }

    let personCandidates = [];

    if (query) {
      try {
        personCandidates = await searchAdultPersonCandidates(query, {
          setupConfig,
          profileType: filters?.profileType || "both",
          limit: 10,
        });
      } catch (personCandidateError) {
        console.warn("Adult advanced search person candidates failed:", personCandidateError.message);
      }
    }

    const providerSearchResults = sources.map((source) => {
      const url = buildSourceSearchUrl(source, query, filters, { providerIds, providerLinks });
      const providerIdUsed = source.providerIdKey ? providerIds[source.providerIdKey] : "";
      return {
        id: `${source.id}-${Date.now()}`,
        provider: source.id,
        source: source.name,
        icon: source.icon || "Ã°Å¸Å’Â",
        iconUrl: source.iconUrl || source.faviconUrl || "",
        baseUrl: source.baseUrl || "",
        supports: source.supports || [],
        supportedFilters: source.supportedFilters || [],
        role: source.role || "both",
        category: source.category || "source",
        badges: Array.isArray(source.badges) ? source.badges : [],
        searchModes: Array.isArray(source.searchModes) ? source.searchModes : [],
        profileTypes: Array.isArray(source.profileTypes) ? source.profileTypes : [],
        priority: source.priority || 50,
        status: source.status || "active",
        supportsFixMatch: Boolean(source.supportsFixMatch),
        supportsBulkMetadata: Boolean(source.supportsBulkMetadata),
        supportsArtwork: Boolean(source.supportsArtwork),
        supportsScenes: Boolean(source.supportsScenes),
        supportsImport: Boolean(source.supportsImport),
        fieldPriority: source.fieldPriority || {},
        notes: source.notes || "",
        resultGroup: classifyAdvancedAdultPersonProviderGroup(source),
        directProfileOnly: Boolean(source.directProfileOnly),
        requiresSession: Boolean(source.requiresSession),
        url,
        providerIdKey: source.providerIdKey || "",
        providerIdUsed,
        usedProviderId: Boolean(providerIdUsed),
        wikidataMatchedName: wikidataCandidate?.name || wikidataCandidate?.title || "",
        adaptationNote: providerIdUsed
          ? `Used Wikidata ${source.providerIdKey} ID: ${providerIdUsed}`
          : source.filterStrategy === "queryAppend"
            ? "Person/profile filters were adapted into this provider search."
            : source.filterStrategy === "directParams"
              ? "Supported profile filters were translated into URL parameters where configured."
              : "Person/profile provider search built from query and supported filters.",
        filters,
      };
    });

    const candidateResultKeys = new Set();
    const personCandidateResults = personCandidates
      .filter((candidate) => candidate && (candidate.name || candidate.title))
      .filter((candidate) => shouldKeepAdultPersonCandidate(candidate, { query, profileType: filters?.profileType || "both" }))
      .filter((candidate) => {
        const key = `${candidate.profileType || candidate.libraryType || "person"}:${candidate.provider || candidate.source || "source"}:${candidate.id || candidate.url || candidate.name || candidate.title}`.toLowerCase();
        if (candidateResultKeys.has(key)) return false;
        candidateResultKeys.add(key);
        return true;
      })
      .map((candidate, index) => {
        const reliability = getAdultPersonCandidateReliability(candidate);
        return {
          ...candidate,
          id: candidate.id || `person-candidate-${index}-${slugifyAdultProfileName(candidate.name || candidate.title || query)}`,
          provider: candidate.provider || candidate.source || "external",
          source: candidate.source || candidate.provider || "External person source",
          title: candidate.title || candidate.name || query,
          name: candidate.name || candidate.title || query,
          subtitle: candidate.subtitle || `${candidate.profileType === "celebrity" ? "Celebrity" : candidate.profileType === "personal" ? "Personal" : "Performer"} Ã¢â‚¬Â¢ ${candidate.source || candidate.provider || "External source"}`,
          resultGroup: "Best metadata matches",
          type: "personCandidate",
          isPersonCandidate: true,
          canCreateProfile: true,
          canMatchProfile: true,
          icon: candidate.icon || (candidate.profileType === "celebrity" ? "Ã°Å¸Å’Å¸" : "Ã°Å¸â€Å½"),
          url: candidate.url || candidate.externalUrl || candidate.sourceUrl || "",
          reliabilityTier: reliability.tier,
          reliabilityLabel: reliability.label,
          reliabilityDescription: reliability.description,
          reliabilitySortRank: reliability.sortRank,
          reviewRequired: reliability.tier !== "verified",
          actionLabel: reliability.tier === "verified" ? "Match/Create" : "Review/Create",
        };
      })
      .sort((a, b) => (a.reliabilitySortRank ?? 9) - (b.reliabilitySortRank ?? 9) || Number(b.confidence || 0) - Number(a.confidence || 0));

    const provisionalCandidate = !personCandidateResults.length && query
      ? buildProvisionalAdultPersonCandidateFromProviderSearches({
          query,
          profileType: filters?.profileType || selectedProfileType || "performer",
          providerSearchResults,
        })
      : null;

    const finalPersonCandidateResults = provisionalCandidate
      ? [provisionalCandidate, ...personCandidateResults]
      : personCandidateResults;

    const results = [...finalPersonCandidateResults, ...providerSearchResults];

    res.json({
      ok: true,
      query,
      filters,
      wikidataMatch: wikidataCandidate,
      providerIds,
      providerLinks,
      personCandidates: finalPersonCandidateResults,
      results,
      sources,
      message: providerIds && Object.keys(providerIds).length
        ? `${finalPersonCandidateResults.length} person candidate${finalPersonCandidateResults.length === 1 ? "" : "s"} and ${providerSearchResults.length} provider links built. Wikidata IDs found for ${Object.keys(providerIds).length} providers.`
        : `${finalPersonCandidateResults.length} person candidate${finalPersonCandidateResults.length === 1 ? "" : "s"} and ${providerSearchResults.length} provider search links built.`,
    });
  } catch (error) {
    console.error("Adult advanced search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult advanced search failed" });
  }
});

app.post("/api/discovery/adult/request-selected", async (req, res) => {
  try {
    const { query = "", selected = [], mode = "requestSelected" } = req.body || {};

    if (!Array.isArray(selected) || selected.length === 0) {
      return res.status(400).json({ ok: false, message: "Select at least one scene/photo/source item first." });
    }

    const result = await requestSelectedAdultContent({
      query,
      selected,
      mode,
      whisparr: getWhisparrConfig(),
    });

    const saved = readJsonFile(adultRequestsPath, []);
    const requestRecord = {
      id: `adult-discovery-${Date.now()}`,
      query,
      mode,
      selected: result.selected,
      whisparrAttempts: result.whisparrAttempts,
      createdAt: new Date().toISOString(),
      status: result.whisparrAttempts?.some((attempt) => attempt.ok) ? "sent-to-whisparr" : "pending",
    };

    writeJsonFile(adultRequestsPath, [requestRecord, ...saved]);

    res.json({
      ...result,
      request: requestRecord,
      message: result.message,
    });
  } catch (error) {
    console.error("Adult discovery request failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Adult discovery request failed" });
  }
});

app.get("/api/metadata/matches", (req, res) => {
  try {
    const matches = readMetadataMatches();

    res.json({
      ok: true,
      matches,
      stats: getMetadataMatchStats(matches),
      file: METADATA_MATCHES_FILE,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.delete("/api/metadata/match", (req, res) => {
  try {
    const libraryType = String(req.query.libraryType || req.body?.libraryType || "").trim();
    const localId = String(req.query.localId || req.body?.localId || "").trim();
    if (!libraryType || !localId) {
      return res.status(400).json({ ok: false, message: "Missing libraryType or localId" });
    }

    const matches = readMetadataMatches();
    const key = `${libraryType}:${localId}`;
    const target = matches[key];
    const canonicalKey = target?.aliasOf || key;

    for (const matchKey of Object.keys(matches)) {
      if (matchKey === canonicalKey || matches[matchKey]?.aliasOf === canonicalKey) {
        delete matches[matchKey];
      }
    }

    writeMetadataMatches(matches);
    res.json({ ok: true, removed: canonicalKey, stats: getMetadataMatchStats(matches), file: METADATA_MATCHES_FILE });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/api/metadata/search", async (req, res) => {
  try {
    const libraryType = String(req.query.libraryType || "").trim();
    const rawQuery = String(req.query.query || "").trim();
    const query = cleanMetadataQuery(rawQuery);

    if (!libraryType) {
      return res.status(400).json({
        ok: false,
        message: "Missing libraryType",
      });
    }

    if (!query) {
      return res.status(400).json({
        ok: false,
        message: "Missing search query",
      });
    }

    if (libraryType === "movies" || libraryType === "tv") {
      const { baseUrl, apiKey } = getSeerrConfig();

      if (!baseUrl || !apiKey) {
        return res.status(400).json({
          ok: false,
          message: "Missing Seerr URL or API key",
        });
      }

      const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
      const encodedQuery = strictEncodeQuery(query);
      const seerrSearchUrl = `${normalizedBaseUrl}/api/v1/search?query=${encodedQuery}`;

      const response = await fetch(seerrSearchUrl, {
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
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
        return res.status(response.status).json({
          ok: false,
          message:
            data?.message ||
            data?.error ||
            `Seerr returned ${response.status}`,
          status: response.status,
          data,
        });
      }

      const rawResults =
        data?.results ||
        data?.items ||
        data?.media ||
        data?.data?.results ||
        data?.data ||
        [];

      const results = Array.isArray(rawResults)
        ? rawResults.filter((item) => {
            const mediaType = String(item.mediaType || "").toLowerCase();

            if (libraryType === "tv") {
              return mediaType === "tv";
            }

            return mediaType === "movie";
          })
        : [];

      return res.json({
        ok: true,
        libraryType,
        provider: "seerr",
        query,
        results,
        data,
      });
    }

    if (libraryType === "books") {
      const provider = String(req.query.provider || "openlibrary").trim();
      const results = await searchBookMetadata(query, {
        provider,
        limit: Number(req.query.limit || 12),
      });

      return res.json({
        ok: true,
        libraryType,
        provider,
        query,
        results,
      });
    }

    if (libraryType === "music") {
      const provider = String(req.query.provider || "musicbrainz").trim();
      const type = String(req.query.type || "artist").trim();
      const results = await searchMusicMetadata(query, {
        provider,
        type,
        limit: Number(req.query.limit || 12),
      });

      return res.json({
        ok: true,
        libraryType,
        provider,
        type,
        query,
        results,
      });
    }

    if (libraryType === "youtube") {
      const provider = String(req.query.provider || "auto").trim();
      const setupConfig = readSetupConfig();
      const tubeArchivistSettings =
        setupConfig?.integrationSettings?.tubearchivist ||
        setupConfig?.integrations?.tubearchivist ||
        {};
      const youtubeSettings =
        setupConfig?.integrationSettings?.youtube ||
        setupConfig?.integrations?.youtube ||
        {};

      const results = await searchYouTubeMetadata(query, {
        provider,
        limit: Number(req.query.limit || 12),
        apiKey:
          req.query.apiKey ||
          youtubeSettings.youtubeApiKey ||
          tubeArchivistSettings.youtubeApiKey ||
          tubeArchivistSettings.apiKey ||
          "",
        tubeArchivistUrl:
          req.query.tubeArchivistUrl ||
          tubeArchivistSettings.url ||
          tubeArchivistSettings.baseUrl ||
          tubeArchivistSettings.host ||
          "",
        tubeArchivistApiKey:
          req.query.tubeArchivistApiKey ||
          tubeArchivistSettings.apiKey ||
          tubeArchivistSettings.token ||
          "",
      });

      return res.json({
        ok: true,
        libraryType,
        provider,
        query,
        results,
      });
    }

    return res.status(400).json({
      ok: false,
      message: `Unsupported metadata libraryType: ${libraryType}`,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.post("/api/metadata/match", (req, res) => {
  try {
    const { libraryType, localId, metadata, localItem = null } = req.body || {};

    if (!libraryType) {
      return res.status(400).json({
        ok: false,
        message: "Missing libraryType",
      });
    }

    if (!localId) {
      return res.status(400).json({
        ok: false,
        message: "Missing localId",
      });
    }

    if (!metadata) {
      return res.status(400).json({
        ok: false,
        message: "Missing metadata",
      });
    }

    const matches = readMetadataMatches();
    const key = `${libraryType}:${localId}`;

    const existingMatch = matches[key] || {};

    const aliases = buildMetadataMatchAliases({ localId, localItem, metadata });

    const savedMatch = {
      ...existingMatch,
      ...metadata,
      libraryType,
      localId,
      localItem,
      aliases,
      matchedAt: existingMatch.matchedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    matches[key] = savedMatch;

    for (const alias of aliases) {
      matches[`${libraryType}:${alias}`] = {
        ...savedMatch,
        aliasOf: key,
      };
    }

    writeMetadataMatches(matches);

    res.json({
      ok: true,
      key,
      aliases,
      match: savedMatch,
      stats: getMetadataMatchStats(matches),
      file: METADATA_MATCHES_FILE,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/search", async (req, res) => {
  try {
    const rawQuery = String(req.query.query || "").trim();
    const query = cleanMetadataQuery(rawQuery);

    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    if (!query) {
      return res.status(400).json({
        ok: false,
        message: "Missing search query",
      });
    }

    const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, "");
    const encodedQuery = strictEncodeQuery(query);
    const seerrSearchUrl = `${normalizedBaseUrl}/api/v1/search?query=${encodedQuery}`;

    const response = await fetch(seerrSearchUrl, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
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
      return res.status(response.status).json({
        ok: false,
        message:
          data?.message ||
          data?.error ||
          `Seerr returned ${response.status}`,
        status: response.status,
        debug: {
          incomingUrl: req.url,
          rawQuery,
          query,
          encodedQuery,
          seerrSearchUrl,
        },
        data,
      });
    }

    const results =
      data?.results ||
      data?.items ||
      data?.media ||
      data?.data?.results ||
      data?.data ||
      [];

    res.json({
      ok: true,
      rawQuery,
      query,
      encodedQuery,
      seerrSearchUrl,
      results: Array.isArray(results) ? results : [],
      data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/integrations/seerr/media/:mediaType/:tmdbId/details", async (req, res) => {
  try {
    const { mediaType, tmdbId } = req.params;
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const normalizedType = mediaType === "tv" ? "tv" : "movie";

    const response = await fetch(
      `${baseUrl}/api/v1/${normalizedType}/${tmdbId}`,
      {
        headers: {
          "X-Api-Key": apiKey,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

res.json({
  ok: true,
  item: data,
  cast: data.credits?.cast || data.cast || [],
  crew: data.credits?.crew || data.crew || [],
  collection: data.collection || data.belongsToCollection || null,
  genres: data.genres || [],

  mediaInfo: data.mediaInfo || null,
  requests: data.mediaInfo?.requests || data.requests || [],
  downloadStatus:
    data.mediaInfo?.downloadStatus ||
    data.mediaInfo?.downloadStatus4k ||
    [],
});
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/metadata/movie/:tmdbId", async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/movie/${tmdbId}`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      metadata: {
        tmdbId: data.id,
        title: data.title,
        year: data.releaseDate?.slice(0, 4) || "",
        releaseDate: data.releaseDate || "",
        overview: data.overview || "",
        tagline: data.tagline || "",
        runtime: data.runtime || null,
        rating: data.voteAverage || null,
        genres: data.genres?.map((genre) => genre.name) || [],
        posterPath: data.posterPath || "",
        backdropPath: data.backdropPath || "",
        source: "jellyseerr",
        fetchedAt: new Date().toISOString(),
      },
      raw: data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/api/metadata/tv/:tmdbId", async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const { baseUrl, apiKey } = getSeerrConfig();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        ok: false,
        message: "Missing Seerr URL or API key",
      });
    }

    const response = await fetch(`${baseUrl}/api/v1/tv/${tmdbId}`, {
      headers: {
        "X-Api-Key": apiKey,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: data.message || `Seerr returned ${response.status}`,
        data,
      });
    }

    res.json({
      ok: true,
      metadata: {
        tmdbId: data.id,
        title: data.name,
        year: data.firstAirDate?.slice(0, 4) || "",
        firstAirDate: data.firstAirDate || "",
        overview: data.overview || "",
        rating: data.voteAverage || null,
        genres: data.genres?.map((genre) => genre.name) || [],
        posterPath: data.posterPath || "",
        backdropPath: data.backdropPath || "",
        source: "jellyseerr",
        fetchedAt: new Date().toISOString(),
      },
      raw: data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

app.get("/", sendHomesteadBrandedIndex);
// Step 37C: read the canonical metadata.json for a profile.
app.get("/api/profiles/metadata", (req, res) => {
  try {
    const profileId = String(req.query.profileId || "").trim();
    const profileName = String(req.query.profileName || "").trim();
    const libraryType = String(req.query.libraryType || "personal").trim();
    const requestedProfileDir = String(
      req.query.profileDir || ""
    ).trim();
    const requestedMetadataPath = String(
      req.query.metadataPath || ""
    ).trim();

    const profileDir = findAdultProfileDir({
      libraryType,
      profileId,
      profileName,
      profileDir: requestedProfileDir,
      filePath: requestedMetadataPath,
    });

    let resolvedProfileDir = profileDir;

    if (!resolvedProfileDir) {
      const requestedSlug = slugifyAdultProfileName(
        profileName || profileId
      );
      const librariesToSearch = [
        libraryType,
        "performers",
        "personal",
        "girls",
        "celebrities",
      ].filter(
        (value, index, array) =>
          value && array.indexOf(value) === index
      );

      for (const candidateLibrary of librariesToSearch) {
        const match = listAdultProfileDirs(candidateLibrary).find(
          (row) =>
            row.folderName === profileId ||
            slugifyAdultProfileName(row.folderName) ===
              slugifyAdultProfileName(profileId) ||
            slugifyAdultProfileName(row.name) === requestedSlug
        );

        if (match?.profileDir) {
          resolvedProfileDir = match.profileDir;
          break;
        }
      }
    }

    if (!resolvedProfileDir) {
      return res.status(404).json({
        ok: false,
        message: "Profile folder was not found.",
        profileId,
        profileName,
        libraryType,
      });
    }

    const metadataPath = path.join(
      resolvedProfileDir,
      "metadata.json"
    );

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({
        ok: false,
        message: "metadata.json was not found.",
        profileDir: resolvedProfileDir,
        metadataPath,
      });
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8") || "{}");

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      profileDir: resolvedProfileDir,
      metadataPath,
      profile: {
        ...metadata,
        profileDir:
          metadata.profileDir || resolvedProfileDir,
        folderPath:
          metadata.folderPath || resolvedProfileDir,
        sourcePath:
          metadata.sourcePath || resolvedProfileDir,
        metadataPath,
        poster: chooseProfilePoster(
          resolvedProfileDir,
          metadata.poster,
          metadata.posterPath,
          metadata.image,
          metadata.thumbnail
        ),
      },
    });
  } catch (error) {
    console.error("Profile metadata read failed:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || String(error),
    });
  }
});


app.use(express.static(path.join(__dirname, "dist"), { index: false }));

app.get("/api/music/discover", async (req, res) => {
  const query = String(req.query.q || "").trim();
const limit = Math.min(
  Math.max(parseInt(req.query.limit || "10", 10) || 10, 1),
  50
);

  if (!query) {
    return res.json({
      artists: [],
      albums: [],
      songs: [],
    });
  }

  try {
    const headers = {
      "User-Agent": "Homestead/1.0 (self-hosted media server)",
      Accept: "application/json",
    };

    const [artistResponse, albumResponse, songResponse] = await Promise.all([
      fetch(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(
          query
        )}&fmt=json&limit=${limit}`,
        { headers }
      ),
      fetch(
        `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(
          query
        )}&type=album&fmt=json&limit=${limit}`,
        { headers }
      ),
      fetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(
          query
        )}&fmt=json&limit=${limit}`,
        { headers }
      ),
    ]);

    const artistData = await artistResponse.json();
    const albumData = await albumResponse.json();
    const songData = await songResponse.json();

    const artists = (artistData.artists || []).map((artist) => ({
      id: artist.id,
      name: artist.name,
      type: artist.type || "",
      country: artist.country || "",
      disambiguation: artist.disambiguation || "",
      score: artist.score || 0,
    }));

    const albums = (albumData["release-groups"] || []).map((album) => ({
      id: album.id,
      title: album.title,
      artist:
        album["artist-credit"]?.map((credit) => credit.name).join(", ") || "",
      artistId: album["artist-credit"]?.[0]?.artist?.id || "",
      firstReleaseDate: album["first-release-date"] || "",
      primaryType: album["primary-type"] || "",
      disambiguation: album.disambiguation || "",
      score: album.score || 0,
    }));

    const songs = (songData.recordings || []).map((song) => ({
      id: song.id,
      title: song.title,
      artist:
        song["artist-credit"]?.map((credit) => credit.name).join(", ") || "",
      artistId: song["artist-credit"]?.[0]?.artist?.id || "",
      length: song.length || null,
      disambiguation: song.disambiguation || "",
      score: song.score || 0,
    }));

    res.json({
      artists,
      albums,
      songs,
    });
  } catch (error) {
    console.error("Music discovery failed:", error);

    res.status(500).json({
      error: "Music discovery failed",
      artists: [],
      albums: [],
      songs: [],
    });
  }
});

app.get("/api/music/artist/:id/albums", async (req, res) => {
  const artistId = String(req.params.id || "").trim();

  if (!artistId) {
    return res.json({ albums: [] });
  }

  try {
    const headers = {
      "User-Agent": "Homestead/1.0 (self-hosted media server)",
      Accept: "application/json",
    };

    const response = await fetch(
      `https://musicbrainz.org/ws/2/release-group?artist=${encodeURIComponent(
        artistId
      )}&type=album&fmt=json&limit=100`,
      { headers }
    );

    const data = await response.json();

    const albums = (data["release-groups"] || []).map((album) => ({
      id: album.id,
      title: album.title,
      firstReleaseDate: album["first-release-date"] || "",
      primaryType: album["primary-type"] || "",
      secondaryTypes: album["secondary-types"] || [],
      disambiguation: album.disambiguation || "",
    }));

    res.json({ albums });
  } catch (error) {
    console.error("Artist albums failed:", error);
    res.status(500).json({ error: "Artist albums failed", albums: [] });
  }
});

app.get("/api/music/artist/:id/songs", async (req, res) => {
  const artistId = String(req.params.id || "").trim();

  if (!artistId) {
    return res.json({ songs: [] });
  }

  try {
    const headers = {
      "User-Agent": "Homestead/1.0 (self-hosted media server)",
      Accept: "application/json",
    };

    const response = await fetch(
      `https://musicbrainz.org/ws/2/recording?artist=${encodeURIComponent(
        artistId
      )}&fmt=json&limit=100`,
      { headers }
    );

    const data = await response.json();

const seenTitles = new Set();

const songs = (data.recordings || [])
  .filter((song) => {
    const title = String(song.title || "").trim();
    if (!title) return false;

    const normalized = title.toLowerCase();

    if (seenTitles.has(normalized)) return false;
    seenTitles.add(normalized);

    return true;
  })
  .map((song) => ({
    id: song.id,
    title: song.title,
    length: song.length || null,
    disambiguation: song.disambiguation || "",
    artist:
      song["artist-credit"]?.map((credit) => credit.name).join(", ") || "",
    artistId: song["artist-credit"]?.[0]?.artist?.id || artistId,
  }))
  .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));

    res.json({ songs });
  } catch (error) {
    console.error("Artist songs failed:", error);
    res.status(500).json({ error: "Artist songs failed", songs: [] });
  }
});

app.get("/api/music/album/:id/tracks", async (req, res) => {
  const albumId = String(req.params.id || "").trim();

  if (!albumId) {
    return res.json({ tracks: [] });
  }

  try {
    const headers = {
      "User-Agent": "Homestead/1.0 (self-hosted media server)",
      Accept: "application/json",
    };

    const releasesResponse = await fetch(
      `https://musicbrainz.org/ws/2/release?release-group=${encodeURIComponent(
        albumId
      )}&inc=media+recordings&fmt=json&limit=10`,
      { headers }
    );

    const releasesData = await releasesResponse.json();
    const releases = releasesData.releases || [];

    const releaseWithTracks =
      releases.find((release) =>
        release.media?.some((medium) => medium.tracks?.length)
      ) || releases[0];

    const tracks =
      releaseWithTracks?.media?.flatMap((medium) =>
        (medium.tracks || []).map((track) => ({
          id: track.id,
          title: track.title,
          position: track.position,
          number: track.number,
          length: track.length || null,
          recordingId: track.recording?.id || "",
        }))
      ) || [];

    res.json({
      release: releaseWithTracks
        ? {
            id: releaseWithTracks.id,
            title: releaseWithTracks.title,
            date: releaseWithTracks.date || "",
            country: releaseWithTracks.country || "",
            status: releaseWithTracks.status || "",
          }
        : null,
      tracks,
    });
  } catch (error) {
    console.error("Album tracks failed:", error);
    res.status(500).json({ error: "Album tracks failed", tracks: [] });
  }
});

app.get("/api/integrations/lidarr/status", async (req, res) => {
  try {
    const config = getLidarrConfig();

    const baseUrl = String(config.url || "").replace(/\/$/, "");
    const apiKey = String(config.apiKey || "");

    if (!baseUrl || !apiKey) {
      return res.json({
        connected: false,
        error: "Missing Lidarr URL or API key",
      });
    }

console.log("Testing Lidarr URL:", `${baseUrl}/api/v1/system/status`);

    const response = await fetch(`${baseUrl}/api/v1/system/status`, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        connected: false,
        error: data.message || "Lidarr status request failed",
      });
    }

    res.json({
      connected: true,
      appName: data.appName || "Lidarr",
      version: data.version || "",
      branch: data.branch || "",
    });
  } catch (error) {
    console.error("Lidarr status failed:", error);

    res.status(500).json({
      connected: false,
      error: error.message || "Lidarr status failed",
    });
  }
});

async function lidarrFetch(path, options = {}) {
  const config = getLidarrConfig();

  const baseUrl = String(config.url || "").replace(/\/$/, "");
  const apiKey = String(config.apiKey || "");

  if (!baseUrl || !apiKey) {
    throw new Error("Missing Lidarr URL or API key");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

if (!response.ok) {
  console.error("Lidarr API error:", {
    path,
    status: response.status,
    data,
  });

  throw new Error(
    data?.message ||
      data?.error ||
      data?.title ||
      JSON.stringify(data) ||
      "Lidarr request failed"
  );
}

  return data;
}

app.post("/api/integrations/lidarr/request-artist", async (req, res) => {
  try {
    const artist = req.body?.artist;

    if (!artist?.name) {
      return res.status(400).json({
        ok: false,
        message: "Missing artist",
      });
    }

    const [lookupResults, rootFolders, qualityProfiles, metadataProfiles] =
      await Promise.all([
        lidarrFetch(`/api/v1/artist/lookup?term=${encodeURIComponent(artist.name)}`),
        lidarrFetch("/api/v1/rootfolder"),
        lidarrFetch("/api/v1/qualityprofile"),
        lidarrFetch("/api/v1/metadataprofile"),
      ]);
console.log("LIDARR LOOKUP RESULTS:", lookupResults?.length);
console.log("LIDARR ROOT FOLDERS:", rootFolders);
console.log("LIDARR QUALITY PROFILES:", qualityProfiles);
console.log("LIDARR METADATA PROFILES:", metadataProfiles);

    const lidarrArtist =
      lookupResults.find((item) => item.foreignArtistId === artist.id) ||
      lookupResults[0];

    if (!lidarrArtist) {
      return res.status(404).json({
        ok: false,
        message: "Artist not found in Lidarr lookup",
      });
    }

    const rootFolder = rootFolders[0];
    const qualityProfile = qualityProfiles[0];
    const metadataProfile = metadataProfiles[0];

    if (!rootFolder || !qualityProfile || !metadataProfile) {
      return res.status(400).json({
        ok: false,
        message: "Missing Lidarr root folder, quality profile, or metadata profile",
      });
    }

    const addedArtist = await lidarrFetch("/api/v1/artist", {
      method: "POST",
      body: JSON.stringify({
        ...lidarrArtist,
        monitored: true,
        rootFolderPath: rootFolder.path,
        qualityProfileId: qualityProfile.id,
        metadataProfileId: metadataProfile.id,
        addOptions: {
          monitor: "all",
          searchForMissingAlbums: true,
        },
      }),
    });

    res.json({
      ok: true,
      artist: addedArtist,
    });
  } catch (error) {
    console.error("Lidarr request artist failed:", error);

const message = error.message || "";

if (
  message.includes("ArtistExistsValidator") ||
  message.includes("already been added")
) {
  return res.json({
    ok: true,
    alreadyExists: true,
    message: "Artist is already in Lidarr",
  });
}

res.status(500).json({
  ok: false,
  message: error.message || "Lidarr request artist failed",
});
  }
});

app.post("/api/integrations/lidarr/request-album", async (req, res) => {
  try {
    const artist = req.body?.artist;
    const album = req.body?.album;

    if (!artist?.name || !album?.id) {
      return res.status(400).json({
        ok: false,
        message: "Missing artist or album",
      });
    }

    const lidarrArtists = await lidarrFetch("/api/v1/artist");

    const lidarrArtist = lidarrArtists.find(
      (item) => item.foreignArtistId === artist.id
    );

    if (!lidarrArtist) {
      return res.status(400).json({
        ok: false,
        message: "Artist must be added to Lidarr before requesting albums",
      });
    }

    const albums = await lidarrFetch(
      `/api/v1/album?artistId=${lidarrArtist.id}`
    );

    const lidarrAlbum = albums.find(
      (item) => item.foreignAlbumId === album.id
    );

    if (!lidarrAlbum) {
      return res.status(404).json({
        ok: false,
        message: "Album was not found in Lidarr for this artist",
      });
    }

    await lidarrFetch(`/api/v1/album/${lidarrAlbum.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...lidarrAlbum,
        monitored: true,
      }),
    });

    await lidarrFetch("/api/v1/command", {
      method: "POST",
      body: JSON.stringify({
        name: "AlbumSearch",
        albumIds: [lidarrAlbum.id],
      }),
    });

    res.json({
      ok: true,
      album: lidarrAlbum,
    });
  } catch (error) {
    console.error("Lidarr request album failed:", error);

    res.status(500).json({
      ok: false,
      message: error.message || "Lidarr request album failed",
    });
  }
});

function normalizeLidarrCompare(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function upsertMusicRequestRecord(record = {}) {
  const requests = readRequests();
  const music = Array.isArray(requests.music) ? requests.music : [];
  const key = record.key || record.id || `${record.artist || "unknown"}::${record.title || "unknown"}`;
  const nextRecord = {
    ...record,
    key,
    requestedAt: record.requestedAt || new Date().toISOString(),
  };

  const existingIndex = music.findIndex((item) => item.key === key);

  if (existingIndex >= 0) {
    music[existingIndex] = {
      ...music[existingIndex],
      ...nextRecord,
    };
  } else {
    music.push(nextRecord);
  }

  const nextRequests = {
    ...requests,
    music,
  };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(requestsPath, JSON.stringify(nextRequests, null, 2));

  return nextRecord;
}

async function getLidarrDefaults() {
  const [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
    lidarrFetch("/api/v1/rootfolder"),
    lidarrFetch("/api/v1/qualityprofile"),
    lidarrFetch("/api/v1/metadataprofile"),
  ]);

  const rootFolder = rootFolders[0];
  const qualityProfile = qualityProfiles[0];
  const metadataProfile = metadataProfiles[0];

  if (!rootFolder || !qualityProfile || !metadataProfile) {
    throw new Error("Missing Lidarr root folder, quality profile, or metadata profile");
  }

  return { rootFolder, qualityProfile, metadataProfile };
}

async function ensureLidarrArtistForRequest(artist = {}) {
  if (!artist?.name) {
    throw new Error("Missing artist name");
  }

  const existingArtists = await lidarrFetch("/api/v1/artist");
  const existing = existingArtists.find((item) =>
    (artist.id && item.foreignArtistId === artist.id) ||
    normalizeLidarrCompare(item.artistName || item.name) === normalizeLidarrCompare(artist.name)
  );

  if (existing) return existing;

  const lookupResults = await lidarrFetch(`/api/v1/artist/lookup?term=${encodeURIComponent(artist.name)}`);
  const lidarrArtist =
    lookupResults.find((item) => artist.id && item.foreignArtistId === artist.id) ||
    lookupResults.find((item) => normalizeLidarrCompare(item.artistName || item.name) === normalizeLidarrCompare(artist.name)) ||
    lookupResults[0];

  if (!lidarrArtist) {
    throw new Error("Artist not found in Lidarr lookup");
  }

  const { rootFolder, qualityProfile, metadataProfile } = await getLidarrDefaults();

  try {
    return await lidarrFetch("/api/v1/artist", {
      method: "POST",
      body: JSON.stringify({
        ...lidarrArtist,
        monitored: true,
        rootFolderPath: rootFolder.path,
        qualityProfileId: qualityProfile.id,
        metadataProfileId: metadataProfile.id,
        addOptions: {
          monitor: "all",
          searchForMissingAlbums: false,
        },
      }),
    });
  } catch (error) {
    const message = error.message || "";

    if (message.includes("already") || message.includes("ArtistExistsValidator")) {
      const refreshedArtists = await lidarrFetch("/api/v1/artist");
      const refreshed = refreshedArtists.find((item) =>
        (artist.id && item.foreignArtistId === artist.id) ||
        normalizeLidarrCompare(item.artistName || item.name) === normalizeLidarrCompare(artist.name)
      );

      if (refreshed) return refreshed;
    }

    throw error;
  }
}

async function requestLidarrAlbumForSong(artist = {}, album = {}) {
  const lidarrArtist = await ensureLidarrArtistForRequest(artist);
  const albums = await lidarrFetch(`/api/v1/album?artistId=${lidarrArtist.id}`);
  const albumTitle = album.title || album.name || "";
  const lidarrAlbum = albums.find((item) =>
    (album.id && item.foreignAlbumId === album.id) ||
    normalizeLidarrCompare(item.title) === normalizeLidarrCompare(albumTitle)
  );

  if (!lidarrAlbum) {
    throw new Error("Album was not found in Lidarr for this artist");
  }

  await lidarrFetch(`/api/v1/album/${lidarrAlbum.id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...lidarrAlbum,
      monitored: true,
    }),
  });

  await lidarrFetch("/api/v1/command", {
    method: "POST",
    body: JSON.stringify({
      name: "AlbumSearch",
      albumIds: [lidarrAlbum.id],
    }),
  });

  return { lidarrArtist, lidarrAlbum };
}

app.post("/api/integrations/lidarr/request-song", async (req, res) => {
  try {
    const song = req.body?.song || {};
    const artist = req.body?.artist || {
      id: song.artistId,
      name: song.artist,
    };
    const album = req.body?.album || (song.albumId
      ? {
          id: song.albumId,
          title: song.album,
          artist: song.artist,
          artistId: song.artistId,
        }
      : null);

    if (!song?.title || !artist?.name) {
      return res.status(400).json({
        ok: false,
        message: "Missing song title or artist",
      });
    }

    const key = song.key || song.id || `${artist.name}::${song.title}`;

    if (album?.id || album?.title) {
      const { lidarrArtist, lidarrAlbum } = await requestLidarrAlbumForSong(artist, album);

      const saved = upsertMusicRequestRecord({
        ...song,
        key,
        type: "song",
        status: "requested",
        route: "lidarr-album",
        lidarrArtistId: lidarrArtist.id,
        lidarrAlbumId: lidarrAlbum.id,
        requestedAt: new Date().toISOString(),
      });

      return res.json({
        ok: true,
        status: "requested",
        message: `${song.title} requested through Lidarr album search: ${lidarrAlbum.title}`,
        request: saved,
        album: lidarrAlbum,
        artist: lidarrArtist,
        lidarr: {
          route: "album",
          artistId: lidarrArtist.id,
          albumId: lidarrAlbum.id,
        },
      });
    }

    const lidarrArtist = await ensureLidarrArtistForRequest(artist);

    await lidarrFetch("/api/v1/command", {
      method: "POST",
      body: JSON.stringify({
        name: "RefreshArtist",
        artistId: lidarrArtist.id,
      }),
    }).catch((error) => {
      console.warn("Lidarr RefreshArtist command failed:", error.message);
    });

    const saved = upsertMusicRequestRecord({
      ...song,
      key,
      type: "song",
      status: "pending",
      route: "lidarr-artist",
      lidarrArtistId: lidarrArtist.id,
      requestedAt: new Date().toISOString(),
    });

    res.json({
      ok: true,
      status: "pending",
      message: `${song.title} saved as a pending song request. ${artist.name} was added/monitored in Lidarr.`,
      request: saved,
      artist: lidarrArtist,
      lidarr: {
        route: "artist",
        artistId: lidarrArtist.id,
      },
    });
  } catch (error) {
    console.error("Lidarr request song failed:", error);

    res.status(500).json({
      ok: false,
      message: error.message || "Lidarr request song failed",
    });
  }
});

app.get("/api/integrations/lidarr/album-status/:artistMbid/:albumMbid", async (req, res) => {
  try {
    const artistMbid = req.params.artistMbid;
    const albumMbid = req.params.albumMbid;

    const artists = await lidarrFetch("/api/v1/artist");

    const artist = artists.find(
      (item) => item.foreignArtistId === artistMbid
    );

    if (!artist) {
      return res.json({
        exists: false,
        monitored: false,
        artistExists: false,
      });
    }

    const albums = await lidarrFetch(`/api/v1/album?artistId=${artist.id}`);

    const album = albums.find(
      (item) => item.foreignAlbumId === albumMbid
    );

    res.json({
      exists: !!album,
      monitored: album?.monitored || false,
      downloaded: album?.statistics?.trackFileCount > 0 || false,
      albumId: album?.id || null,
      artistExists: true,
    });
  } catch (error) {
    console.error("Album status check failed:", error);

    res.status(500).json({
      exists: false,
      monitored: false,
      downloaded: false,
      error: error.message,
    });
  }
});

app.get("/api/integrations/lidarr/artist-status/:mbid", async (req, res) => {
  try {
    const mbid = req.params.mbid;

    const artists = await lidarrFetch("/api/v1/artist");

    const existing = artists.find(
      (artist) => artist.foreignArtistId === mbid
    );

    res.json({
      exists: !!existing,
      monitored: existing?.monitored || false,
      artistId: existing?.id || null,
    });
  } catch (error) {
    console.error("Artist status check failed:", error);

    res.status(500).json({
      exists: false,
      monitored: false,
      error: error.message,
    });
  }
});

app.get("/api/music/artist/:id/details", async (req, res) => {
  try {
    const id = req.params.id;

    const musicBrainzResponse = await fetch(
      `https://musicbrainz.org/ws/2/artist/${id}?fmt=json&inc=tags+aliases+genres+url-rels`,
      {
        headers: {
          "User-Agent": "Homestead/1.0",
          Accept: "application/json",
        },
      }
    );

    const artistData = await musicBrainzResponse.json();

    const wikidataRelation = (artistData.relations || []).find(
      (relation) =>
        relation.type === "wikidata" &&
        relation.url?.resource
    );

    const wikidataId =
      wikidataRelation?.url?.resource
        ?.split("/")
        .filter(Boolean)
        .pop() || "";

    let imageUrl = "";
    let bannerUrl = "";
    let biography = "";
    let website = "";
    let audioDb = null;

    if (wikidataId) {
      try {
        const wikidataResponse = await fetch(
          `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`,
          {
            headers: {
              "User-Agent": "Homestead/1.0",
              Accept: "application/json",
            },
          }
        );

        const wikidata = await wikidataResponse.json();

        const imageName =
          wikidata?.entities?.[wikidataId]?.claims?.P18?.[0]?.mainsnak
            ?.datavalue?.value || "";

        if (imageName) {
          imageUrl = `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(
            imageName
          )}`;
        }
      } catch (wikidataError) {
        console.error("Wikidata artist image lookup failed:", wikidataError);
      }
    }

try {
  const audioDbResponse = await fetch(
    `https://theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(
      artistData.name
    )}`
  );

  const audioDbData = await audioDbResponse.json();

const artistRecord = audioDbData?.artists?.[0];

if (artistRecord) {
  audioDb = artistRecord;

  bannerUrl =
    artistRecord.strArtistBanner ||
    artistRecord.strArtistWideThumb ||
    artistRecord.strArtistFanart ||
    artistRecord.strArtistFanart2 ||
    artistRecord.strArtistFanart3 ||
    artistRecord.strArtistFanart4 ||
    "";

  if (!imageUrl && artistRecord.strArtistThumb) {
    imageUrl = artistRecord.strArtistThumb;
  }

  biography = artistRecord.strBiography || "";
  website = artistRecord.strWebsite || "";
}

} catch (error) {
  console.error("AudioDB lookup failed:", error);
}

    res.json({
      id: artistData.id,
      name: artistData.name,
      country: artistData.country || "",
      type: artistData.type || "",
      disambiguation: artistData.disambiguation || "",
      tags: artistData.tags || [],
      genres: artistData.genres || [],
      aliases: artistData.aliases || [],
      relations: artistData.relations || [],
      wikidataId,
      imageUrl,
      bannerUrl,
      biography,
      website,
      audioDb,
    });
  } catch (error) {
    console.error("Artist details failed:", error);

    res.status(500).json({
      error: "Artist details failed",
    });
  }
});

app.get("/api/music/album/:id/cover", async (req, res) => {
  const albumId = String(req.params.id || "").trim();

  if (!albumId) {
    return res.status(400).json({ ok: false, imageUrl: "" });
  }

  const imageUrl = `https://coverartarchive.org/release-group/${albumId}/front`;

  res.json({
    ok: true,
    imageUrl,
  });
});

const DEFAULT_ADULT_LIVE_TV_FILTERS = [
  "adult",
  "xxx",
  "18+",
  "18 plus",
  "erotic",
  "playboy",
  "hustler",
  "redlight",
  "brazzers",
  "bangbros",
];

function normalizeAdultLiveTvFilters(value) {
  const configured = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n]/)
        .map((entry) => entry.trim());

  return Array.from(
    new Set(
      [...configured, ...DEFAULT_ADULT_LIVE_TV_FILTERS]
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function getAdultLiveTvPreferences(setupConfig = readSetupConfig()) {
  const preferences = setupConfig?.libraryPreferences?.adultTV || {};
  return {
    groupFilters: normalizeAdultLiveTvFilters(preferences.groupFilters),
    hideFromMainLiveTV: preferences.hideFromMainLiveTV !== false,
    recordingsPath: preferences.recordingsPath || "/media/adult/tv/recordings",
  };
}

function isAdultLiveTvChannel(channel = {}, setupConfig = readSetupConfig()) {
  if (
    channel.adult === true ||
    channel.isAdult === true ||
    channel.adultOnly === true ||
    channel.privateAdult === true ||
    String(channel.scope || channel.visibilityScope || "").toLowerCase() === "adult"
  ) {
    return true;
  }

  const { groupFilters } = getAdultLiveTvPreferences(setupConfig);
  const haystack = [
    channel.displayGroup,
    channel.group,
    channel.category,
    channel.displayName,
    channel.name,
    channel.sourceName,
    channel.tvgId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return groupFilters.some((filter) => haystack.includes(filter));
}

function filterLiveTvChannelsByScope(channels = [], scope = "all", setupConfig = readSetupConfig()) {
  const normalizedScope = String(scope || "all").toLowerCase();
  const preferences = getAdultLiveTvPreferences(setupConfig);

  if (normalizedScope === "adult") {
    return channels.filter((channel) => isAdultLiveTvChannel(channel, setupConfig));
  }

  if (normalizedScope === "public" && preferences.hideFromMainLiveTV) {
    return channels.filter((channel) => !isAdultLiveTvChannel(channel, setupConfig));
  }

  return channels;
}

function normalizeLiveTvScopeKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getLiveTvChannelScopeKeys(channel = {}) {
  return [
    channel.tvgId,
    channel.id,
    channel.key,
    channel.name,
    channel.displayName,
    channel.channelId,
    channel.number,
  ]
    .map(normalizeLiveTvScopeKey)
    .filter(Boolean);
}

function getLiveTvProgramScopeKeys(program = {}) {
  return [
    program.channel,
    program.channelId,
    program.tvgId,
    program.id,
    program.displayName,
    program.name,
  ]
    .map(normalizeLiveTvScopeKey)
    .filter(Boolean);
}

function filterLiveTvProgramsByScope(programs = [], scope = "all", setupConfig = readSetupConfig()) {
  const scopedChannels = filterLiveTvChannelsByScope(getLiveTvChannels(), scope, setupConfig);
  const channelKeys = new Set(scopedChannels.flatMap(getLiveTvChannelScopeKeys));
  const scopedSourceIds = new Set(scopedChannels.map((channel) => String(channel.sourceId || "")).filter(Boolean));

  if (String(scope || "all").toLowerCase() === "all") return programs;

  return programs.filter((program) => {
    const sourceMatches = !program.sourceId || scopedSourceIds.has(String(program.sourceId));
    if (!sourceMatches) return false;
    const programKeys = getLiveTvProgramScopeKeys(program);
    return programKeys.some((key) => channelKeys.has(key));
  });
}

// Live TV source manager
app.get("/api/livetv/sources", (req, res) => {
  const config = getLiveTvConfig();

  res.json({
    ok: true,
    sources: config.liveTvSources || [],
    channelOverrides: config.channelOverrides || {},
  });
});

app.post("/api/livetv/sources", (req, res) => {
  const config = getLiveTvConfig();
  const {
  name,
  type,
  url,
  epgUrl,
  serverUrl,
  username,
  password,
  enabled,
} = req.body || {};

const sourceType = type || "m3u";

if (sourceType === "m3u" && !url) {
  return res.status(400).json({
    ok: false,
    error: "M3U URL is required",
  });
}

if (sourceType === "xtream" && (!serverUrl || !username || !password)) {
  return res.status(400).json({
    ok: false,
    error: "Server URL, username, and password are required",
  });
}

const nextSource = {
  id: createId("source"),
  name: name || (sourceType === "xtream" ? "IPTV Login" : "M3U Source"),
  type: sourceType,
  url: sourceType === "m3u" ? url : "",
  serverUrl: sourceType === "xtream" ? serverUrl : "",
  username: sourceType === "xtream" ? username : "",
  password: sourceType === "xtream" ? password : "",
  epgUrl: epgUrl || "",
  enabled: enabled !== false,
  priority: (config.liveTvSources?.length || 0) * 10 + 10,
  builtIn: false,
  lastScan: null,
  channelCount: 0,
  epgProgramCount: 0,
};

  const nextConfig = saveLiveTvConfig({
    ...config,
    liveTvSources: [...(config.liveTvSources || []), nextSource],
  });

  res.json({
    ok: true,
    source: nextSource,
    sources: nextConfig.liveTvSources,
  });
});

app.put("/api/livetv/sources/:sourceId", (req, res) => {
  const config = getLiveTvConfig();
  const { sourceId } = req.params;
const {
  name,
  type,
  url,
  epgUrl,
  serverUrl,
  username,
  password,
  enabled,
  priority,
} = req.body || {};

  const sources = (config.liveTvSources || []).map((source) => {
    if (source.id !== sourceId) return source;

return {
  ...source,
  type: type ?? source.type ?? "m3u",
  name: name ?? source.name,
  url: url ?? source.url,
  serverUrl: serverUrl ?? source.serverUrl ?? "",
  username: username ?? source.username ?? "",
  password: password ?? source.password ?? "",
  epgUrl: epgUrl ?? source.epgUrl,
  enabled: enabled !== undefined ? Boolean(enabled) : source.enabled,
  priority: priority !== undefined ? Number(priority) : source.priority,
};
  });

  const nextConfig = saveLiveTvConfig({
    ...config,
    liveTvSources: sources,
  });

  res.json({
    ok: true,
    sources: nextConfig.liveTvSources,
  });
});

app.get("/api/livetv/proxy", async (req, res) => {
  try {
    const encodedUrl = req.query.url;

    if (!encodedUrl) {
      return res.status(400).send("Missing stream URL");
    }

    const streamUrl = decodeProxyUrl(encodedUrl);

    const upstream = await fetch(streamUrl, {
      headers: {
        "User-Agent": "Homestead LiveTV/1.0",
        Accept: "*/*",
      },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .send(`Stream fetch failed: ${upstream.status} ${upstream.statusText}`);
    }

    const contentType = upstream.headers.get("content-type") || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");

    if (
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8") ||
      streamUrl.toLowerCase().includes(".m3u8")
    ) {
      const playlistText = await upstream.text();
const finalPlaylistUrl = upstream.url || streamUrl;
const rewrittenPlaylist = rewriteM3u8Playlist(playlistText, finalPlaylistUrl);

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.send(rewrittenPlaylist);
    }

    res.setHeader("Content-Type", contentType || "application/octet-stream");

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.status(502).send("No upstream stream body");
    }
  } catch (error) {
    res.status(500).send(error.message || "Stream proxy failed");
  }
});

function encodeProxyUrl(url) {
  return Buffer.from(url, "utf8").toString("base64url");
}

function decodeProxyUrl(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function rewriteM3u8Playlist(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return line;
      }

      // Rewrite encryption/key URI attributes if present
      if (trimmed.startsWith("#EXT-X-KEY") && trimmed.includes("URI=")) {
        return line.replace(/URI="([^"]+)"/, (match, uri) => {
          const absoluteUrl = new URL(uri, baseUrl).toString();
          return `URI="/api/livetv/proxy?url=${encodeProxyUrl(absoluteUrl)}"`;
        });
      }

      // Leave normal HLS tags alone
      if (trimmed.startsWith("#")) {
        return line;
      }

      // Rewrite segment/child-playlist URLs
      const absoluteUrl = new URL(trimmed, baseUrl).toString();
      return `/api/livetv/proxy?url=${encodeProxyUrl(absoluteUrl)}`;
    })
    .join("\n");
}

app.delete("/api/livetv/sources/:sourceId", (req, res) => {
  const config = getLiveTvConfig();
  const { sourceId } = req.params;

  const sources = (config.liveTvSources || []).filter(
    (source) => source.id !== sourceId
  );

  const channels = getLiveTvChannels().filter(
    (channel) => channel.sourceId !== sourceId
  );

  const channelOverrides = { ...(config.channelOverrides || {}) };

  Object.keys(channelOverrides).forEach((key) => {
    if (key.startsWith(`${sourceId}::`)) {
      delete channelOverrides[key];
    }
  });

  saveLiveTvChannels(channels);

  const nextConfig = saveLiveTvConfig({
    ...config,
    liveTvSources: sources,
    channelOverrides,
  });

  res.json({
    ok: true,
    sources: nextConfig.liveTvSources,
    channelCount: channels.length,
  });
});

app.post("/api/livetv/sources/:sourceId/scan", async (req, res) => {
  try {
    const config = getLiveTvConfig();
    const { sourceId } = req.params;

    const source = (config.liveTvSources || []).find(
      (item) => item.id === sourceId
    );

    if (!source) {
      return res.status(404).json({
        ok: false,
        error: "Source not found",
      });
    }

    const scannedChannels = await scanLiveTvSource(source);
	const scannedPrograms = await fetchEpgPrograms(source);
    const existingChannels = getLiveTvChannels().filter(
      (channel) => channel.sourceId !== sourceId
    );

    const updatedSource = {
      ...source,
      lastScan: new Date().toISOString(),
      channelCount: scannedChannels.length,
	  epgProgramCount: scannedPrograms.length,
    };

    const sources = (config.liveTvSources || []).map((item) =>
      item.id === sourceId ? updatedSource : item
    );

    const mergedChannels = dedupeChannels([
      ...existingChannels,
      ...scannedChannels,
    ]);

    const finalChannels = applyChannelOverrides(
      mergedChannels,
      config.channelOverrides || {}
    );

    saveLiveTvChannels(finalChannels);
	
	const existingPrograms = getLiveTvEpg().filter(
  (program) => program.sourceId !== sourceId
);

saveLiveTvEpg([...existingPrograms, ...scannedPrograms]);

    const nextConfig = saveLiveTvConfig({
      ...config,
      liveTvSources: sources,
      lastRefresh: new Date().toISOString(),
    });

    res.json({
      ok: true,
      source: updatedSource,
      sources: nextConfig.liveTvSources,
      channelCount: finalChannels.length,
      scannedCount: scannedChannels.length,
	  epgProgramCount: scannedPrograms.length,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to scan source",
    });
  }
});

app.get("/api/livetv/epg", (req, res) => {
  const now = new Date();
  const scope = String(req.query.scope || "all").toLowerCase();
  const setupConfig = readSetupConfig();
  const pastCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const futureCutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const programsInWindow = getLiveTvEpg().filter((program) => {
    const stop = new Date(program.stop);
    const start = new Date(program.start);

    return stop >= pastCutoff && start <= futureCutoff;
  });
  const programs = filterLiveTvProgramsByScope(programsInWindow, scope, setupConfig);

  res.json({
    ok: true,
    scope,
    programs,
    programCount: programs.length,
  });
});

app.post("/api/livetv/sources/scan-all", async (req, res) => {
  try {
    const config = getLiveTvConfig();
    const enabledSources = (config.liveTvSources || []).filter((source) => {
      if (source.enabled === false) return false;
      if ((source.type || "m3u") === "xtream") {
        return Boolean(source.serverUrl && source.username && source.password);
      }
      return Boolean(source.url);
    });

    const allChannels = [];
    const allPrograms = [];
    const sourceResults = [];

    for (const source of enabledSources) {
      try {
        const channels = await scanLiveTvSource(source);
        let programs = [];
        let epgError = "";

        try {
          programs = await fetchEpgPrograms(source);
        } catch (error) {
          epgError = error.message || "EPG refresh failed";
        }

        allChannels.push(...channels);
        allPrograms.push(...programs);

        sourceResults.push({
          id: source.id,
          name: source.name,
          ok: true,
          channelCount: channels.length,
          epgProgramCount: programs.length,
          epgError,
        });
      } catch (error) {
        sourceResults.push({
          id: source.id,
          name: source.name,
          ok: false,
          error: error.message || "Source scan failed",
          channelCount: 0,
          epgProgramCount: 0,
        });
      }
    }

    const updatedSources = (config.liveTvSources || []).map((source) => {
      const result = sourceResults.find((item) => item.id === source.id);

      if (!result || !result.ok) {
        return source;
      }

      return {
        ...source,
        lastScan: new Date().toISOString(),
        channelCount: result.channelCount,
        epgProgramCount: result.epgProgramCount || 0,
        epgLastScan: new Date().toISOString(),
        epgLastError: result.epgError || "",
      };
    });

    const dedupedChannels = dedupeChannels(allChannels);
    const finalChannels = applyChannelOverrides(
      dedupedChannels,
      config.channelOverrides || {}
    );

    finalChannels.sort((a, b) => {
      const sourceA = updatedSources.find((source) => source.id === a.sourceId);
      const sourceB = updatedSources.find((source) => source.id === b.sourceId);

      const priorityA = sourceA?.priority ?? 999;
      const priorityB = sourceB?.priority ?? 999;

      if (priorityA !== priorityB) return priorityA - priorityB;

      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    saveLiveTvChannels(finalChannels);
    saveLiveTvEpg(allPrograms);

    const nextConfig = saveLiveTvConfig({
      ...config,
      liveTvSources: updatedSources,
      lastRefresh: new Date().toISOString(),
    });

    res.json({
      ok: true,
      sources: nextConfig.liveTvSources,
      channelCount: finalChannels.length,
      rawChannelCount: allChannels.length,
      epgProgramCount: allPrograms.length,
      sourceResults,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to scan all sources",
    });
  }
});

app.get("/api/livetv/sources/:sourceId/channels", (req, res) => {
  const config = getLiveTvConfig();
  const { sourceId } = req.params;

  const channels = applyChannelOverrides(
    getLiveTvChannels().filter((channel) => channel.sourceId === sourceId),
    config.channelOverrides || {}
  );

  res.json({
    ok: true,
    channels,
    channelCount: channels.length,
  });
});

app.post("/api/livetv/channel-overrides", (req, res) => {
  const config = getLiveTvConfig();
  const { channelKey, override } = req.body || {};

  if (!channelKey) {
    return res.status(400).json({
      ok: false,
      error: "channelKey is required",
    });
  }

  const channelOverrides = {
    ...(config.channelOverrides || {}),
    [channelKey]: {
      ...((config.channelOverrides || {})[channelKey] || {}),
      ...(override || {}),
      updatedAt: new Date().toISOString(),
    },
  };

  const nextConfig = saveLiveTvConfig({
    ...config,
    channelOverrides,
  });

  const finalChannels = applyChannelOverrides(
    getLiveTvChannels(),
    nextConfig.channelOverrides || {}
  );

  saveLiveTvChannels(finalChannels);

  res.json({
    ok: true,
    channelOverrides: nextConfig.channelOverrides,
  });
});

// Live TV V1 config
app.get("/api/livetv/config", (req, res) => {
  res.json({
    ok: true,
    config: getLiveTvConfig(),
  });
});

app.post("/api/livetv/config", (req, res) => {
  const { playlistUrl, epgUrl, xteveUrl } = req.body || {};

  const config = saveLiveTvConfig({
    playlistUrl: playlistUrl || "",
    epgUrl: epgUrl || "",
    xteveUrl: xteveUrl || "",
  });

  res.json({
    ok: true,
    config,
  });
});

// Test playlist without saving channels
app.post("/api/livetv/playlist/test", async (req, res) => {
  try {
    const { playlistUrl } = req.body || {};

    if (!playlistUrl) {
      return res.status(400).json({
        ok: false,
        error: "playlistUrl is required",
      });
    }

    const text = await fetchPlaylistText(playlistUrl);
    const channels = parseM3U(text);

    res.json({
      ok: true,
      channelCount: channels.length,
      sampleChannels: channels.slice(0, 10),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to test playlist",
    });
  }
});

app.post("/api/livetv/playlist/refresh", async (req, res) => {
  try {
    const config = getLiveTvConfig();
    const enabledSources = (config.liveTvSources || []).filter((source) => {
      if (source.enabled === false) return false;
      if ((source.type || "m3u") === "xtream") {
        return Boolean(source.serverUrl && source.username && source.password);
      }
      return Boolean(source.url);
    });

    const allChannels = [];
    const sourceResults = [];

    for (const source of enabledSources) {
      try {
        const channels = await scanLiveTvSource(source);

        allChannels.push(...channels);

        sourceResults.push({
          id: source.id,
          name: source.name,
          ok: true,
          channelCount: channels.length,
        });
      } catch (error) {
        sourceResults.push({
          id: source.id,
          name: source.name,
          ok: false,
          error: error.message || "Source scan failed",
          channelCount: 0,
        });
      }
    }

    const updatedSources = (config.liveTvSources || []).map((source) => {
      const result = sourceResults.find((item) => item.id === source.id);

      if (!result || !result.ok) {
        return source;
      }

      return {
        ...source,
        lastScan: new Date().toISOString(),
        channelCount: result.channelCount,
      };
    });

    const dedupedChannels = dedupeChannels(allChannels);
    const finalChannels = applyChannelOverrides(
      dedupedChannels,
      config.channelOverrides || {}
    );

    saveLiveTvChannels(finalChannels);

    const nextConfig = saveLiveTvConfig({
      ...config,
      liveTvSources: updatedSources,
      lastRefresh: new Date().toISOString(),
    });

    res.json({
      ok: true,
      config: nextConfig,
      channelCount: finalChannels.length,
      rawChannelCount: allChannels.length,
      sourceResults,
      sampleChannels: finalChannels.slice(0, 10),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Failed to refresh playlist",
    });
  }
});

// Get parsed channels
app.get("/api/livetv/channels", (req, res) => {
  const scope = String(req.query.scope || "all").toLowerCase();
  const setupConfig = readSetupConfig();
  const channels = filterLiveTvChannelsByScope(getLiveTvChannels(), scope, setupConfig);

  res.json({
    ok: true,
    scope,
    channels,
    channelCount: channels.length,
  });
});


const LIVE_TV_RECORDING_EXTENSIONS = new Set([".mp4", ".mkv", ".m4v", ".mov", ".webm", ".ts", ".mpeg", ".mpg"]);

function formatLiveTvFileSize(bytes = 0) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function listLiveTvRecordings(rootPath) {
  if (!rootPath || !path.isAbsolute(rootPath) || !fs.existsSync(rootPath)) return [];
  const results = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !LIVE_TV_RECORDING_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      const relativePath = path.relative(rootPath, fullPath).split(path.sep).join("/");
      results.push({
        id: crypto.createHash("sha1").update(fullPath).digest("hex").slice(0, 16),
        title: path.basename(entry.name, path.extname(entry.name)),
        path: fullPath,
        relativePath,
        sizeBytes: stat.size,
        sizeLabel: formatLiveTvFileSize(stat.size),
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }
  return results.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

app.get("/api/livetv/recordings", (req, res) => {
  const scope = String(req.query.scope || "public").toLowerCase();
  const setupConfig = readSetupConfig();
  const recordingsPath = scope === "adult"
    ? getAdultLiveTvPreferences(setupConfig).recordingsPath
    : setupConfig?.libraryPreferences?.liveTV?.recordingsPath || "/media/livetv/recordings";
  const recordings = listLiveTvRecordings(recordingsPath);
  res.json({ ok: true, scope, recordingsPath, recordings, recordingCount: recordings.length });
});



// Adult Import by URL V1: server-side import into a selected adult profile folder.
const ADULT_IMPORT_ALLOWED_LIBRARIES = new Set(["personal", "performers", "celebrities"]);
const ADULT_IMPORT_TYPE_FOLDERS = {
  photo: "photos",
  photos: "photos",
  gallery: "photos",
  nude: "nudes",
  nudes: "nudes",
  adultSet: "nudes",
  poster: "",
  banner: "",
  headshot: "",
  artwork: "artwork",
  reference: "references",
  scene: "scenes",
  video: "scenes",
  ai: "ai",
  private: "pedofile",
  source: "imports/sources",
};
const ADULT_PHOTO_IMPORT_DESTINATIONS = new Set(["photos", "nudes", "artwork", "references", "poster", "banner", "headshot"]);
const ADULT_IMPORT_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const ADULT_IMPORT_VIDEO_EXTS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const ADULT_IMPORT_MAX_IMAGE_BYTES = Number(process.env.HOMESTEAD_ADULT_IMPORT_MAX_IMAGE_MB || 32) * 1024 * 1024;
const ADULT_IMPORT_MAX_VIDEO_BYTES = Number(process.env.HOMESTEAD_ADULT_IMPORT_MAX_VIDEO_MB || 512) * 1024 * 1024;

function sanitizeAdultImportSegment(value = "") {
  return String(value || "")
    .trim()
    .replace(/[<>:"|?*\x00-\x1F]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "untitled";
}

function slugifyAdultImportSegment(value = "") {
  return sanitizeAdultImportSegment(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";
}

function getAdultImportProfileDir(targetLibrary = "performers", profileName = "") {
  const safeLibrary = ADULT_IMPORT_ALLOWED_LIBRARIES.has(targetLibrary) ? targetLibrary : "performers";
  const displayName = sanitizeAdultImportSegment(profileName);
  if (!displayName || displayName === "untitled") {
    const error = new Error("Profile name is required.");
    error.status = 400;
    throw error;
  }

  const existing = findAdultProfileDir({ libraryType: safeLibrary, profileName: displayName, profileId: displayName });
  if (existing) return existing;

  const root = getAdultProfileRootCandidates(safeLibrary)[0] || path.join(process.env.MEDIA_ROOT || "/media", "adult", safeLibrary);
  const preferred = path.join(root, displayName);
  fs.mkdirSync(preferred, { recursive: true });
  return preferred;
}

function extensionFromContentType(contentType = "", fallbackUrl = "") {
  const lower = String(contentType || "").toLowerCase();
  if (lower.includes("image/jpeg")) return ".jpg";
  if (lower.includes("image/png")) return ".png";
  if (lower.includes("image/webp")) return ".webp";
  if (lower.includes("image/gif")) return ".gif";
  if (lower.includes("video/mp4")) return ".mp4";
  if (lower.includes("video/webm")) return ".webm";
  if (lower.includes("video/quicktime")) return ".mov";
  try {
    const parsed = new URL(fallbackUrl);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (ext) return ext;
  } catch {}
  return "";
}

function isAllowedAdultImportMedia(importType, ext, contentType = "") {
  const lower = String(contentType || "").toLowerCase();
  if (importType === "source") return true;
  if (["photo", "photos", "gallery", "nude", "nudes", "adultSet", "poster", "banner", "headshot", "artwork", "reference", "private"].includes(importType)) {
    return ADULT_IMPORT_IMAGE_EXTS.has(ext) || lower.startsWith("image/");
  }
  if (["scene", "video"].includes(importType)) {
    return ADULT_IMPORT_VIDEO_EXTS.has(ext) || lower.startsWith("video/") || lower.includes("application/octet-stream");
  }
  if (importType === "ai") {
    return ADULT_IMPORT_IMAGE_EXTS.has(ext) || ADULT_IMPORT_VIDEO_EXTS.has(ext) || lower.startsWith("image/") || lower.startsWith("video/") || lower.includes("application/octet-stream");
  }
  return false;
}


function decodeAdultHtmlEntity(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isLikelyAdultGalleryImageUrl(value = "") {
  const clean = String(value || "").split("#")[0].trim();
  if (!clean || /^(data|blob|javascript):/i.test(clean)) return false;
  if (/\.(svg|ico|css|js)(?:$|[?#])/i.test(clean)) return false;
  if (!/\.(jpe?g|png|webp|gif)(?:$|[?#])/i.test(clean)) return false;
  if (/(logo|favicon|sprite|avatar|flag|icon|button|banner-ad|advert|ads?\/|tracking)/i.test(clean)) return false;
  return true;
}

function isLikelyAdultGalleryVideoUrl(value = "") {
  const clean = String(value || "").split("#")[0].trim();
  if (!clean || /^(data|blob|javascript):/i.test(clean)) return false;
  if (!/\.(mp4|m4v|mov|webm|mkv)(?:$|[?#])/i.test(clean)) return false;
  if (/(logo|favicon|sprite|avatar|flag|icon|button|banner-ad|advert|ads?\/|tracking)/i.test(clean)) return false;
  return true;
}

function normalizeAdultGalleryImageUrl(rawValue = "", pageUrl = "") {
  const decoded = decodeAdultHtmlEntity(rawValue).trim();
  if (!decoded) return "";
  const firstSrcsetValue = decoded.split(",").map((part) => part.trim().split(/\s+/)[0]).find(Boolean) || decoded;
  try {
    const parsed = new URL(firstSrcsetValue, pageUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const normalized = parsed.href;
    return isLikelyAdultGalleryImageUrl(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

function normalizeAdultGalleryVideoUrl(rawValue = "", pageUrl = "") {
  const decoded = decodeAdultHtmlEntity(rawValue).trim();
  if (!decoded) return "";
  const firstValue = decoded.split(",").map((part) => part.trim().split(/\s+/)[0]).find(Boolean) || decoded;
  try {
    const parsed = new URL(firstValue, pageUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const normalized = parsed.href;
    return isLikelyAdultGalleryVideoUrl(normalized) ? normalized : "";
  } catch {
    return "";
  }
}

function adultGalleryDedupeKey(urlValue = "") {
  try {
    const parsed = new URL(String(urlValue || "").trim());
    parsed.hash = "";
    parsed.search = "";
    const basename = path.basename(parsed.pathname || "").toLowerCase();
    // CoedCherry and similar pages often expose the same file through img/src, href,
    // lazy-load, source/srcset, and JSON fields. Prefer filename-level de-dupe for media files.
    if (basename && /\.(jpe?g|png|webp|gif|mp4|m4v|mov|webm|mkv)$/i.test(basename)) return `${parsed.origin.toLowerCase()}::${basename}`;
    return parsed.href.toLowerCase();
  } catch {
    const clean = String(urlValue || "").split(/[?#]/)[0].trim().toLowerCase();
    return path.basename(clean) || clean;
  }
}

function extractAdultGalleryImageUrls(pageUrl = "", html = "", limit = 80) {
  const found = [];
  const seen = new Set();
  const push = (candidate) => {
    const normalized = normalizeAdultGalleryImageUrl(candidate, pageUrl);
    if (!normalized) return;
    const key = adultGalleryDedupeKey(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(normalized);
  };

  const attrRe = /(?:src|data-src|data-original|data-lazy-src|data-full|data-large|data-image|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(html)) && found.length < limit * 3) {
    push(match[1]);
  }

  const srcsetRe = /(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi;
  while ((match = srcsetRe.exec(html)) && found.length < limit * 3) {
    String(match[1] || "").split(",").forEach((entry) => push(entry.trim().split(/\s+/)[0]));
  }

  const jsonUrlRe = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|gif)(?:\?[^"'\\\s<>]*)?/gi;
  while ((match = jsonUrlRe.exec(html)) && found.length < limit * 3) {
    push(String(match[0] || "").replace(/\\\//g, "/"));
  }

  return found.slice(0, limit);
}

function extractAdultGalleryVideoUrls(pageUrl = "", html = "", limit = 20) {
  const found = [];
  const seen = new Set();
  const push = (candidate) => {
    const normalized = normalizeAdultGalleryVideoUrl(candidate, pageUrl);
    if (!normalized) return;
    const key = adultGalleryDedupeKey(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(normalized);
  };

  const attrRe = /(?:src|data-src|data-video|data-video-src|data-mp4|data-file|data-url|href|content)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(html)) && found.length < limit * 3) {
    push(match[1]);
  }

  const sourceTagRe = /<source[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = sourceTagRe.exec(html)) && found.length < limit * 3) {
    push(match[1]);
  }

  const jsonUrlRe = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp4|m4v|mov|webm|mkv)(?:\?[^"'\\\s<>]*)?/gi;
  while ((match = jsonUrlRe.exec(html)) && found.length < limit * 3) {
    push(String(match[0] || "").replace(/\\\//g, "/"));
  }

  return found.slice(0, limit);
}

async function downloadAdultImportMediaToProfile({ mediaUrl, rawPageUrl = "", profileDir, importType, sourceName, sourceSlug, index = 0, now = new Date().toISOString() }) {
  const response = await fetch(mediaUrl, {
    headers: {
      "User-Agent": "Homestead/1.0 AdultImport (+user-initiated)",
      Accept: importType === "scene" || importType === "video" ? "video/*,*/*" : "image/*,*/*",
      Referer: rawPageUrl || undefined,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const ext = extensionFromContentType(contentType, mediaUrl);

  if (!isAllowedAdultImportMedia(importType, ext, contentType)) {
    throw new Error(`URL did not return an allowed ${importType === "scene" || importType === "video" ? "video" : "image"} file${contentType ? ` (${contentType})` : ""}.`);
  }

  const parsed = new URL(mediaUrl);
  const sourceBaseName = sanitizeAdultImportSegment(path.basename(parsed.pathname, path.extname(parsed.pathname)) || `${sourceSlug}-${Date.now()}-${index + 1}`);
  const finalExt = ext || (importType === "scene" ? ".mp4" : ".jpg");
  let destination;

  if (importType === "poster") {
    destination = path.join(profileDir, `poster${finalExt}`);
  } else if (importType === "banner") {
    destination = path.join(profileDir, `banner${finalExt}`);
  } else if (importType === "headshot") {
    destination = path.join(profileDir, `headshot${finalExt}`);
  } else {
    const folder = importType === "nude" || importType === "nudes" || importType === "adultSet"
      ? "nudes"
      : (ADULT_IMPORT_TYPE_FOLDERS[importType] || "photos");
    const destinationDir = path.join(profileDir, folder);
    fs.mkdirSync(destinationDir, { recursive: true });
    destination = path.join(destinationDir, `${Date.now()}-${index + 1}-${sourceBaseName}${finalExt}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const isVideoImport = importType === "scene" || importType === "video";
  const maxBytes = isVideoImport ? ADULT_IMPORT_MAX_VIDEO_BYTES : ADULT_IMPORT_MAX_IMAGE_BYTES;
  if (buffer.length > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(`Media file is larger than ${maxMb} MB`);
  }
  fs.writeFileSync(destination, buffer);

  return {
    id: `adult-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: importType === "nude" || importType === "nudes" || importType === "adultSet" ? "nude" : importType,
    destinationType: importType === "nude" || importType === "nudes" || importType === "adultSet"
      ? "nudes"
      : (["poster", "banner", "headshot"].includes(importType) ? importType : (ADULT_IMPORT_TYPE_FOLDERS[importType] || "photos")),
    sourceName,
    sourceUrl: rawPageUrl || mediaUrl,
    directUrl: mediaUrl,
    contentType,
    destination,
    relativeDestination: path.relative(profileDir, destination),
    savedAt: now,
  };
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function appendAdultImportRecord(profileDir, record) {
  const metadataPath = path.join(profileDir, "metadata.json");
  const existing = readJsonIfExists(metadataPath, { metadata: {} });
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
  const imports = Array.isArray(metadata.imports) ? metadata.imports : [];
  const next = {
    ...(existing.metadata ? existing : { metadata }),
    metadata: {
      ...metadata,
      imports: [record, ...imports].slice(0, 250),
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));
}

function getAdultImportMetadata(profileDir) {
  const metadataPath = path.join(profileDir, "metadata.json");
  const existing = readJsonIfExists(metadataPath, { metadata: {} });
  return existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
}

function normalizeAdultImportUrlKey(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    parsed.search = "";
    return parsed.href.toLowerCase();
  } catch {
    return String(value || "").split(/[?#]/)[0].trim().toLowerCase();
  }
}

function adultImportBasenameKey(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    return path.basename(parsed.pathname || "").toLowerCase();
  } catch {
    return path.basename(String(value || "").split(/[?#]/)[0]).toLowerCase();
  }
}

function getExistingAdultImportKeys(profileDir) {
  const metadata = getAdultImportMetadata(profileDir);
  const imports = Array.isArray(metadata.imports) ? metadata.imports : [];
  const urlKeys = new Set();
  const basenameKeys = new Set();

  for (const record of imports) {
    [record?.directUrl, record?.sourceUrl].filter(Boolean).forEach((url) => {
      const normalized = normalizeAdultImportUrlKey(url);
      const basename = adultImportBasenameKey(url);
      if (normalized) urlKeys.add(normalized);
      if (basename) basenameKeys.add(basename);
    });
    const relativeName = path.basename(record?.relativeDestination || record?.destination || "").toLowerCase();
    if (relativeName) basenameKeys.add(relativeName.replace(/^\d+-\d+-/, ""));
  }

  return { urlKeys, basenameKeys };
}


app.post("/api/adult/import-preview-url", async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return res.status(400).json({ ok: false, error: "A valid http(s) URL is required." });
    }

    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Homestead/1.0 AdultImportPreview (+user-initiated)",
        Accept: "image/*,video/*,text/html,*/*",
      },
      redirect: "follow",
    });
    if (!response.ok) return res.status(response.status).json({ ok: false, error: `Provider returned ${response.status}` });

    const contentType = response.headers.get("content-type") || "";
    const ext = extensionFromContentType(contentType, rawUrl);
    const isImage = ADULT_IMPORT_IMAGE_EXTS.has(ext) || contentType.toLowerCase().startsWith("image/");
    const isVideo = ADULT_IMPORT_VIDEO_EXTS.has(ext) || contentType.toLowerCase().startsWith("video/");

    if (isImage || isVideo) {
      const parsed = new URL(rawUrl);
      return res.json({ ok: true, media: [{
        url: rawUrl,
        previewUrl: rawUrl,
        kind: isVideo ? "video" : "image",
        name: decodeURIComponent(path.basename(parsed.pathname) || (isVideo ? "Imported video" : "Imported image")),
      }] });
    }

    const html = await response.text();
    const images = extractAdultGalleryImageUrls(rawUrl, html, 100).map((url, index) => ({
      url, previewUrl: url, kind: "image",
      name: decodeURIComponent(path.basename(new URL(url).pathname) || `Imported image ${index + 1}`),
    }));
    const videos = extractAdultGalleryVideoUrls(rawUrl, html, 30).map((url, index) => ({
      url, previewUrl: url, kind: "video",
      name: decodeURIComponent(path.basename(new URL(url).pathname) || `Imported video ${index + 1}`),
    }));
    const seen = new Set();
    const media = [...images, ...videos].filter((item) => {
      const key = normalizeAdultImportUrlKey(item.url);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!media.length) return res.status(415).json({ ok: false, error: "Homestead could not find downloadable images or videos on that page." });
    return res.json({ ok: true, sourcePageUrl: rawUrl, media });
  } catch (error) {
    console.error("Adult URL preview failed:", error);
    return res.status(error.status || 500).json({ ok: false, error: error.message || "Unable to inspect URL." });
  }
});

app.post("/api/adult/import-url", async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || "").trim();
    const targetLibrary = String(req.body?.targetLibrary || "performers").trim();
    const profileName = String(req.body?.profileName || "").trim();
    const importType = String(req.body?.importType || "photo").trim();
    const sourceName = sanitizeAdultImportSegment(req.body?.sourceName || "provider");
    const importDestination = normalizeAdultPhotoDestination(req.body?.destination || req.body?.importDestination || importType);

    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
      return res.status(400).json({ ok: false, error: "A valid http(s) URL is required." });
    }
    if (!ADULT_IMPORT_TYPE_FOLDERS.hasOwnProperty(importType)) {
      return res.status(400).json({ ok: false, error: "Unsupported import type." });
    }

    const profileDir = getAdultImportProfileDir(targetLibrary, profileName);
    const sourceSlug = slugifyAdultImportSegment(sourceName);
    const now = new Date().toISOString();

    if (importType === "source") {
      const sourceDir = path.join(profileDir, "imports", "sources");
      fs.mkdirSync(sourceDir, { recursive: true });
      const sourceFile = path.join(sourceDir, `${Date.now()}-${sourceSlug}.json`);
      const record = {
        id: `adult-import-${Date.now()}`,
        type: "source",
        sourceName,
        sourceUrl: rawUrl,
        savedAt: now,
        file: sourceFile,
      };
      fs.writeFileSync(sourceFile, JSON.stringify(record, null, 2));
      appendAdultImportRecord(profileDir, record);
      return res.json({
        ok: true,
        importedAs: "source",
        destination: sourceFile,
        relativeDestination: path.relative(profileDir, sourceFile),
        record,
        scanRequested: false,
        scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
        targetLibrary,
        profileName,
        profileId: path.basename(profileDir),
        message: "Saved source reference."
      });
    }

    const response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Homestead/1.0 AdultImport (+user-initiated)",
        Accept: importType === "scene" || importType === "video" ? "video/*,*/*" : "image/*,text/html,*/*",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: `Provider returned ${response.status}` });
    }

    const contentType = response.headers.get("content-type") || "";
    const ext = extensionFromContentType(contentType, rawUrl);
    const isHtmlPage = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const scanLibrary = adultLibraryIdFromProfileLibrary(targetLibrary);

    const canImportGalleryImages = ["photo", "photos", "gallery", "nude", "nudes", "adultSet", "artwork", "reference"].includes(importType);
    const canImportGalleryVideos = ["scene", "video"].includes(importType);
    const looksLikeDirectMedia = isAllowedAdultImportMedia(importType, ext, contentType);
    const shouldTryGalleryExtraction = (canImportGalleryImages || canImportGalleryVideos) && (isHtmlPage || !looksLikeDirectMedia);

    if (shouldTryGalleryExtraction) {
      let html = "";
      try {
        html = await response.text();
      } catch {
        html = "";
      }
      const defaultLimit = canImportGalleryVideos ? 12 : 60;
      const maxLimit = canImportGalleryVideos ? 50 : 100;
      const maxGalleryImports = Math.max(1, Math.min(Number(req.body?.limit) || defaultLimit, maxLimit));
      const mediaUrls = canImportGalleryVideos
        ? extractAdultGalleryVideoUrls(rawUrl, html, maxGalleryImports)
        : extractAdultGalleryImageUrls(rawUrl, html, maxGalleryImports);

      if (mediaUrls.length) {
        const imported = [];
        const failed = [];
        const skipped = [];
        const existingKeys = getExistingAdultImportKeys(profileDir);

        for (const [index, mediaUrl] of mediaUrls.entries()) {
          const normalizedKey = normalizeAdultImportUrlKey(mediaUrl);
          const basenameKey = adultImportBasenameKey(mediaUrl);
          if ((normalizedKey && existingKeys.urlKeys.has(normalizedKey)) || (basenameKey && existingKeys.basenameKeys.has(basenameKey))) {
            skipped.push({ url: mediaUrl, reason: "duplicate" });
            continue;
          }

          try {
            const record = await downloadAdultImportMediaToProfile({
              mediaUrl,
              rawPageUrl: rawUrl,
              profileDir,
              importType: importType === "gallery" ? "photo" : importType,
              sourceName,
              sourceSlug,
              index,
              now,
            });
            appendAdultImportRecord(profileDir, record);
            imported.push(record);
            if (record.directUrl) existingKeys.urlKeys.add(normalizeAdultImportUrlKey(record.directUrl));
            if (record.directUrl) existingKeys.basenameKeys.add(adultImportBasenameKey(record.directUrl));
          } catch (error) {
            failed.push({ url: mediaUrl, message: error.message || "Import failed" });
          }
        }

        runMediaScan();

        return res.json({
          ok: true,
          importedAs: importType,
          sourcePageUrl: rawUrl,
          galleryPageImported: true,
          extractedCount: mediaUrls.length,
          importedCount: imported.length,
          failedCount: failed.length,
          skippedCount: skipped.length,
          imported,
          failed,
          skipped,
          destination: imported[0]?.destination || "",
          relativeDestination: imported[0]?.relativeDestination || "",
          record: imported[0] || null,
          scanRequested: true,
          scanLibrary,
          targetLibrary,
          profileName,
          profileId: path.basename(profileDir),
          message: `Imported ${imported.length} new ${canImportGalleryVideos ? "video" : "image"}${imported.length === 1 ? "" : "s"} from gallery page to ${canImportGalleryVideos ? "/scenes" : (importType === "nude" || importType === "nudes" || importType === "adultSet" ? "/nudes" : "/photos")}${skipped.length ? `; skipped ${skipped.length} duplicate${skipped.length === 1 ? "" : "s"}` : ""}${failed.length ? `; ${failed.length} failed.` : "."}`,
        });
      }

      return res.status(415).json({
        ok: false,
        error: canImportGalleryVideos
          ? "Homestead could not find direct video URLs on that gallery page. Open/play one video and paste its direct .mp4/.webm URL, or save the page as a source reference."
          : "Homestead could not find direct image URLs on that gallery page. Open one image and paste its direct URL, or save the page as a source reference.",
        contentType,
      });
    }

    if (!looksLikeDirectMedia) {
      return res.status(415).json({
        ok: false,
        error: "This URL does not look like a direct downloadable image/video or supported gallery page. Use Import as Source reference, paste a direct media URL, or use a supported gallery page that exposes image/video URLs in the HTML.",
        contentType,
      });
    }

    const record = await downloadAdultImportMediaToProfile({
      mediaUrl: rawUrl,
      rawPageUrl: "",
      profileDir,
      importType,
      sourceName,
      sourceSlug,
      index: 0,
      now,
    });
    appendAdultImportRecord(profileDir, record);
    runMediaScan();

    res.json({
      ok: true,
      importedAs: importType,
      destination: record.destination,
      relativeDestination: record.relativeDestination,
      contentType: record.contentType,
      record,
      imported: [record],
      importedCount: 1,
      scanRequested: true,
      scanLibrary,
      targetLibrary,
      profileName,
      profileId: path.basename(profileDir),
      message: `Saved ${importType} to ${record.relativeDestination}.`,
    });
  } catch (error) {
    console.error("Adult URL import failed:", error);
    res.status(error.status || 500).json({ ok: false, error: error.message || "Adult URL import failed" });
  }
});

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Upload is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartHeaderParameters(value = "") {
  const params = {};
  String(value || "").split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || !rawValue.length) return;
    params[rawKey.toLowerCase()] = rawValue.join("=").trim().replace(/^"|"$/g, "");
  });
  return params;
}

function parseMultipartFormDataBuffer(body, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;
    if (body.slice(partStart, partStart + 2).toString("latin1") === "--") break;
    if (body.slice(partStart, partStart + 2).toString("latin1") === "\r\n") partStart += 2;

    const nextBoundary = body.indexOf(boundaryBuffer, partStart);
    if (nextBoundary === -1) break;
    let part = body.slice(partStart, nextBoundary);
    if (part.slice(-2).toString("latin1") === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("latin1");
      const content = part.slice(headerEnd + 4);
      const headers = {};
      headerText.split("\r\n").forEach((line) => {
        const index = line.indexOf(":");
        if (index === -1) return;
        headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      });
      const disposition = headers["content-disposition"] || "";
      const params = parseMultipartHeaderParameters(disposition);
      const name = params.name || "";
      const filename = params.filename || "";
      if (name && filename) {
        files.push({
          fieldName: name,
          originalName: filename,
          contentType: headers["content-type"] || "application/octet-stream",
          buffer: content,
        });
      } else if (name) {
        fields[name] = content.toString("utf8");
      }
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

function inferAdultUploadMediaType(importType = "photo", ext = "", contentType = "") {
  const lower = String(contentType || "").toLowerCase();
  if (["poster", "banner", "headshot", "nude", "private"].includes(importType)) return importType;
  if (importType === "ai") return ADULT_IMPORT_VIDEO_EXTS.has(ext) || lower.startsWith("video/") ? "video" : "image";
  if (["scene", "video"].includes(importType)) return "video";
  return "image";
}

function saveAdultUploadedMediaToProfile({ file, profileDir, importType, sourceName, index = 0, now = new Date().toISOString() }) {
  const originalBase = sanitizeAdultImportSegment(path.basename(file.originalName || `upload-${index + 1}`));
  const ext = path.extname(originalBase).toLowerCase() || extensionFromContentType(file.contentType, file.originalName || "");
  const normalizedImportType = ADULT_IMPORT_TYPE_FOLDERS.hasOwnProperty(importType) ? importType : "photo";

  if (!isAllowedAdultImportMedia(normalizedImportType, ext, file.contentType)) {
    throw new Error(`${file.originalName || "Upload"} is not an allowed file type for ${normalizedImportType}.`);
  }

  const isVideo = ADULT_IMPORT_VIDEO_EXTS.has(ext) || String(file.contentType || "").toLowerCase().startsWith("video/");
  const maxBytes = isVideo ? ADULT_IMPORT_MAX_VIDEO_BYTES : ADULT_IMPORT_MAX_IMAGE_BYTES;
  if (file.buffer.length > maxBytes) {
    const maxMb = Math.round(maxBytes / 1024 / 1024);
    throw new Error(`${file.originalName || "Upload"} is larger than ${maxMb} MB.`);
  }

  let destination;
  if (normalizedImportType === "poster") {
    destination = path.join(profileDir, `poster${ext || ".jpg"}`);
  } else if (normalizedImportType === "banner") {
    destination = path.join(profileDir, `banner${ext || ".jpg"}`);
  } else if (normalizedImportType === "headshot") {
    destination = path.join(profileDir, `headshot${ext || ".jpg"}`);
  } else {
    const folder = normalizedImportType === "nude" || normalizedImportType === "nudes" || normalizedImportType === "adultSet"
      ? "nudes"
      : (ADULT_IMPORT_TYPE_FOLDERS[normalizedImportType] || "photos");
    const destinationDir = path.join(profileDir, folder);
    fs.mkdirSync(destinationDir, { recursive: true });
    const withoutExt = sanitizeAdultImportSegment(path.basename(originalBase, path.extname(originalBase)) || `upload-${index + 1}`);
    destination = path.join(destinationDir, `${Date.now()}-${index + 1}-${withoutExt}${ext || (isVideo ? ".mp4" : ".jpg")}`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.buffer);

  return {
    id: `adult-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: normalizedImportType === "nude" || normalizedImportType === "nudes" || normalizedImportType === "adultSet" ? "nude" : normalizedImportType,
    mediaType: inferAdultUploadMediaType(normalizedImportType, ext, file.contentType),
    destinationType: ["poster", "banner", "headshot"].includes(normalizedImportType)
      ? normalizedImportType
      : (normalizedImportType === "nude" || normalizedImportType === "nudes" || normalizedImportType === "adultSet" ? "nudes" : (ADULT_IMPORT_TYPE_FOLDERS[normalizedImportType] || "photos")),
    sourceName,
    sourceUrl: "device-upload",
    originalName: file.originalName,
    contentType: file.contentType,
    size: file.buffer.length,
    destination,
    relativeDestination: path.relative(profileDir, destination),
    savedAt: now,
  };
}



app.post("/api/adult/import-upload", async (req, res) => {
  try {
    const contentType = req.headers["content-type"] || "";
    const boundary = String(contentType).match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i)?.[1] || String(contentType).match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i)?.[2];
    if (!boundary) {
      return res.status(400).json({ ok: false, error: "Upload must use multipart/form-data." });
    }

    const maxUploadBytes = Number(process.env.HOMESTEAD_ADULT_UPLOAD_MAX_MB || 768) * 1024 * 1024;
    const body = await readRequestBuffer(req, maxUploadBytes);
    const { fields, files } = parseMultipartFormDataBuffer(body, boundary);

    const targetLibrary = String(fields.targetLibrary || "performers").trim();
    const profileName = String(fields.profileName || "").trim();
    const profileId = String(fields.profileId || "").trim();
    const importType = String(fields.importType || "photo").trim();
    const sourceName = sanitizeAdultImportSegment(fields.sourceName || "device-upload");

    if (!ADULT_IMPORT_TYPE_FOLDERS.hasOwnProperty(importType)) {
      return res.status(400).json({ ok: false, error: "Unsupported upload type." });
    }
    if (!files.length) {
      return res.status(400).json({ ok: false, error: "No files were uploaded." });
    }

    const profileDir = findAdultProfileDir({ libraryType: targetLibrary, profileId, profileName }) || getAdultImportProfileDir(targetLibrary, profileName || profileId);
    const now = new Date().toISOString();
    const imported = [];
    const failed = [];

    for (const [index, file] of files.entries()) {
      try {
        const record = saveAdultUploadedMediaToProfile({ file, profileDir, importType, sourceName, index, now });
        appendAdultImportRecord(profileDir, record);
        imported.push(record);
      } catch (error) {
        failed.push({ originalName: file.originalName, message: error.message || "Upload failed" });
      }
    }

    if (!imported.length) {
      return res.status(415).json({ ok: false, error: failed[0]?.message || "No uploaded files could be saved.", failed });
    }

    runMediaScan(adultLibraryIdFromProfileLibrary(targetLibrary));

    res.json({
      ok: true,
      importedAs: importType,
      imported,
      importedCount: imported.length,
      failed,
      failedCount: failed.length,
      destination: imported[0]?.destination || "",
      relativeDestination: imported[0]?.relativeDestination || "",
      record: imported[0] || null,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
      targetLibrary,
      profileName,
      profileId: path.basename(profileDir),
      message: `Uploaded ${imported.length} file${imported.length === 1 ? "" : "s"} to ${imported[0]?.destinationType ? `/${imported[0].destinationType}` : "this profile"}${failed.length ? `; ${failed.length} failed.` : "."}`,
    });
  } catch (error) {
    console.error("Adult upload import failed:", error);
    res.status(error.status || 500).json({ ok: false, error: error.message || "Adult upload import failed" });
  }
});





const EPORNER_API_BASE = "https://www.eporner.com/api/v2/video";

function normalizeEpornerString(value = "") {
  return String(value || "").trim();
}

function normalizeEpornerThumb(thumb) {
  if (!thumb) return "";
  if (typeof thumb === "string") return thumb;
  return thumb.src || thumb.url || "";
}

function normalizeEpornerKeywords(value = "") {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[,|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeEpornerVideoToAdultScene(video = {}) {
  const id = normalizeEpornerString(video.id);
  const thumbs = Array.isArray(video.thumbs)
    ? video.thumbs.map(normalizeEpornerThumb).filter(Boolean)
    : [];
  const defaultThumb = normalizeEpornerThumb(video.default_thumb) || thumbs[0] || "";
  const url = normalizeEpornerString(video.url);
  return {
    id: id ? `eporner-${id}` : `eporner-${slugifyAdultImportSegment(video.title || url || Date.now())}`,
    providerId: id,
    title: normalizeEpornerString(video.title) || "Eporner Scene",
    studio: "Eporner",
    provider: "eporner",
    source: "Eporner",
    sourceName: "Eporner",
    sourceUrl: url,
    url,
    embed: normalizeEpornerString(video.embed),
    thumb: defaultThumb,
    thumbnail: defaultThumb,
    thumbs,
    keywords: normalizeEpornerKeywords(video.keywords),
    added: normalizeEpornerString(video.added),
    duration: normalizeEpornerString(video.length_min),
    length: normalizeEpornerString(video.length_min),
    lengthSec: Number(video.length_sec) || 0,
    views: Number(video.views) || 0,
    rating: normalizeEpornerString(video.rate),
    fetchedAt: new Date().toISOString(),
  };
}

function mergeAdultSceneRecords(existingScenes = [], nextScenes = []) {
  const merged = [];
  const seen = new Set();
  const add = (scene) => {
    if (!scene) return;
    const key = String(scene.providerId || scene.id || scene.url || scene.sourceUrl || scene.title || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(scene);
  };
  nextScenes.forEach(add);
  existingScenes.forEach(add);
  return merged.slice(0, 250);
}

function normalizeAdultProviderSceneKey(scene = {}, fallback = "") {
  return String(
    scene.providerId ||
    scene.id ||
    scene.url ||
    scene.sourceUrl ||
    scene.path ||
    scene.title ||
    fallback ||
    ""
  ).toLowerCase().trim();
}

function normalizeAdultExcludedTags(value = []) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]+/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function adultSceneMatchesExcludedTags(scene = {}, excludedTags = []) {
  const tags = normalizeAdultExcludedTags(excludedTags);
  if (!tags.length) return false;
  const haystack = [scene.title, scene.keywords, scene.tags, scene.description]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tags.some((tag) => haystack.includes(tag));
}

function normalizeAdultSceneDedupeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(official|full|video|scene|hd|4k|1080p|720p|porn|sex|xxx|fucks?|fucked|fucking|gets?|got|with|and|the|for|her|his|my|your|teen|babe|girl|hot|sexy|amateur|pov|cum|cock|pussy|deep|style|doggy|doggystyle|compilation|part|clip|preview|trailer)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAdultSceneDedupeQuery(value = "") {
  return normalizeAdultSceneDedupeText(value)
    .split(" ")
    .filter(Boolean)
    .join("-");
}

function adultSceneDuplicateGroupKey(scene = {}, query = "") {
  const provider = String(scene.provider || scene.source || scene.sourceName || "").toLowerCase();
  const providerId = String(scene.providerId || scene.id || "").toLowerCase();
  if (!provider.includes("eporner") && !String(scene.url || scene.sourceUrl || "").includes("eporner.com")) {
    return normalizeAdultProviderSceneKey(scene);
  }

  const lengthSec = Number(scene.lengthSec || scene.length_sec || 0) || 0;
  const normalizedQuery = normalizeAdultSceneDedupeQuery(query);
  const normalizedTitle = normalizeAdultSceneDedupeText(scene.title || "");
  const queryWords = new Set(normalizeAdultSceneDedupeText(query).split(" ").filter(Boolean));
  const titleWords = normalizedTitle
    .split(" ")
    .filter(Boolean)
    .filter((word) => !queryWords.has(word))
    .filter((word) => word.length > 2)
    .slice(0, 5);

  // Adult tube providers often expose many 2-10 minute snippets from the same source scene.
  // When the same performer query and exact short duration repeat, treat them as a review group
  // so Homestead saves one representative by default instead of many near-identical snippets.
  if (normalizedQuery && lengthSec > 0 && lengthSec <= 900) {
    return `eporner-snippet-${normalizedQuery}-${lengthSec}`;
  }

  if (normalizedQuery && lengthSec > 0 && titleWords.length >= 2) {
    return `eporner-scene-${normalizedQuery}-${lengthSec}-${titleWords.slice(0, 3).join("-")}`;
  }

  if (providerId) return `eporner-id-${providerId}`;
  return normalizeAdultProviderSceneKey(scene);
}

function annotateAdultSceneDuplicateGroups(scenes = [], query = "") {
  const list = (Array.isArray(scenes) ? scenes : []).filter(Boolean);
  const groups = new Map();
  list.forEach((scene, index) => {
    const groupKey = adultSceneDuplicateGroupKey(scene, query) || normalizeAdultProviderSceneKey(scene, index);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ scene, index });
  });

  const groupCounts = new Map(Array.from(groups.entries()).map(([key, entries]) => [key, entries.length]));
  const groupBest = new Map();
  groups.forEach((entries, key) => {
    const ranked = [...entries].sort((a, b) => {
      const aRating = Number(a.scene.rating || a.scene.rate || 0) || 0;
      const bRating = Number(b.scene.rating || b.scene.rate || 0) || 0;
      const aViews = Number(a.scene.views || 0) || 0;
      const bViews = Number(b.scene.views || 0) || 0;
      const aThumbs = Array.isArray(a.scene.thumbs) ? a.scene.thumbs.length : 0;
      const bThumbs = Array.isArray(b.scene.thumbs) ? b.scene.thumbs.length : 0;
      return (bRating - aRating) || (bViews - aViews) || (bThumbs - aThumbs) || (a.index - b.index);
    });
    groupBest.set(key, ranked[0]?.index ?? entries[0]?.index);
  });

  return list.map((scene, index) => {
    const groupKey = adultSceneDuplicateGroupKey(scene, query) || normalizeAdultProviderSceneKey(scene, index);
    const count = groupCounts.get(groupKey) || 1;
    const bestIndex = groupBest.get(groupKey);
    const isDuplicate = count > 1 && index !== bestIndex;
    return {
      ...scene,
      duplicateGroupKey: groupKey,
      duplicateGroupCount: count,
      duplicateRank: isDuplicate ? 2 : 1,
      isLikelyDuplicateSnippet: Boolean(isDuplicate),
      duplicateReason: count > 1
        ? `Likely same-source snippet group: ${scene.duration || scene.length || (scene.lengthSec ? `${Math.round(scene.lengthSec / 60)} min` : "same duration")} Ã‚Â· ${count} results`
        : "",
    };
  });
}

function filterAdultScenesForSave(scenes = [], excludedTags = []) {
  const seen = new Set();
  const seenGroups = new Set();
  return (Array.isArray(scenes) ? scenes : [])
    .filter((scene) => scene && !adultSceneMatchesExcludedTags(scene, excludedTags))
    .filter((scene, index) => {
      const groupKey = String(scene.duplicateGroupKey || "").toLowerCase().trim();
      if (groupKey && seenGroups.has(groupKey)) return false;
      if (groupKey) seenGroups.add(groupKey);
      const key = normalizeAdultProviderSceneKey(scene, index);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchEpornerSearchResults({ query, perPage = 24, page = 1, order = "latest", thumbsize = "big" }) {
  const cleanQuery = normalizeEpornerString(query) || "all";
  const params = new URLSearchParams({
    query: cleanQuery,
    per_page: String(Math.max(1, Math.min(Number(perPage) || 24, 100))),
    page: String(Math.max(1, Number(page) || 1)),
    thumbsize: ["small", "medium", "big"].includes(String(thumbsize)) ? String(thumbsize) : "big",
    order: ["latest", "longest", "shortest", "top-rated", "most-popular", "top-weekly", "top-monthly"].includes(String(order)) ? String(order) : "latest",
    gay: "1",
    lq: "1",
    format: "json",
  });
  const response = await fetch(`${EPORNER_API_BASE}/search/?${params.toString()}`, {
    headers: {
      "User-Agent": "Homestead/1.0 EpornerProvider (+user-initiated)",
      Accept: "application/json,*/*",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Eporner returned ${response.status}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Eporner did not return valid JSON.");
  }
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  return {
    ok: true,
    query: cleanQuery,
    count: Number(data?.count) || videos.length,
    totalCount: Number(data?.total_count) || videos.length,
    totalPages: Number(data?.total_pages) || 1,
    page: Number(data?.page) || Number(page) || 1,
    perPage: Number(data?.per_page) || Number(perPage) || 24,
    scenes: annotateAdultSceneDuplicateGroups(videos.map(normalizeEpornerVideoToAdultScene), cleanQuery),
    raw: data,
  };
}

async function fetchEpornerVideoById(id, thumbsize = "big") {
  const cleanId = normalizeEpornerString(id);
  if (!cleanId) throw new Error("Missing Eporner video id.");
  const params = new URLSearchParams({
    id: cleanId,
    thumbsize: ["small", "medium", "big"].includes(String(thumbsize)) ? String(thumbsize) : "big",
    format: "json",
  });
  const response = await fetch(`${EPORNER_API_BASE}/id/?${params.toString()}`, {
    headers: {
      "User-Agent": "Homestead/1.0 EpornerProvider (+user-initiated)",
      Accept: "application/json,*/*",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Eporner returned ${response.status}`);
  const data = await response.json();
  if (Array.isArray(data) && !data.length) return null;
  if (!data || (Array.isArray(data) && !data[0])) return null;
  return normalizeEpornerVideoToAdultScene(Array.isArray(data) ? data[0] : data);
}

function appendEpornerScenesToAdultProfile({ targetLibrary = "performers", profileName = "", profileId = "", scenes = [], query = "", excludeTags = [] }) {
  const profileDir = findAdultProfileDir({ libraryType: targetLibrary, profileId, profileName });
  if (!profileDir) return null;
  const metadataPath = path.join(profileDir, "metadata.json");
  const existing = readJsonIfExists(metadataPath, { metadata: {} });
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
  const candidates = metadata.metadataCandidates && typeof metadata.metadataCandidates === "object" ? metadata.metadataCandidates : {};
  const existingScenes = Array.isArray(candidates.scenes) ? candidates.scenes : (Array.isArray(metadata.scenes) ? metadata.scenes : []);
  const cleanScenes = filterAdultScenesForSave(scenes, excludeTags);
  const mergedScenes = mergeAdultSceneRecords(existingScenes, cleanScenes);
  const now = new Date().toISOString();
  const providerRecord = {
    provider: "eporner",
    sourceName: "Eporner",
    query,
    fetchedAt: now,
    count: cleanScenes.length,
  };
  const nextMetadata = {
    ...metadata,
    metadataCandidates: {
      ...candidates,
      scenes: mergedScenes,
    },
    scenes: mergedScenes,
    adultSceneProviders: [providerRecord, ...(Array.isArray(metadata.adultSceneProviders) ? metadata.adultSceneProviders : [])].slice(0, 50),
    updatedAt: now,
  };
  const next = {
    ...(existing.metadata ? existing : { metadata }),
    metadata: nextMetadata,
    updatedAt: now,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));
  return { profileDir, metadataPath, scenes: mergedScenes, savedScenes: cleanScenes, savedCount: cleanScenes.length, totalScenes: mergedScenes.length };
}

app.post("/api/adult/providers/eporner/search", async (req, res) => {
  try {
    const targetLibrary = String(req.body?.targetLibrary || req.body?.libraryType || "performers").trim();
    const profileName = String(req.body?.profileName || req.body?.person?.name || req.body?.person?.title || "").trim();
    const profileId = String(req.body?.profileId || req.body?.person?.id || "").trim();
    const query = String(req.body?.query || profileName || "").trim();
    const saveToProfile = req.body?.saveToProfile !== false;
    const excludeTags = normalizeAdultExcludedTags(req.body?.excludeTags || req.body?.excludedTags || []);

    if (!query) {
      return res.status(400).json({ ok: false, message: "Missing Eporner search query." });
    }

    const result = await fetchEpornerSearchResults({
      query,
      perPage: req.body?.perPage || req.body?.per_page || 24,
      page: req.body?.page || 1,
      order: req.body?.order || "latest",
      thumbsize: req.body?.thumbsize || "big",
    });

    const filteredScenes = filterAdultScenesForSave(result.scenes, excludeTags);

    let saved = null;
    if (saveToProfile && profileName) {
      saved = appendEpornerScenesToAdultProfile({
        targetLibrary,
        profileName,
        profileId,
        scenes: filteredScenes,
        query,
        excludeTags,
      });
      if (saved) runMediaScan();
    }

    res.json({
      ok: true,
      provider: "eporner",
      targetLibrary,
      profileName,
      profileId,
      query: result.query,
      page: result.page,
      perPage: result.perPage,
      count: result.count,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
      scenes: filteredScenes,
      filteredOutCount: Math.max(0, result.scenes.length - filteredScenes.length),
      excludedTags: excludeTags,
      saved,
      scanRequested: Boolean(saved),
      scanLibrary: saved ? adultLibraryIdFromProfileLibrary(targetLibrary) : null,
      message: saved
        ? `Fetched ${filteredScenes.length} Eporner scene reference${filteredScenes.length === 1 ? "" : "s"} and saved ${saved.totalScenes} total scene reference${saved.totalScenes === 1 ? "" : "s"}.`
        : `Fetched ${filteredScenes.length} Eporner scene reference${filteredScenes.length === 1 ? "" : "s"}${excludeTags.length ? ` after excluding: ${excludeTags.join(", ")}` : ""}.`,
    });
  } catch (error) {
    console.error("Eporner provider search failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Eporner provider search failed." });
  }
});

app.post("/api/adult/providers/eporner/save-selected", async (req, res) => {
  try {
    const targetLibrary = String(req.body?.targetLibrary || req.body?.libraryType || "performers").trim();
    const profileName = String(req.body?.profileName || req.body?.person?.name || req.body?.person?.title || "").trim();
    const profileId = String(req.body?.profileId || req.body?.person?.id || "").trim();
    const query = String(req.body?.query || profileName || "").trim();
    const excludeTags = normalizeAdultExcludedTags(req.body?.excludeTags || req.body?.excludedTags || []);
    const scenes = filterAdultScenesForSave(req.body?.scenes || [], excludeTags);

    if (!profileName && !profileId) {
      return res.status(400).json({ ok: false, message: "Missing profile name or profile id." });
    }
    if (!scenes.length) {
      return res.status(400).json({ ok: false, message: "No selected scenes to save after filtering." });
    }

    const saved = appendEpornerScenesToAdultProfile({
      targetLibrary,
      profileName,
      profileId,
      scenes,
      query,
      excludeTags,
    });

    if (!saved) {
      return res.status(404).json({ ok: false, message: "Adult profile was not found." });
    }

    runMediaScan();

    res.json({
      ok: true,
      provider: "eporner",
      targetLibrary,
      profileName,
      profileId,
      query,
      saved,
      savedScenes: saved.savedScenes || scenes,
      excludedTags: excludeTags,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
      message: `Saved ${saved.savedCount} selected Eporner scene reference${saved.savedCount === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    console.error("Eporner save-selected failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Saving selected Eporner scenes failed." });
  }
});

app.post("/api/adult/providers/scene/remove", async (req, res) => {
  try {
    const targetLibrary = String(req.body?.targetLibrary || req.body?.libraryType || "performers").trim();
    const profileName = String(req.body?.profileName || "").trim();
    const profileId = String(req.body?.profileId || "").trim();
    const scene = req.body?.scene || {};
    const removeKey = normalizeAdultProviderSceneKey(scene, req.body?.sceneKey || "");

    if (!profileName && !profileId) {
      return res.status(400).json({ ok: false, message: "Missing profile name or profile id." });
    }
    if (!removeKey) {
      return res.status(400).json({ ok: false, message: "Missing scene key to remove." });
    }

    const profileDir = findAdultProfileDir({ libraryType: targetLibrary, profileId, profileName });
    if (!profileDir) {
      return res.status(404).json({ ok: false, message: "Adult profile was not found." });
    }

    const metadataPath = path.join(profileDir, "metadata.json");
    const existing = readJsonIfExists(metadataPath, { metadata: {} });
    const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
    const candidates = metadata.metadataCandidates && typeof metadata.metadataCandidates === "object" ? metadata.metadataCandidates : {};
    const existingScenes = Array.isArray(candidates.scenes) ? candidates.scenes : (Array.isArray(metadata.scenes) ? metadata.scenes : []);
    const nextScenes = existingScenes.filter((item, index) => normalizeAdultProviderSceneKey(item, index) !== removeKey);
    const now = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      metadataCandidates: {
        ...candidates,
        scenes: nextScenes,
      },
      scenes: nextScenes,
      updatedAt: now,
    };
    const next = {
      ...(existing.metadata ? existing : { metadata }),
      ...(["poster", "banner", "headshot"].includes(action) ? { [action]: relativeDestination } : {}),
      metadata: nextMetadata,
      updatedAt: now,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));
    runMediaScan();

    res.json({
      ok: true,
      targetLibrary,
      profileName,
      profileId,
      removedKey: removeKey,
      scenes: nextScenes,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
      message: `Removed scene reference. ${nextScenes.length} saved scene reference${nextScenes.length === 1 ? "" : "s"} remain.`,
    });
  } catch (error) {
    console.error("Adult scene remove failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Removing scene reference failed." });
  }
});

app.get("/api/adult/providers/eporner/id/:id", async (req, res) => {
  try {
    const scene = await fetchEpornerVideoById(req.params.id, req.query.thumbsize || "big");
    res.json({ ok: true, provider: "eporner", scene });
  } catch (error) {
    console.error("Eporner provider id fetch failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Eporner provider id fetch failed." });
  }
});

app.post("/api/adult/media/set-artwork", async (req, res) => {
  try {
    const action = String(req.body?.action || "poster").toLowerCase().trim();
    const mediaPath = String(req.body?.mediaPath || "").trim();
    const targetLibrary = String(req.body?.targetLibrary || "performers").trim();
    const profileName = String(req.body?.profileName || "").trim();
    const profileId = String(req.body?.profileId || "").trim();
    const croppedImageData = String(req.body?.croppedImageData || "").trim();
    const crop = req.body?.crop && typeof req.body.crop === "object" ? req.body.crop : null;
    const supportedActions = new Set(["poster", "banner", "headshot", "breasts", "pussy", "ass"]);
    const anatomyActions = new Set(["breasts", "pussy", "ass"]);

    if (!supportedActions.has(action)) {
      return res.status(400).json({ ok: false, message: "Unsupported artwork action." });
    }
    if (!mediaPath) {
      return res.status(400).json({ ok: false, message: "Missing selected media path." });
    }

    const profileDir = findAdultProfileDir({
      libraryType: targetLibrary,
      profileId,
      profileName,
    });

    if (!profileDir) {
      return res.status(404).json({ ok: false, message: "Could not find the adult profile folder." });
    }

    const resolvedProfileDir = path.resolve(profileDir);
    const resolvedMediaPath = path.resolve(mediaPath);

    if (!fs.existsSync(resolvedMediaPath)) {
      return res.status(404).json({ ok: false, message: "Selected media file does not exist on disk." });
    }
    if (!resolvedMediaPath.startsWith(resolvedProfileDir + path.sep)) {
      return res.status(400).json({ ok: false, message: "Selected media must be inside this profile folder." });
    }

    const ext = path.extname(resolvedMediaPath).toLowerCase();
    const isImage = ADULT_IMPORT_IMAGE_EXTS.has(ext);
    const isVideo = ADULT_IMPORT_VIDEO_EXTS.has(ext);
    if (action === "banner" ? (!isImage && !isVideo) : !isImage) {
      return res.status(400).json({
        ok: false,
        message: action === "banner"
          ? "Banner artwork must be an image or video file."
          : "Poster, headshot, and anatomy artwork must be image files.",
      });
    }

    let croppedBuffer = null;
    let outputExt = ext;
    let croppedMimeType = "";
    if (croppedImageData) {
      if (!isImage) {
        return res.status(400).json({ ok: false, message: "Only image artwork can be cropped." });
      }
      const match = croppedImageData.match(/^data:image\/(jpeg|jpg|png|webp);base64,([\s\S]+)$/i);
      if (!match) {
        return res.status(400).json({ ok: false, message: "The cropped artwork data is not a supported image." });
      }
      croppedMimeType = String(match[1] || "jpeg").toLowerCase();
      outputExt = croppedMimeType === "png" ? ".png" : croppedMimeType === "webp" ? ".webp" : ".jpg";
      croppedBuffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
      if (!croppedBuffer.length || croppedBuffer.length > 30 * 1024 * 1024) {
        return res.status(400).json({ ok: false, message: "The cropped artwork is empty or too large." });
      }
    }

    const destination = path.join(resolvedProfileDir, `${action}${outputExt}`);

    // Keep one canonical root-level file per artwork slot. This prevents an old
    // banner.jpg from winning over a newer banner.mp4 after the selection changes.
    const replaceableExtensions = new Set([...ADULT_IMPORT_IMAGE_EXTS, ...ADULT_IMPORT_VIDEO_EXTS]);
    for (const candidateExt of replaceableExtensions) {
      const candidate = path.join(resolvedProfileDir, `${action}${candidateExt}`);
      if (candidate !== destination && fs.existsSync(candidate)) {
        try { fs.unlinkSync(candidate); } catch {}
      }
    }
    if (croppedBuffer) {
      fs.writeFileSync(destination, croppedBuffer);
    } else if (resolvedMediaPath !== destination) {
      fs.copyFileSync(resolvedMediaPath, destination);
    }

    for (const candidateExt of [".png", ".webp", ".jpg", ".jpeg"]) {
      const staleCutout = path.join(resolvedProfileDir, `${action}-cutout${candidateExt}`);
      if (fs.existsSync(staleCutout)) {
        try { fs.unlinkSync(staleCutout); } catch {}
      }
    }

    const metadataPath = path.join(resolvedProfileDir, "metadata.json");
    const existing = readJsonIfExists(metadataPath, { metadata: {} });
    const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
    const relativeDestination = path.relative(resolvedProfileDir, destination).split(path.sep).join("/");
    const now = new Date().toISOString();
    const artworkRecord = {
      action,
      sourcePath: resolvedMediaPath,
      relativeDestination,
      mediaType: isVideo && !croppedBuffer ? "video" : "image",
      cropApplied: Boolean(croppedBuffer),
      ...(crop ? { crop } : {}),
      ...(croppedMimeType ? { croppedMimeType } : {}),
      updatedAt: now,
    };
    const nextMetadata = {
      ...metadata,
      folderPath: metadata.folderPath || resolvedProfileDir,
      [action]: relativeDestination,
      [`${action}Cutout`]: "",
      ...(anatomyActions.has(action)
        ? {
            anatomyArtwork: {
              ...(metadata.anatomyArtwork && typeof metadata.anatomyArtwork === "object" ? metadata.anatomyArtwork : {}),
              [action]: relativeDestination,
              [`${action}Cutout`]: "",
            },
          }
        : {}),
      artworkPreferences: {
        ...(metadata.artworkPreferences && typeof metadata.artworkPreferences === "object" ? metadata.artworkPreferences : {}),
        useCutouts: {
          ...((metadata.artworkPreferences && metadata.artworkPreferences.useCutouts && typeof metadata.artworkPreferences.useCutouts === "object") ? metadata.artworkPreferences.useCutouts : {}),
          [action]: false,
        },
      },
      artworkUpdatedAt: now,
      artworkHistory: [artworkRecord, ...(Array.isArray(metadata.artworkHistory) ? metadata.artworkHistory : [])].slice(0, 100),
      updatedAt: now,
    };
    const next = {
      ...(existing.metadata ? existing : { metadata }),
      metadata: nextMetadata,
      updatedAt: now,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));

    runMediaScan();

    const actionLabels = {
      poster: "Poster",
      banner: "Banner",
      headshot: "Headshot",
      breasts: "Breasts detail",
      pussy: "Pussy detail",
      ass: "Ass detail",
    };

    res.json({
      ok: true,
      action,
      targetLibrary,
      profileName: profileName || path.basename(resolvedProfileDir).replace(/[-_]+/g, " "),
      profileId: path.basename(resolvedProfileDir),
      destination,
      relativeDestination,
      publicPath: destination,
      mediaType: isVideo && !croppedBuffer ? "video" : "image",
      cropped: Boolean(croppedBuffer),
      crop: crop || null,
      metadata: nextMetadata,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
      message: `${actionLabels[action] || "Artwork"} ${croppedBuffer ? "cropped and saved" : "updated from selected media and copied"} to the profile root.`,
    });
  } catch (error) {
    console.error("Adult set artwork failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Could not update artwork." });
  }
});


app.post("/api/adult/media/remove-artwork-background", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const action = String(req.body?.action || "poster").toLowerCase().trim();
    const mediaPath = String(req.body?.mediaPath || "").trim();
    const targetLibrary = String(req.body?.targetLibrary || "performers").trim();
    const profileName = String(req.body?.profileName || "").trim();
    const profileId = String(req.body?.profileId || "").trim();
    const supportedActions = new Set(["poster", "headshot", "breasts", "pussy", "ass"]);
    const anatomyActions = new Set(["breasts", "pussy", "ass"]);

    if (!supportedActions.has(action)) {
      return res.status(400).json({ ok: false, message: "Unsupported artwork action." });
    }

    const profileDir = findAdultProfileDir({
      libraryType: targetLibrary,
      profileId,
      profileName,
    });

    if (!profileDir) {
      return res.status(404).json({ ok: false, message: "Could not find the adult profile folder." });
    }

    const resolvedProfileDir = path.resolve(profileDir);
    const metadataPath = path.join(resolvedProfileDir, "metadata.json");
    const existing = readJsonIfExists(metadataPath, { metadata: {} });
    const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : existing;
    const anatomyArtwork = metadata.anatomyArtwork && typeof metadata.anatomyArtwork === "object" ? metadata.anatomyArtwork : {};

    const preferredStored = action === "poster"
      ? metadata.poster
      : action === "headshot"
        ? metadata.headshot
        : anatomyArtwork[action] || metadata[action];

    const resolvedMediaPath = path.resolve(
      mediaPath
      || (preferredStored
          ? (path.isAbsolute(preferredStored)
              ? preferredStored
              : path.join(resolvedProfileDir, String(preferredStored).replace(/^[/\\]+/, "")))
          : path.join(resolvedProfileDir, `${action}.jpg`))
    );

    if (!fs.existsSync(resolvedMediaPath)) {
      return res.status(404).json({ ok: false, message: "Could not find the current artwork image on disk." });
    }
    if (!resolvedMediaPath.startsWith(resolvedProfileDir + path.sep)) {
      return res.status(400).json({ ok: false, message: "Artwork must be inside this profile folder." });
    }

    const ext = path.extname(resolvedMediaPath).toLowerCase();
    if (!ADULT_IMPORT_IMAGE_EXTS.has(ext)) {
      return res.status(400).json({ ok: false, message: "Background removal is only supported for image artwork." });
    }

    const cutoutName = `${action}-cutout.png`;
    const cutoutPath = path.join(resolvedProfileDir, cutoutName);
    const engineInfo = await createPantyBackgroundCutout(
      resolvedMediaPath,
      cutoutPath,
      req.body?.sensitivity
    );

    const now = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      folderPath: metadata.folderPath || resolvedProfileDir,
      [`${action}Cutout`]: cutoutName,
      ...(anatomyActions.has(action)
        ? {
            anatomyArtwork: {
              ...anatomyArtwork,
              [action]: anatomyArtwork[action] || metadata[action] || path.relative(resolvedProfileDir, resolvedMediaPath).split(path.sep).join("/"),
              [`${action}Cutout`]: cutoutName,
            },
          }
        : {}),
      artworkPreferences: {
        ...(metadata.artworkPreferences && typeof metadata.artworkPreferences === "object" ? metadata.artworkPreferences : {}),
        useCutouts: {
          ...((metadata.artworkPreferences && metadata.artworkPreferences.useCutouts && typeof metadata.artworkPreferences.useCutouts === "object") ? metadata.artworkPreferences.useCutouts : {}),
          [action]: true,
        },
      },
      artworkUpdatedAt: now,
      artworkHistory: [{
        action: `${action}-cutout`,
        sourcePath: resolvedMediaPath,
        relativeDestination: cutoutName,
        mediaType: "image",
        cutoutApplied: true,
        updatedAt: now,
      }, ...(Array.isArray(metadata.artworkHistory) ? metadata.artworkHistory : [])].slice(0, 100),
      updatedAt: now,
    };
    const next = {
      ...(existing.metadata ? existing : { metadata }),
      metadata: nextMetadata,
      updatedAt: now,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2));

    runMediaScan();

    const actionLabels = {
      poster: "Poster",
      headshot: "Headshot",
      breasts: "Breasts detail",
      pussy: "Pussy detail",
      ass: "Ass detail",
    };

    res.json({
      ok: true,
      action,
      targetLibrary,
      profileName: profileName || path.basename(resolvedProfileDir).replace(/[-_]+/g, " "),
      profileId: path.basename(resolvedProfileDir),
      sourcePath: resolvedMediaPath,
      destination: cutoutPath,
      relativeDestination: cutoutName,
      publicPath: cutoutPath,
      metadata: nextMetadata,
      engine: engineInfo,
      scanRequested: true,
      scanLibrary: adultLibraryIdFromProfileLibrary(targetLibrary),
      message: `${actionLabels[action] || "Artwork"} background removed and saved as a cutout.`,
    });
  } catch (error) {
    console.error("Adult artwork background removal failed:", error);
    res.status(500).json({ ok: false, message: error.message || "Could not remove the background from the selected artwork." });
  }
});



const SHARED_MEDIA_ASSET_SLOTS = {
  gridPoster: { baseName: "poster", kinds: ["image"] },
  detailPoster: { baseName: "detail-poster", kinds: ["image"] },
  banner: { baseName: "banner", kinds: ["image", "video"] },
  logo: { baseName: "logo", kinds: ["image"] },
  trailer: { baseName: "trailer", kinds: ["video"] },
  theme: { baseName: "theme", kinds: ["audio"] },
  thumbnail: { baseName: "thumbnail", kinds: ["image"] },
  seasonPoster: { baseName: "season-poster", kinds: ["image"] },
  episodeThumbnail: { baseName: "episode-thumbnail", kinds: ["image"] },
  authorImage: { baseName: "author", kinds: ["image"] },
  albumCover: { baseName: "cover", kinds: ["image"] },
};

const SHARED_MEDIA_LIBRARY_SLOTS = {
  movies: new Set(["gridPoster", "detailPoster", "banner", "logo", "trailer", "theme", "thumbnail"]),
  tv: new Set(["gridPoster", "detailPoster", "banner", "logo", "trailer", "theme", "seasonPoster", "episodeThumbnail", "thumbnail"]),
  music: new Set(["gridPoster", "detailPoster", "banner", "logo", "theme", "albumCover", "thumbnail"]),
  books: new Set(["gridPoster", "detailPoster", "banner", "authorImage", "theme", "thumbnail"]),
  youtube: new Set(["gridPoster", "detailPoster", "banner", "logo", "thumbnail"]),
};

function sharedMediaAssetKind(filename = "", mimeType = "") {
  const ext = path.extname(String(filename || "")).toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext) || mime.startsWith("image/")) return "image";
  if ([".mp4", ".m4v", ".mov", ".webm", ".mkv"].includes(ext) || mime.startsWith("video/")) return "video";
  if ([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"].includes(ext) || mime.startsWith("audio/")) return "audio";
  return "";
}

function resolveSharedMediaAssetTarget(targetPath = "") {
  const mediaRoot = path.resolve(process.env.MEDIA_ROOT || "/media");
  const requested = path.resolve(String(targetPath || "").replace(/^file:\/\//i, ""));
  if (!requested || requested === path.parse(requested).root) {
    const error = new Error("A valid media item folder or file path is required.");
    error.status = 400;
    throw error;
  }
  if (requested !== mediaRoot && !requested.startsWith(mediaRoot + path.sep)) {
    const error = new Error("The selected media item must be inside the configured media root.");
    error.status = 400;
    throw error;
  }
  if (fs.existsSync(requested) && fs.statSync(requested).isDirectory()) return requested;
  return path.dirname(requested);
}

app.post("/api/media/set-asset", express.raw({ type: "multipart/form-data", limit: "512mb" }), async (req, res) => {
  try {
    const contentType = String(req.headers["content-type"] || "");
    const boundary = contentType.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i)?.[1]
      || contentType.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i)?.[2];
    if (!boundary) return res.status(400).json({ ok: false, message: "Upload must use multipart/form-data." });

    const { fields, files } = parseMultipartFormDataBuffer(req.body, boundary);
    const library = String(fields.library || "movies").toLowerCase().trim();
    const slot = String(fields.slot || "gridPoster").trim();
    const targetPath = String(fields.targetPath || "").trim();
    const file = files.find((entry) => entry.fieldName === "file") || files[0];

    if (!SHARED_MEDIA_LIBRARY_SLOTS[library]?.has(slot)) {
      return res.status(400).json({ ok: false, message: `The ${slot} asset is not supported for ${library}.` });
    }
    if (!file?.data?.length) {
      return res.status(400).json({ ok: false, message: "Choose a file to save as media artwork." });
    }

    const definition = SHARED_MEDIA_ASSET_SLOTS[slot];
    const kind = sharedMediaAssetKind(file.filename, file.contentType);
    if (!kind || !definition.kinds.includes(kind)) {
      return res.status(400).json({ ok: false, message: `This slot accepts ${definition.kinds.join(" or ")} files.` });
    }

    const targetDir = resolveSharedMediaAssetTarget(targetPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const sourceExt = path.extname(file.filename || "").toLowerCase();
    const fallbackExt = kind === "image" ? ".jpg" : kind === "video" ? ".mp4" : ".mp3";
    const outputExt = sourceExt || fallbackExt;
    const destination = path.join(targetDir, `${definition.baseName}${outputExt}`);

    const replaceKinds = kind === "image"
      ? [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
      : kind === "video"
        ? [".mp4", ".m4v", ".mov", ".webm", ".mkv"]
        : [".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus"];
    for (const ext of replaceKinds) {
      const candidate = path.join(targetDir, `${definition.baseName}${ext}`);
      if (candidate !== destination && fs.existsSync(candidate)) {
        try { fs.unlinkSync(candidate); } catch {}
      }
    }

    fs.writeFileSync(destination, file.data);
    runMediaScan();

    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      library,
      slot,
      destination,
      relativeName: path.basename(destination),
      publicUrl: `/api/file?path=${encodeURIComponent(destination)}`,
      scanRequested: true,
      message: `${slot} saved as ${path.basename(destination)}. Library scan queued.`,
    });
  } catch (error) {
    console.error("Shared media asset save failed:", error);
    res.status(error.status || 500).json({ ok: false, message: error.message || "Could not save media artwork." });
  }
});












// Shared mixed-media custom collections.
const customCollectionsDir = path.join(dataDir, "collections", "custom");

function sanitizeCustomCollectionId(value = "") {
  return String(value || "collection")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "collection";
}

function getCustomCollectionPath(collectionId = "") {
  fs.mkdirSync(customCollectionsDir, { recursive: true });
  const safeId = sanitizeCustomCollectionId(collectionId);
  const filePath = path.join(customCollectionsDir, `${safeId}.json`);
  if (!filePath.startsWith(customCollectionsDir)) throw new Error("Invalid custom collection path.");
  return { safeId, filePath };
}

function normalizeCustomCollectionItem(item = {}, index = 0) {
  const library = item.library === "tv" ? "tv" : "movies";
  const sourceId = String(item.sourceId || item.id || item.localId || "").trim();
  const title = String(item.title || item.name || "").trim();
  if (!sourceId && !title) return null;
  return {
    library,
    sourceId,
    title,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
  };
}

function normalizeCustomCollectionPayload(payload = {}, existing = null) {
  const name = String(payload.name || existing?.name || "Untitled Collection").trim() || "Untitled Collection";
  const id = sanitizeCustomCollectionId(payload.id || existing?.id || name);
  const items = (Array.isArray(payload.items) ? payload.items : existing?.items || [])
    .map(normalizeCustomCollectionItem)
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));
  return {
    id,
    name,
    description: String(payload.description ?? existing?.description ?? "").trim(),
    poster: String(payload.poster ?? existing?.poster ?? "").trim(),
    banner: String(payload.banner ?? existing?.banner ?? "").trim(),
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : (existing?.tags || []),
    source: "custom",
    sortMode: "manual",
    items,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function readAllCustomCollections() {
  fs.mkdirSync(customCollectionsDir, { recursive: true });
  return fs.readdirSync(customCollectionsDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => readJsonFile(path.join(customCollectionsDir, name), null))
    .filter(Boolean)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

app.get("/api/collections/custom", (req, res) => {
  try {
    res.json({ ok: true, collections: readAllCustomCollections(), storagePath: customCollectionsDir });
  } catch (error) {
    console.error("Failed to read custom collections:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to read custom collections." });
  }
});

app.post("/api/collections/custom", (req, res) => {
  try {
    const incomingId = sanitizeCustomCollectionId(req.body?.id || req.body?.name || "collection");
    const { filePath } = getCustomCollectionPath(incomingId);
    const existing = fs.existsSync(filePath) ? readJsonFile(filePath, null) : null;
    const collection = normalizeCustomCollectionPayload(req.body || {}, existing);
    const resolved = getCustomCollectionPath(collection.id);
    writeJsonFile(resolved.filePath, collection);
    if (filePath !== resolved.filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, collection, storagePath: resolved.filePath, message: `Saved ${collection.name}.` });
  } catch (error) {
    console.error("Failed to save custom collection:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to save custom collection." });
  }
});

app.delete("/api/collections/custom/:collectionId", (req, res) => {
  try {
    const { filePath, safeId } = getCustomCollectionPath(req.params.collectionId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, id: safeId, message: "Custom collection deleted." });
  } catch (error) {
    console.error("Failed to delete custom collection:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to delete custom collection." });
  }
});


// Manual ordering for generated metadata/smart collections.
// Membership remains automatic; only the user's preferred ordering is persisted.
const collectionOrderOverridesDir = path.join(dataDir, "collections", "order-overrides");

function sanitizeCollectionOrderOverrideId(value = "") {
  return String(value || "collection")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "collection";
}

function getCollectionOrderOverridePath(collectionId = "") {
  fs.mkdirSync(collectionOrderOverridesDir, { recursive: true });
  const safeId = sanitizeCollectionOrderOverrideId(collectionId);
  const filePath = path.join(collectionOrderOverridesDir, `${safeId}.json`);
  if (!filePath.startsWith(collectionOrderOverridesDir)) throw new Error("Invalid collection order override path.");
  return { safeId, filePath };
}

function normalizeCollectionOrderOverrideItem(item = {}, index = 0) {
  const library = item.library === "tv" ? "tv" : "movies";
  const sourceId = String(item.sourceId || item.id || item.localId || "").trim();
  const title = String(item.title || item.name || "").trim();
  if (!sourceId && !title) return null;
  return { library, sourceId, title, order: index + 1 };
}

function readAllCollectionOrderOverrides() {
  fs.mkdirSync(collectionOrderOverridesDir, { recursive: true });
  return fs.readdirSync(collectionOrderOverridesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => readJsonFile(path.join(collectionOrderOverridesDir, name), null))
    .filter(Boolean);
}

app.get("/api/collections/order-overrides", (req, res) => {
  try {
    res.json({ ok: true, overrides: readAllCollectionOrderOverrides(), storagePath: collectionOrderOverridesDir });
  } catch (error) {
    console.error("Failed to read collection order overrides:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to read collection order overrides." });
  }
});

app.post("/api/collections/order-overrides", (req, res) => {
  try {
    const collectionId = sanitizeCollectionOrderOverrideId(req.body?.collectionId || req.body?.id || req.body?.collectionName);
    const { filePath } = getCollectionOrderOverridePath(collectionId);
    const override = {
      collectionId,
      collectionName: String(req.body?.collectionName || "Collection").trim(),
      source: String(req.body?.source || "smart").trim(),
      items: (Array.isArray(req.body?.items) ? req.body.items : [])
        .map(normalizeCollectionOrderOverrideItem)
        .filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    writeJsonFile(filePath, override);
    res.json({ ok: true, override, storagePath: filePath, message: `Saved manual order for ${override.collectionName}.` });
  } catch (error) {
    console.error("Failed to save collection order override:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to save collection order override." });
  }
});

app.delete("/api/collections/order-overrides/:collectionId", (req, res) => {
  try {
    const { filePath, safeId } = getCollectionOrderOverridePath(req.params.collectionId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, id: safeId, message: "Collection returned to automatic order." });
  } catch (error) {
    console.error("Failed to delete collection order override:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to reset collection order." });
  }
});


// User-editable titles and artwork for generated metadata/smart collections.
const collectionAppearanceOverridesDir = path.join(dataDir, "collections", "appearance-overrides");

function sanitizeCollectionAppearanceOverrideId(value = "") {
  return String(value || "collection")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "collection";
}

function getCollectionAppearanceOverridePath(collectionId = "") {
  fs.mkdirSync(collectionAppearanceOverridesDir, { recursive: true });
  const safeId = sanitizeCollectionAppearanceOverrideId(collectionId);
  const filePath = path.join(collectionAppearanceOverridesDir, `${safeId}.json`);
  if (!filePath.startsWith(collectionAppearanceOverridesDir)) throw new Error("Invalid collection appearance path.");
  return { safeId, filePath };
}

function readAllCollectionAppearanceOverrides() {
  fs.mkdirSync(collectionAppearanceOverridesDir, { recursive: true });
  return fs.readdirSync(collectionAppearanceOverridesDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => readJsonFile(path.join(collectionAppearanceOverridesDir, name), null))
    .filter(Boolean);
}

app.get("/api/collections/appearance-overrides", (req, res) => {
  try {
    res.json({ ok: true, overrides: readAllCollectionAppearanceOverrides(), storagePath: collectionAppearanceOverridesDir });
  } catch (error) {
    console.error("Failed to read collection appearance overrides:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to read collection appearance overrides." });
  }
});

app.post("/api/collections/appearance-overrides", (req, res) => {
  try {
    const collectionId = sanitizeCollectionAppearanceOverrideId(req.body?.collectionId || req.body?.id);
    const { filePath } = getCollectionAppearanceOverridePath(collectionId);
    const override = {
      collectionId,
      source: String(req.body?.source || "metadata").trim(),
      name: String(req.body?.name || "").trim(),
      description: String(req.body?.description || "").trim(),
      poster: String(req.body?.poster || "").trim(),
      banner: String(req.body?.banner || "").trim(),
      updatedAt: new Date().toISOString(),
    };
    writeJsonFile(filePath, override);
    res.json({ ok: true, override, storagePath: filePath, message: "Collection title and artwork saved." });
  } catch (error) {
    console.error("Failed to save collection appearance override:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to save collection appearance." });
  }
});

// Shared media collection watch-order imports.
// Stored in persistent data so imported orders survive rebuilds.
const collectionWatchOrdersDir = path.join(dataDir, "collections", "watch-orders");

function sanitizeCollectionWatchOrderId(value = "") {
  return String(value || "collection")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "collection";
}

function getCollectionWatchOrderPath(collectionId = "") {
  const safeId = sanitizeCollectionWatchOrderId(collectionId);
  fs.mkdirSync(collectionWatchOrdersDir, { recursive: true });
  const filePath = path.join(collectionWatchOrdersDir, `${safeId}.json`);
  if (!filePath.startsWith(collectionWatchOrdersDir)) throw new Error("Invalid collection watch-order path.");
  return { safeId, filePath };
}

function decodeBasicHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCharCode(point) : "";
    });
}

function htmlToCollectionWatchOrderText(html = "") {
  const source = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n");

  const cleanBlockText = (value = "") => decodeBasicHtmlEntities(String(value || ""))
    .replace(/<\s*br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Prefer semantic watch-order blocks when the source exposes headings and lists.
  // This avoids importing article navigation, streaming-service lists, synopsis headers,
  // editor-only accordion labels, ads, and year-only mini headers as watch-order rows.
  const semanticLines = [];
  let insideWatchOrder = false;
  const blocks = source.matchAll(/<(h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi);

  for (const match of blocks) {
    const tag = String(match[1] || "").toLowerCase();
    const text = cleanBlockText(match[2]);
    if (!text) continue;

    if (tag.startsWith("h")) {
      const isWatchOrderHeading = /\bwatch\s+order\b/i.test(text);
      if (isWatchOrderHeading && !/definitive\s+watch\s+order/i.test(text)) {
        semanticLines.push(text);
        insideWatchOrder = true;
      } else if (insideWatchOrder) {
        insideWatchOrder = false;
      }
      continue;
    }

    if (tag === "li" && insideWatchOrder) {
      semanticLines.push(text);
    }
  }

  if (semanticLines.some((line) => /\bseason\s+\d+.*\bepisodes?\b|\bS\d{1,3}E\d{1,3}\b/i.test(line))) {
    return semanticLines.join("\n");
  }

  // Generic fallback for pasted/simple pages that do not use heading + list markup.
  return decodeBasicHtmlEntities(source)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|article|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*(li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeWatchOrderLine(line = "") {
  return decodeBasicHtmlEntities(String(line || ""))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/^\s*(?:[-*Ã¢â‚¬Â¢]+|\d+[.)]|[a-z][.)])\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEpisodeSelector(value = "") {
  const text = String(value || "").replace(/[Ã¢â‚¬â€œÃ¢â‚¬â€]/g, "-");
  const range = text.match(/(\d{1,3})\s*(?:-|to)\s*(\d{1,3})/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      return Array.from({ length: max - min + 1 }, (_, index) => min + index);
    }
  }
  const numbers = Array.from(text.matchAll(/\d{1,3}/g)).map((match) => Number(match[0])).filter(Number.isFinite);
  return Array.from(new Set(numbers));
}

function parseWatchOrderItemLine(line = "") {
  const clean = normalizeWatchOrderLine(line);
  if (!clean || clean.length < 3 || clean.length > 220) return null;
  if (/^(watch order|updated|advertisement|share|comments?|related|source|photo|image|credit|copyright)$/i.test(clean)) return null;
  if (/^(?:main|companion)\s+series:?$/i.test(clean)) return null;
  if (/^(?:complete\s+season|part\s+\d+|crossover(?:\s+\d+)?|all\s+tabs\s+start\s+closed.*)$/i.test(clean)) return null;
  if (/^season\s+\d+(?:\s*\([^)]*\))?$/i.test(clean)) return null;
  if (/^(?:19|20)\d{2}(?:\s*-\s*(?:19|20)\d{2})?$/.test(clean)) return null;
  if (/\bsynopsis\b.*\bspoilers?\b/i.test(clean)) return null;

  const seasonEpisodeMatch = clean.match(/^(.+?)(?:,?\s+|\s*-\s*)Season\s+(\d{1,3})(?:,?\s+Episodes?\s+(\d{1,3}(?:\s*(?:-|to|,)\s*\d{1,3})*))?(?:\s*\(([^)]*)\))?$/i);
  if (seasonEpisodeMatch) {
    const title = seasonEpisodeMatch[1].trim().replace(/[,:\-]+$/g, "");
    const season = Number(seasonEpisodeMatch[2]);
    const episodes = parseEpisodeSelector(seasonEpisodeMatch[3] || "");
    return {
      type: "tv",
      title,
      season: Number.isFinite(season) ? season : null,
      episodes,
      detail: `Season ${season}${episodes.length ? ` Episodes ${episodes[0]}${episodes.length > 1 ? `-${episodes[episodes.length - 1]}` : ""}` : ""}`,
      date: seasonEpisodeMatch[4] || "",
      raw: clean,
    };
  }

  const sxexMatch = clean.match(/^(.+?)\s+S(\d{1,3})\s*E(\d{1,3})(?:\s*(?:-|to)\s*(?:S\d{1,3}\s*)?E?(\d{1,3}))?(?:\s*[-:]\s*(.+))?$/i);
  if (sxexMatch) {
    const season = Number(sxexMatch[2]);
    const startEpisode = Number(sxexMatch[3]);
    const endEpisode = Number(sxexMatch[4] || sxexMatch[3]);
    const minEpisode = Math.min(startEpisode, endEpisode);
    const maxEpisode = Math.max(startEpisode, endEpisode);
    const episodes = Array.from({ length: maxEpisode - minEpisode + 1 }, (_, index) => minEpisode + index);
    return {
      type: "tv",
      title: sxexMatch[1].trim(),
      season,
      episodes,
      detail: `Season ${season} Episode${episodes.length === 1 ? "" : "s"} ${episodes[0]}${episodes.length > 1 ? `-${episodes[episodes.length - 1]}` : ""}`,
      episodeTitle: sxexMatch[5] || "",
      raw: clean,
    };
  }

  const yearMatch = clean.match(/\b((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}))?\b/);
  const titleWithoutYear = clean.replace(/\s*\(((?:19|20)\d{2})\)\s*$/, "").trim();
  if (yearMatch && titleWithoutYear.length <= 120) {
    return {
      type: /season|episode/i.test(clean) ? "tv" : "movie",
      title: titleWithoutYear.replace(/\b(?:19|20)\d{2}\b/g, "").trim() || clean,
      date: yearMatch[2] ? `${yearMatch[1]}-${yearMatch[2]}` : yearMatch[1],
      raw: clean,
    };
  }

  return null;
}

function isLikelyWatchOrderHeading(line = "") {
  const clean = normalizeWatchOrderLine(line);
  if (!clean || clean.length > 90) return false;
  if (parseWatchOrderItemLine(clean)) return false;
  return /^(year|phase|season|part|chapter|era|crossover|pre-|post-|crisis|elseworlds|invasion|arrowverse|sony|fox|earth|connected|watch order|\d{4}|[ivxlcdm]+\.)/i.test(clean) || /\b(era|phase|saga|finale|timeline|universe|crossover|season)\b/i.test(clean);
}

function parseCollectionWatchOrderText(text = "", options = {}) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map(normalizeWatchOrderLine)
    .filter(Boolean);

  const sections = [];
  let current = { id: "imported", title: options.title || "Imported Watch Order", items: [] };
  let orderIndex = 0;

  const pushCurrent = () => {
    if (current.items.length) sections.push(current);
  };

  lines.forEach((line) => {
    const item = parseWatchOrderItemLine(line);
    if (item) {
      current.items.push({ ...item, order: ++orderIndex });
      return;
    }
    if (isLikelyWatchOrderHeading(line)) {
      pushCurrent();
      const id = line.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `section-${sections.length + 1}`;
      current = { id, title: line, items: [] };
    }
  });

  pushCurrent();

  if (!sections.length && lines.length) {
    sections.push({ id: "raw", title: options.title || "Imported Watch Order", items: lines.slice(0, 300).map((line, index) => ({ type: "note", title: line, raw: line, order: index + 1 })) });
  }

  return {
    id: sanitizeCollectionWatchOrderId(options.collectionId || "collection"),
    collectionId: sanitizeCollectionWatchOrderId(options.collectionId || "collection"),
    title: options.title || "Imported Watch Order",
    sourceUrl: options.sourceUrl || "",
    importedAt: new Date().toISOString(),
    itemCount: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  };
}

async function fetchCollectionWatchOrderSourceText(sourceUrl = "") {
  const url = new URL(String(sourceUrl || ""));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http/https watch-order URLs are supported.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.href, {
      headers: { "user-agent": "Homestead/1.0 watch-order-importer" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();
    return contentType.includes("html") || /<html|<body|<li|<p/i.test(raw) ? htmlToCollectionWatchOrderText(raw) : raw;
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/api/collections/watch-order/save", (req, res) => {
  try {
    const collectionId = sanitizeCollectionWatchOrderId(req.body?.collectionId || req.body?.order?.collectionId || "collection");
    const submitted = req.body?.order;
    if (!submitted || !Array.isArray(submitted.sections)) {
      return res.status(400).json({ ok: false, message: "A structured watch order with sections is required." });
    }
    const sections = submitted.sections.map((section, sectionIndex) => ({
      id: sanitizeCollectionWatchOrderId(section?.id || `section-${sectionIndex + 1}`),
      title: String(section?.title || `Section ${sectionIndex + 1}`).trim(),
      manualOrder: section?.manualOrder === true,
      items: (Array.isArray(section?.items) ? section.items : []).map((item, itemIndex) => ({
        ...item,
        title: String(item?.title || "").trim(),
        order: itemIndex + 1,
      })).filter((item) => item.title),
    })).filter((section) => section.items.length);
    if (!sections.length) return res.status(400).json({ ok: false, message: "Add at least one movie or episode." });
    const order = {
      id: collectionId,
      collectionId,
      title: String(submitted.title || "Watch Order").trim() || "Watch Order",
      sourceUrl: String(submitted.sourceUrl || "").trim(),
      importedAt: new Date().toISOString(),
      manualOrder: true,
      itemCount: sections.reduce((sum, section) => sum + section.items.length, 0),
      sections,
    };
    const { filePath } = getCollectionWatchOrderPath(collectionId);
    writeJsonFile(filePath, order);
    res.json({ ok: true, order, storagePath: filePath, message: `Saved ${order.itemCount} exact watch-order row${order.itemCount === 1 ? "" : "s"}.` });
  } catch (error) {
    console.error("Failed to save structured collection watch order:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to save watch order" });
  }
});

app.get("/api/collections/watch-order/:collectionId", (req, res) => {
  try {
    const { filePath } = getCollectionWatchOrderPath(req.params.collectionId);
    if (!fs.existsSync(filePath)) return res.json({ ok: true, order: null, storagePath: filePath });
    const order = readJsonFile(filePath, null);
    res.json({ ok: true, order, storagePath: filePath });
  } catch (error) {
    console.error("Failed to read collection watch order:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to read collection watch order" });
  }
});

app.post("/api/collections/watch-order/import", async (req, res) => {
  try {
    const collectionId = sanitizeCollectionWatchOrderId(req.body?.collectionId || "collection");
    const title = String(req.body?.title || "Imported Watch Order").trim() || "Imported Watch Order";
    const sourceUrl = String(req.body?.sourceUrl || "").trim();
    const pastedText = String(req.body?.pastedText || req.body?.text || "").trim();
    if (!sourceUrl && !pastedText) return res.status(400).json({ ok: false, message: "Paste a URL or watch-order text first." });

    const sourceText = pastedText || await fetchCollectionWatchOrderSourceText(sourceUrl);
    const order = parseCollectionWatchOrderText(sourceText, { collectionId, title, sourceUrl });
    const { filePath } = getCollectionWatchOrderPath(collectionId);
    writeJsonFile(filePath, order);
    res.json({ ok: true, order, storagePath: filePath, message: `Imported ${order.itemCount} watch-order row${order.itemCount === 1 ? "" : "s"}.` });
  } catch (error) {
    console.error("Failed to import collection watch order:", error);
    res.status(500).json({ ok: false, message: error.message || "Failed to import watch order" });
  }
});


// =========================================================
// Homestead Intake Framework
// Device-aware sessions, identity resolution, and intake queue storage.
// =========================================================
const intakeDataDir = path.join(dataDir, "intake");
const intakeSessionsPath = path.join(intakeDataDir, "sessions.json");
const intakeQueuePath = path.join(intakeDataDir, "queue.json");
const intakeIdentitiesPath = path.join(intakeDataDir, "identities.json");
const activityDataPath = intakeQueuePath;

const intakeLibraryRecordsDir = path.join(intakeDataDir, "library-records");

function intakeLibraryRecordsPath(libraryId = "inventory") {
  const safeLibrary = String(libraryId || "inventory").replace(/[^a-z0-9_-]/gi, "") || "inventory";
  return path.join(intakeLibraryRecordsDir, `${safeLibrary}.json`);
}

function readIntakeLibraryRecords(libraryId = "inventory") {
  return readIntakeCollection(intakeLibraryRecordsPath(libraryId));
}

function writeIntakeLibraryRecords(libraryId = "inventory", records = []) {
  fs.mkdirSync(intakeLibraryRecordsDir, { recursive: true });
  writeJsonFile(intakeLibraryRecordsPath(libraryId), Array.isArray(records) ? records.slice(-10000) : []);
}

function normalizeIsbn13(code = "") {
  const digits = String(code || "").replace(/\D/g, "");
  if (digits.length === 13 && /^97[89]/.test(digits)) return digits;
  if (digits.length !== 10) return "";
  const core = `978${digits.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

async function lookupIntakeMetadata(code = "", codeType = "", libraryId = "") {
  const cleanCode = String(code || "").trim().replace(/\s+/g, "");
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(5500) : undefined;
  if (!cleanCode) return null;

  if (libraryId === "books" || codeType === "isbn" || codeType === "isbn-or-upc") {
    const isbn = normalizeIsbn13(cleanCode) || cleanCode;
    try {
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`, { signal: timeout });
      const data = await response.json().catch(() => ({}));
      const book = data?.items?.[0]?.volumeInfo;
      if (response.ok && book) {
        return {
          provider: "Google Books",
          confidence: "strong",
          title: book.title || "",
          subtitle: book.subtitle || "",
          authors: Array.isArray(book.authors) ? book.authors : [],
          publisher: book.publisher || "",
          publishedDate: book.publishedDate || "",
          description: book.description || "",
          pageCount: Number(book.pageCount || 0),
          categories: Array.isArray(book.categories) ? book.categories : [],
          thumbnail: book.imageLinks?.thumbnail || book.imageLinks?.smallThumbnail || "",
          identifiers: Array.isArray(book.industryIdentifiers) ? book.industryIdentifiers : [],
          isbn,
        };
      }
    } catch (error) {
      console.warn("Google Books ISBN metadata lookup failed:", error.message || error);
    }

    try {
      const bibKey = `ISBN:${isbn}`;
      const response = await fetch(`https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibKey)}&jscmd=data&format=json`, { signal: timeout, headers: { "User-Agent": "Homestead/1.0" } });
      const data = await response.json().catch(() => ({}));
      const book = data?.[bibKey];
      if (response.ok && book?.title) {
        return {
          provider: "Open Library",
          confidence: "strong",
          title: book.title || "",
          subtitle: book.subtitle || "",
          authors: Array.isArray(book.authors) ? book.authors.map((author) => author?.name).filter(Boolean) : [],
          publisher: Array.isArray(book.publishers) ? book.publishers.map((publisher) => publisher?.name).filter(Boolean).join(", ") : "",
          publishedDate: book.publish_date || "",
          description: typeof book.notes === "string" ? book.notes : "",
          pageCount: Number(book.number_of_pages || 0),
          categories: Array.isArray(book.subjects) ? book.subjects.map((subject) => subject?.name).filter(Boolean).slice(0, 20) : [],
          thumbnail: book.cover?.medium || book.cover?.large || book.cover?.small || "",
          identifiers: [{ type: "ISBN", identifier: isbn }],
          isbn,
        };
      }
    } catch (error) {
      console.warn("Open Library ISBN metadata lookup failed:", error.message || error);
    }
  }

  if (libraryId === "inventory" && /^\d{8,14}$/.test(cleanCode)) {
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json?fields=code,product_name,brands,categories,image_front_url,quantity`, { signal: timeout, headers: { "User-Agent": "Homestead/1.0" } });
      const data = await response.json().catch(() => ({}));
      const product = data?.product;
      if (response.ok && data?.status === 1 && product?.product_name) {
        return {
          provider: "Open Food Facts",
          confidence: "provider-match",
          title: product.product_name || "",
          brand: product.brands || "",
          categories: String(product.categories || "").split(",").map((value) => value.trim()).filter(Boolean),
          quantity: product.quantity || "",
          thumbnail: product.image_front_url || "",
          code: product.code || cleanCode,
        };
      }
    } catch (error) {
      console.warn("UPC metadata lookup failed:", error.message || error);
    }
  }

  return null;
}

function getConfiguredBookSourceRoots() {
  const setup = readSetupConfig();
  const candidates = [];
  const pushValue = (value, name = "Connected folder") => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach((entry) => pushValue(entry, name));
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => pushValue(entry, key));
      return;
    }
    const raw = String(value || "").trim();
    if (!raw) return;
    raw.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean).forEach((entry) => candidates.push({ path: entry, name }));
  };
  pushValue(process.env.HOMESTEAD_EBOOK_ROOTS, "Environment ebook source");
  pushValue(process.env.HOMESTEAD_BOOK_SOURCE_ROOTS, "Environment book source");
  pushValue(setup?.folderMappings?.books, "Books folder");
  pushValue(setup?.folderMappings?.ebooks, "Ebooks folder");
  pushValue(setup?.integrations?.calibre?.libraryPath, "Calibre");
  pushValue(setup?.integrations?.calibre?.paths, "Calibre");
  [path.join(dataDir, "books"), path.join(dataDir, "imports", "books"), path.join(__dirname, "media", "books")].forEach((entry) => candidates.push({ path: entry, name: "Homestead storage" }));
  const seen = new Set();
  return candidates.filter((entry) => {
    const resolved = path.resolve(entry.path);
    if (seen.has(resolved) || !fs.existsSync(resolved)) return false;
    seen.add(resolved);
    return true;
  }).map((entry) => ({ ...entry, path: path.resolve(entry.path) }));
}

function tokenizeBookSearch(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((token) => token.length > 1);
}

function formatFileSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function searchConnectedBookFiles({ isbn = "", title = "", author = "" } = {}) {
  const roots = getConfiguredBookSourceRoots();
  const titleTokens = tokenizeBookSearch(title);
  const authorTokens = tokenizeBookSearch(author);
  const cleanIsbn = String(isbn || "").replace(/[^0-9X]/gi, "").toLowerCase();
  const allowed = new Set([".epub", ".pdf", ".mobi", ".azw", ".azw3", ".cbz", ".cbr", ".m4b", ".mp3"]);
  const results = [];
  let visited = 0;
  const maxVisited = 12000;

  const walk = (root, current, depth = 0) => {
    if (visited >= maxVisited || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (visited++ >= maxVisited) break;
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(root, fullPath, depth + 1); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowed.has(ext)) continue;
      const haystack = `${entry.name} ${path.relative(root.path, fullPath)}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      let score = 0;
      if (cleanIsbn && haystack.replace(/\s+/g, "").includes(cleanIsbn)) score += 0.75;
      if (titleTokens.length) score += (titleTokens.filter((token) => haystack.includes(token)).length / titleTokens.length) * 0.55;
      if (authorTokens.length) score += (authorTokens.filter((token) => haystack.includes(token)).length / authorTokens.length) * 0.25;
      if (!cleanIsbn && !titleTokens.length && !authorTokens.length) score = 0.1;
      if (score < 0.25) continue;
      let stat = null;
      try { stat = fs.statSync(fullPath); } catch { /* ignore */ }
      results.push({
        id: crypto.createHash("sha1").update(fullPath).digest("hex").slice(0, 16),
        name: path.basename(entry.name, ext),
        format: ext.slice(1).toUpperCase(),
        path: fullPath,
        sourceName: root.name,
        size: stat?.size || 0,
        sizeLabel: formatFileSize(stat?.size || 0),
        confidence: Math.min(0.99, Math.max(0.25, score)),
      });
    }
  };
  roots.forEach((root) => walk(root, root.path));
  return results.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name)).slice(0, 40);
}

function importSelectedBookFile(source = {}, bookRecord = {}) {
  const sourcePath = path.resolve(String(source?.path || ""));
  const allowedRoots = getConfiguredBookSourceRoots().map((root) => root.path);
  if (!sourcePath || !fs.existsSync(sourcePath) || !allowedRoots.some((root) => sourcePath === root || sourcePath.startsWith(`${root}${path.sep}`))) {
    throw new Error("The selected digital file is no longer available in a connected source.");
  }
  const importDir = path.resolve(process.env.HOMESTEAD_BOOK_IMPORT_DIR || path.join(dataDir, "library-imports", "books"));
  fs.mkdirSync(importDir, { recursive: true });
  const ext = path.extname(sourcePath).toLowerCase();
  const safeTitle = String(bookRecord.title || "book").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "book";
  let destination = path.join(importDir, `${safeTitle}-${bookRecord.id}${ext}`);
  if (path.resolve(sourcePath) !== path.resolve(destination)) fs.copyFileSync(sourcePath, destination);
  else destination = sourcePath;
  return { sourcePath, importedPath: destination, format: ext.slice(1).toUpperCase(), importedAt: new Date().toISOString() };
}


function normalizeIntegrationBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getReadarrIntakeSettings() {
  const setup = readSetupConfig();
  const settings = setup?.integrationSettings?.readarr && typeof setup.integrationSettings.readarr === "object"
    ? setup.integrationSettings.readarr
    : setup?.integrations?.readarr && typeof setup.integrations.readarr === "object"
      ? setup.integrations.readarr
      : {};
  const url = normalizeIntegrationBaseUrl(
    process.env.READARR_URL ||
    process.env.HOMESTEAD_READARR_URL ||
    settings.url || settings.baseUrl || settings.serverUrl || ""
  );
  const apiKey = String(
    process.env.READARR_API_KEY ||
    process.env.HOMESTEAD_READARR_API_KEY ||
    settings.apiKey || settings.apikey || ""
  ).trim();
  return {
    url,
    apiKey,
    configured: Boolean(url && apiKey),
    rootFolderPath: String(settings.rootFolderPath || settings.rootFolder || process.env.READARR_ROOT_FOLDER || "").trim(),
    qualityProfileId: Number(settings.qualityProfileId || process.env.READARR_QUALITY_PROFILE_ID || 0) || 0,
    metadataProfileId: Number(settings.metadataProfileId || process.env.READARR_METADATA_PROFILE_ID || 0) || 0,
  };
}

async function readarrIntakeRequest(route, options = {}) {
  const settings = getReadarrIntakeSettings();
  if (!settings.configured) throw new Error("Readarr is not configured. Add its URL and API key in Homestead integrations.");
  const response = await fetch(`${settings.url}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": settings.apiKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
  if (!response.ok) {
    const detail = data?.message || data?.error || (Array.isArray(data) ? data.map((item) => item?.errorMessage || item?.message).filter(Boolean).join("; ") : "");
    throw new Error(detail || `Readarr returned HTTP ${response.status}.`);
  }
  return data;
}

function bookCandidateIsbnValues(candidate = {}) {
  const values = [];
  const push = (value) => {
    const clean = String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
    if (clean && !values.includes(clean)) values.push(clean);
  };
  push(candidate.isbn);
  push(candidate.isbn13);
  (candidate.editions || []).forEach((edition) => {
    push(edition.isbn);
    push(edition.isbn13);
  });
  return values;
}

function appendAcquisitionActivity({ status = "pending", title = "Book request", code = "", sessionId = "", provider = "readarr", message = "", linkedRecord = null } = {}) {
  const activities = getActivityItems();
  const now = new Date().toISOString();
  const activity = {
    id: makeIntakeId("activity"),
    activityType: "book-acquisition",
    status,
    title,
    code,
    libraryId: "books",
    provider,
    source: provider,
    sessionId,
    notes: message,
    linkedRecord,
    createdAt: now,
    updatedAt: now,
  };
  activities.push(activity);
  writeJsonFile(activityDataPath, activities.slice(-2000));
  return activity;
}

app.get("/api/intake/books/acquisition-options", async (req, res) => {
  const readarr = getReadarrIntakeSettings();
  let connected = false;
  let version = "";
  if (readarr.configured) {
    try {
      const status = await readarrIntakeRequest("/api/v1/system/status");
      connected = true;
      version = String(status?.version || "");
    } catch {
      connected = false;
    }
  }
  const setup = readSetupConfig();
  const approvedExternalSources = Array.isArray(setup?.bookAcquisition?.approvedExternalSources)
    ? setup.bookAcquisition.approvedExternalSources.filter((source) => source?.enabled !== false).map((source) => ({ id: source.id || source.name, name: source.name || source.id, capabilities: source.capabilities || ["search", "open"] }))
    : [];
  res.json({
    ok: true,
    readarr: { configured: readarr.configured, connected, version },
    approvedExternalSources,
  });
});

app.post("/api/intake/books/request-readarr", async (req, res) => {
  const isbn = String(req.body?.isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
  const title = String(req.body?.title || "").trim();
  const author = String(req.body?.author || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  let activity = null;
  try {
    const settings = getReadarrIntakeSettings();
    if (!settings.configured) return res.status(400).json({ ok: false, message: "Readarr is not configured. Add its URL and API key in Homestead integrations." });
    if (!isbn && !title) return res.status(400).json({ ok: false, message: "Scan an ISBN or enter a title before requesting the book." });

    const lookupTerm = isbn ? `isbn:${isbn}` : `${title}${author ? ` ${author}` : ""}`;
    const lookup = await readarrIntakeRequest(`/api/v1/book/lookup?term=${encodeURIComponent(lookupTerm)}`);
    const candidates = Array.isArray(lookup) ? lookup : [];
    let candidate = isbn
      ? candidates.find((item) => bookCandidateIsbnValues(item).includes(isbn))
      : null;
    candidate ||= candidates[0];
    if (!candidate) throw new Error("Readarr did not find a matching book for this ISBN or title.");

    const [roots, qualities, metadataProfiles] = await Promise.all([
      readarrIntakeRequest("/api/v1/rootfolder"),
      readarrIntakeRequest("/api/v1/qualityprofile"),
      readarrIntakeRequest("/api/v1/metadataprofile").catch(() => []),
    ]);
    const rootFolderPath = settings.rootFolderPath || roots?.[0]?.path || "";
    const qualityProfileId = settings.qualityProfileId || qualities?.[0]?.id || 0;
    const metadataProfileId = settings.metadataProfileId || metadataProfiles?.[0]?.id || candidate?.author?.metadataProfileId || 0;
    if (!rootFolderPath) throw new Error("Readarr has no root folder configured.");
    if (!qualityProfileId) throw new Error("Readarr has no quality profile configured.");

    const payload = {
      ...candidate,
      monitored: true,
      rootFolderPath,
      qualityProfileId,
      ...(metadataProfileId ? { metadataProfileId } : {}),
      addOptions: { searchForNewBook: true },
      author: candidate.author ? {
        ...candidate.author,
        monitored: true,
        rootFolderPath,
        qualityProfileId,
        ...(metadataProfileId ? { metadataProfileId } : {}),
        addOptions: { searchForNewBook: false },
      } : candidate.author,
    };
    const created = await readarrIntakeRequest("/api/v1/book", { method: "POST", body: JSON.stringify(payload) });
    activity = appendAcquisitionActivity({
      status: "pending",
      title: created?.title || candidate?.title || title || isbn,
      code: isbn,
      sessionId,
      provider: "readarr",
      message: "Requested through Readarr. Searching for a monitored digital edition.",
      linkedRecord: created?.id ? { id: created.id, libraryId: "readarr" } : null,
    });
    res.status(201).json({ ok: true, message: "Book requested through Readarr. Its progress is now tracked in Activity Center.", activity, readarrBook: created });
  } catch (error) {
    activity = appendAcquisitionActivity({ status: "needs-attention", title: title || isbn || "Book request", code: isbn, sessionId, provider: "readarr", message: error.message || "Readarr request failed." });
    res.status(502).json({ ok: false, message: error.message || "Unable to request this book through Readarr.", activity });
  }
});

app.get("/api/intake/books/approved-source-search", (req, res) => {
  const setup = readSetupConfig();
  const providers = Array.isArray(setup?.bookAcquisition?.approvedExternalSources)
    ? setup.bookAcquisition.approvedExternalSources.filter((source) => source?.enabled !== false)
    : [];
  if (!providers.length) {
    return res.json({ ok: true, matches: [], providers: [], message: "Approved external source search is ready, but no providers are configured yet. This can be wired after the Arr workflow." });
  }
  res.json({ ok: true, matches: [], providers: providers.map((source) => ({ id: source.id || source.name, name: source.name || source.id })), message: `${providers.length} approved provider${providers.length === 1 ? " is" : "s are"} configured; provider-specific search wiring is the next acquisition step.` });
});

app.get("/api/intake/books/source-search", (req, res) => {
  try {
    const matches = searchConnectedBookFiles({ isbn: req.query?.isbn, title: req.query?.title, author: req.query?.author });
    res.json({ ok: true, count: matches.length, matches, roots: getConfiguredBookSourceRoots().map((root) => ({ name: root.name, path: root.path })) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to search connected book sources." });
  }
});


function normalizeYugiohSetCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeYugiohRarity(value = "") {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function yugiohPrintingPriceDetails(card = {}, {
  setCode = "",
  rarity = "",
  edition = "",
  language = "",
} = {}) {
  const normalizedSet = normalizeYugiohSetCode(setCode);
  const normalizedRarity = normalizeYugiohRarity(rarity);
  const ranked = (Array.isArray(card.card_sets) ? card.card_sets : [])
    .map((printing) => {
      const printingSet = normalizeYugiohSetCode(printing?.set_code);
      const printingRarity = normalizeYugiohRarity(printing?.set_rarity || "");
      let score = 0;
      if (normalizedSet && printingSet === normalizedSet) score += 100;
      else if (normalizedSet && (printingSet.includes(normalizedSet) || normalizedSet.includes(printingSet))) score += 40;
      if (normalizedRarity && printingRarity === normalizedRarity) score += 50;
      else if (normalizedRarity && printingRarity && (printingRarity.includes(normalizedRarity) || normalizedRarity.includes(printingRarity))) score += 20;
      return {
        printing,
        score,
        value: Number(printing?.set_price || 0),
      };
    })
    .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
    .sort((a, b) => b.score - a.score || b.value - a.value);

  const exact = ranked[0] || null;
  const general = card.card_prices?.[0] || {};
  const genericPrice = [
    Number(general.tcgplayer_price || 0),
    Number(general.cardmarket_price || 0),
    Number(general.ebay_price || 0),
    Number(general.amazon_price || 0),
  ].find((value) => Number.isFinite(value) && value > 0) || 0;
  const printingPrice = exact?.value || 0;

  return {
    marketValue: printingPrice || genericPrice || 0,
    printingPrice,
    genericPrice,
    priceSourceType: printingPrice ? "exact-printing" : "generic-card",
    priceSource: printingPrice ? "YGOPRODeck set_price" : "YGOPRODeck card_prices",
    pricedSetCode: normalizeYugiohSetCode(exact?.printing?.set_code || setCode),
    pricedRarity: exact?.printing?.set_rarity || rarity || "",
    pricedEdition: edition || "",
    pricedLanguage: language || "",
    priceDifferenceWarning:
      printingPrice > 0 &&
      genericPrice > 0 &&
      Math.max(printingPrice, genericPrice) / Math.min(printingPrice, genericPrice) >= 3,
  };
}

function yugiohPriceFromCard(card = {}, setCode = "", rarity = "") {
  return yugiohPrintingPriceDetails(card, { setCode, rarity }).marketValue;
}

const YGOPRODECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getYugiohCachePath() {
  const cacheDir = path.join(dataDir, "intake", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, "ygoprodeck-all-cards.json");
}

async function fetchAllYugiohCardsCached({ force = false } = {}) {
  const cachePath = getYugiohCachePath();

  if (!force && fs.existsSync(cachePath)) {
    try {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs < YGOPRODECK_CACHE_TTL_MS) {
        const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (Array.isArray(cached) && cached.length) return cached;
      }
    } catch (error) {
      console.warn("Unable to read YGOPRODeck cache:", error.message || error);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      "https://db.ygoprodeck.com/api/v7/cardinfo.php?tcgplayer_data=yes",
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Homestead/1.0",
        },
        signal: controller.signal,
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || "YGOPRODeck full-card lookup failed.");
    }

    const cards = Array.isArray(data?.data) ? data.data : [];
    if (cards.length) {
      try {
        fs.writeFileSync(cachePath, JSON.stringify(cards));
      } catch (error) {
        console.warn("Unable to write YGOPRODeck cache:", error.message || error);
      }
    }
    return cards;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYugiohCards({ name = "", setCode = "", cardId = "" } = {}) {
  const normalizedSetCode = normalizeYugiohSetCode(setCode);

  // Set codes live inside card_sets; YGOPRODeck does not treat them as card
  // names. For set-code-only searches, use the locally cached full catalog and
  // filter exact printings.
  if (normalizedSetCode && !name && !cardId) {
    const cards = await fetchAllYugiohCardsCached();
    return cards.filter((card) =>
      (Array.isArray(card?.card_sets) ? card.card_sets : []).some(
        (entry) =>
          normalizeYugiohSetCode(entry?.set_code) === normalizedSetCode
      )
    );
  }

  const params = new URLSearchParams();
  params.set("tcgplayer_data", "yes");
  if (cardId) params.set("id", cardId);
  else if (name) params.set("fname", name);
  else return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://db.ygoprodeck.com/api/v7/cardinfo.php?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Homestead/1.0",
        },
        signal: controller.signal,
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || "YGOPRODeck lookup failed.");
    }

    let cards = Array.isArray(data?.data) ? data.data : [];

    if (normalizedSetCode) {
      cards = cards.filter((card) =>
        (Array.isArray(card?.card_sets) ? card.card_sets : []).some(
          (entry) =>
            normalizeYugiohSetCode(entry?.set_code) === normalizedSetCode
        )
      );
    }

    return cards;
  } finally {
    clearTimeout(timeout);
  }
}

function mapYugiohMatches(cards = [], requestedSetCode = "") {
  const wanted = normalizeYugiohSetCode(requestedSetCode);
  const matches = [];
  cards.forEach((card) => {
    const sets = Array.isArray(card.card_sets) && card.card_sets.length ? card.card_sets : [{ set_code: "", set_name: "", set_rarity: "", set_price: "" }];
    sets.forEach((printing) => {
      const setCode = normalizeYugiohSetCode(printing?.set_code);
      if (wanted && setCode !== wanted && !setCode.includes(wanted) && !wanted.includes(setCode)) return;
      matches.push({
        provider: "YGOPRODeck",
        cardId: String(card.id || ""),
        cardName: card.name || "",
        description: card.desc || "",
        cardType: card.type || "",
        race: card.race || "",
        attribute: card.attribute || "",
        level: Number(card.level || 0),
        atk: Number(card.atk ?? 0),
        def: Number(card.def ?? 0),
        setCode,
        setName: printing?.set_name || "",
        rarity: printing?.set_rarity || "",
        ...yugiohPrintingPriceDetails(card, {
          setCode,
          rarity: printing?.set_rarity || "",
        }),
        image: card.card_images?.[0]?.image_url_small || card.card_images?.[0]?.image_url || "",
        artworkVariants: (Array.isArray(card.card_images) ? card.card_images : []).map((entry, index) => ({
          id: String(entry?.id || `${card.id || "card"}-${index}`),
          image: entry?.image_url || entry?.image_url_small || "",
          thumbnail: entry?.image_url_small || entry?.image_url || "",
        })).filter((entry) => entry.image),
        priceSources: card.card_prices?.[0] || {},
      });
    });
  });
  return matches.sort((a, b) => (wanted && a.setCode === wanted ? -1 : 0) - (wanted && b.setCode === wanted ? -1 : 0) || a.cardName.localeCompare(b.cardName)).slice(0, 60);
}


function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) return reject(new Error(String(stderr || error.message || `${command} failed`).trim()));
      resolve(String(stdout || ""));
    });
  });
}

async function runTesseractOcr(imagePath, psm = "6") {
  try {
    return await execFilePromise("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", String(psm)], { timeout: 24000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(error.message?.includes("not found") ? "Tesseract OCR is unavailable." : error.message || "Tesseract OCR failed.");
  }
}

async function createTcgOcrVariants(sourcePath, tempDir, token) {
  const variants = {
    full: path.join(tempDir, `${token}-full.png`),
    fullThreshold: path.join(tempDir, `${token}-full-threshold.png`),
    title: path.join(tempDir, `${token}-title.png`),
    titleThreshold: path.join(tempDir, `${token}-title-threshold.png`),
    code: path.join(tempDir, `${token}-code.png`),
    codeThreshold: path.join(tempDir, `${token}-code-threshold.png`),
    rotated90: path.join(tempDir, `${token}-rotated-90.png`),
    rotated270: path.join(tempDir, `${token}-rotated-270.png`),
  };

  const commands = [
    [
      "full",
      "scale=1800:-2:flags=lanczos,format=gray,eq=contrast=1.7:brightness=0.04,unsharp=7:7:1.2:7:7:0",
    ],
    [
      "fullThreshold",
      "scale=1800:-2:flags=lanczos,format=gray,normalize,eq=contrast=2.1:brightness=0.05,unsharp=7:7:1.4:7:7:0,threshold",
    ],
    [
      "title",
      "crop=iw*0.94:ih*0.22:iw*0.03:ih*0.02,scale=2200:-2:flags=lanczos,format=gray,normalize,eq=contrast=1.95:brightness=0.05,unsharp=7:7:1.5:7:7:0",
    ],
    [
      "titleThreshold",
      "crop=iw*0.96:ih*0.25:iw*0.02:0,scale=2300:-2:flags=lanczos,format=gray,normalize,eq=contrast=2.35:brightness=0.06,unsharp=7:7:1.6:7:7:0,threshold",
    ],
    [
      "code",
      "crop=iw*0.96:ih*0.27:iw*0.02:ih*0.70,scale=2400:-2:flags=lanczos,format=gray,normalize,eq=contrast=2.0:brightness=0.05,unsharp=7:7:1.6:7:7:0",
    ],
    [
      "codeThreshold",
      "crop=iw*0.98:ih*0.32:iw*0.01:ih*0.66,scale=2500:-2:flags=lanczos,format=gray,normalize,eq=contrast=2.4:brightness=0.07,unsharp=7:7:1.7:7:7:0,threshold",
    ],
    [
      "rotated90",
      "transpose=1,scale=1800:-2:flags=lanczos,format=gray,normalize,eq=contrast=1.8:brightness=0.04,unsharp=7:7:1.3:7:7:0",
    ],
    [
      "rotated270",
      "transpose=2,scale=1800:-2:flags=lanczos,format=gray,normalize,eq=contrast=1.8:brightness=0.04,unsharp=7:7:1.3:7:7:0",
    ],
  ];

  for (const [key, filter] of commands) {
    await execFilePromise(
      "ffmpeg",
      [
        "-y",
        "-i",
        sourcePath,
        "-vf",
        filter,
        "-frames:v",
        "1",
        variants[key],
      ],
      {
        timeout: 30000,
        maxBuffer: 3 * 1024 * 1024,
      }
    );
  }

  return variants;
}

function parseYugiohRecognitionText(text = "", titleText = "", codeText = "") {
  const combined = [titleText, codeText, text].filter(Boolean).join("\n");
  const lines = combined.split(/\r?\n/).map((line) => line.replace(/[^A-Za-z0-9'&+\-: ]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const setPatterns = [
    /\b([A-Z0-9]{2,8}-[A-Z0-9]{2,8})\b/i,
    /\b([A-Z]{2,6}[0-9]{0,3}-[A-Z]{1,4}[0-9]{1,4})\b/i,
  ];
  let setCode = "";
  for (const line of [codeText, ...lines]) {
    for (const pattern of setPatterns) {
      const match = String(line || "").match(pattern);
      if (match) { setCode = normalizeYugiohSetCode(match[1]); break; }
    }
    if (setCode) break;
  }
  const rejected = /^(spellcaster|dragon|warrior|fairy|fiend|effect|fusion|synchro|xyz|link|pendulum|atk|def|1st edition|limited edition|konami|©|level|attribute)/i;
  const preferredTitleLines = String(titleText || "").split(/\r?\n/).concat(lines);
  const titleCandidates = preferredTitleLines
    .map((line) => String(line || "").replace(/[^A-Za-z0-9'&+\-: ]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 52)
    .filter((line) => !rejected.test(line))
    .filter((line) => !setPatterns.some((pattern) => pattern.test(line)))
    .filter((line) => /[A-Za-z]{3}/.test(line))
    .sort((a, b) => {
      const score = (value) => (/[A-Z][a-z]/.test(value) ? 3 : 0) + (value.split(/\s+/).length <= 7 ? 2 : 0) - (/\d{3,}/.test(value) ? 3 : 0);
      return score(b) - score(a);
    });
  const cardName = titleCandidates[0] || "";
  const confidence = Math.min(0.94, (cardName ? 0.5 : 0.1) + (setCode ? 0.4 : 0));
  return { cardName, setCode, confidence, text: combined.slice(0, 7000), titleText: String(titleText || "").slice(0, 1200), codeText: String(codeText || "").slice(0, 1200) };
}

app.post("/api/intake/tcg/yugioh/recognize", async (req, res) => {
  const cleanup = [];
  try {
    const imageData = String(req.body?.imageData || "");
    const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!match) return res.status(400).json({ ok: false, message: "Upload a JPG, PNG, or WebP card photo." });
    const extension = match[1].toLowerCase().replace("jpeg", "jpg");
    const tempDir = path.join(dataDir, "intake", "tmp");
    fs.mkdirSync(tempDir, { recursive: true });
    const token = `tcg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const tempPath = path.join(tempDir, `${token}.${extension}`);
    cleanup.push(tempPath);
    fs.writeFileSync(tempPath, Buffer.from(match[2], "base64"));

    const variants = await createTcgOcrVariants(tempPath, tempDir, token);
    cleanup.push(...Object.values(variants));

    const [
      fullText,
      fullThresholdText,
      titleText,
      titleThresholdText,
      codeText,
      codeThresholdText,
      rotated90Text,
      rotated270Text,
    ] = await Promise.all([
      runTesseractOcr(variants.full, "6"),
      runTesseractOcr(variants.fullThreshold, "11"),
      runTesseractOcr(variants.title, "7"),
      runTesseractOcr(variants.titleThreshold, "7"),
      runTesseractOcr(variants.code, "11"),
      runTesseractOcr(variants.codeThreshold, "11"),
      runTesseractOcr(variants.rotated90, "6"),
      runTesseractOcr(variants.rotated270, "6"),
    ]);

    const recognition = parseYugiohRecognitionText(
      [fullText, fullThresholdText, rotated90Text, rotated270Text].join("\n"),
      [titleText, titleThresholdText].join("\n"),
      [codeText, codeThresholdText].join("\n")
    );
    let cards = [];
    if (recognition.setCode) {
      cards = await fetchYugiohCards({ setCode: recognition.setCode });
    }
    if (!cards.length && recognition.cardName) {
      cards = await fetchYugiohCards({ name: recognition.cardName });
    }
    let matches = mapYugiohMatches(cards, recognition.setCode);
    const normalizedName = recognition.cardName.toLowerCase();
    matches = matches.map((item, index) => {
      const itemName = item.cardName.toLowerCase();
      const exactName = normalizedName && itemName === normalizedName ? 0.5 : 0;
      const partialName = normalizedName && (itemName.includes(normalizedName) || normalizedName.includes(itemName)) ? 0.32 : 0;
      const setScore = recognition.setCode && item.setCode === recognition.setCode ? 0.52 : 0;
      return { ...item, confidence: Math.max(0.05, Math.min(0.99, recognition.confidence * 0.35 + exactName + partialName + setScore - index * 0.005)) };
    }).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    res.json({
      ok: true,
      recognition: { ...recognition, confidence: Number(matches[0]?.confidence || recognition.confidence || 0) },
      matches: matches.slice(0, 24),
      message: matches.length ? `${matches.length} possible printing${matches.length === 1 ? "" : "s"} found. Confirm the exact set and edition.` : `No confident catalog match was found${recognition.cardName || recognition.setCode ? ` (read: ${[recognition.cardName, recognition.setCode].filter(Boolean).join(" / ")})` : ""}. Try brighter light, less glare, and fill the frame, or search manually.`,
    });
  } catch (error) {
    res.status(502).json({ ok: false, message: error.message || "Unable to recognize this Yu-Gi-Oh! card." });
  } finally {
    cleanup.forEach((filePath) => { try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {} });
  }
});

app.get("/api/intake/tcg/yugioh/search", async (req, res) => {
  try {
    const name = String(req.query?.name || "").trim();
    const setCode = normalizeYugiohSetCode(req.query?.setCode || "");
    if (!name && !setCode) return res.status(400).json({ ok: false, message: "Enter a card name or set code." });
    const cards = await fetchYugiohCards({ name, setCode });
    res.json({ ok: true, matches: mapYugiohMatches(cards, setCode) });
  } catch (error) {
    res.status(502).json({ ok: false, message: error.message || "Unable to search Yu-Gi-Oh! cards." });
  }
});

app.post("/api/intake/tcg/yugioh/refresh-prices", async (req, res) => {
  const records = readIntakeLibraryRecords("inventory");
  let updated = 0;
  let failed = 0;
  let warnings = 0;
  const now = new Date().toISOString();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (
      String(record.category || "").toLowerCase() !== "trading-cards" ||
      record.tcg?.game !== "yugioh"
    ) continue;

    try {
      const cards = await fetchYugiohCards({
        cardId: record.tcg?.providerCardId,
        name: record.tcg?.cardName || record.title,
        setCode: record.tcg?.setCode,
      });
      const card =
        cards.find((entry) => String(entry.id || "") === String(record.tcg?.providerCardId || "")) ||
        cards[0];
      if (!card) {
        failed += 1;
        continue;
      }

      const details = yugiohPrintingPriceDetails(card, {
        setCode: record.tcg?.setCode,
        rarity: record.tcg?.rarity,
        edition: record.tcg?.edition,
        language: record.tcg?.language,
      });
      const manualOverride = Number(record.tcg?.manualPriceOverride || 0);
      const marketValue = manualOverride > 0 ? manualOverride : details.marketValue;
      const history = Array.isArray(record.tcg?.priceHistory) ? record.tcg.priceHistory : [];
      if (details.priceDifferenceWarning) warnings += 1;

      records[index] = {
        ...record,
        tcg: {
          ...(record.tcg || {}),
          marketValue,
          printingPrice: details.printingPrice,
          genericPrice: details.genericPrice,
          priceSource: manualOverride > 0 ? "Manual override" : details.priceSource,
          priceSourceType: manualOverride > 0 ? "manual-override" : details.priceSourceType,
          pricedSetCode: details.pricedSetCode,
          pricedRarity: details.pricedRarity,
          pricedEdition: details.pricedEdition,
          pricedLanguage: details.pricedLanguage,
          priceDifferenceWarning: details.priceDifferenceWarning,
          lastPriceRefresh: now,
          priceHistory: [
            ...history,
            {
              at: now,
              provider: manualOverride > 0 ? "Manual override" : details.priceSource,
              marketValue,
              printingPrice: details.printingPrice,
              genericPrice: details.genericPrice,
              setCode: details.pricedSetCode,
              rarity: details.pricedRarity,
            },
          ].slice(-365),
        },
        updatedAt: now,
      };
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  writeIntakeLibraryRecords("inventory", records);
  res.json({ ok: true, updated, failed, warnings });
});



const tcgBindersDataPath = path.join(dataDir, "intake", "tcg-binders.json");

function readTcgBinders() {
  const value = readJsonFile(tcgBindersDataPath, []);
  return Array.isArray(value) ? value : [];
}

function writeTcgBinders(binders = []) {
  writeJsonFile(tcgBindersDataPath, Array.isArray(binders) ? binders : []);
}

function sanitizeBinder(input = {}, current = {}) {
  const rows = Math.max(1, Math.min(8, Number(input.rows ?? current.rows ?? 3)));
  const columns = Math.max(1, Math.min(8, Number(input.columns ?? current.columns ?? 3)));
  const pages = Math.max(1, Math.min(500, Number(input.pages ?? current.pages ?? 20)));
  return {
    ...current,
    name: String(input.name ?? current.name ?? "").trim() || "Untitled Binder",
    description: String(input.description ?? current.description ?? "").trim(),
    location: String(input.location ?? current.location ?? "").trim(),
    coverImage: String(input.coverImage ?? current.coverImage ?? "").trim(),
    notes: String(input.notes ?? current.notes ?? "").trim(),
    rows,
    columns,
    pages,
    doubleSided: Boolean(input.doubleSided ?? current.doubleSided ?? false),
    updatedAt: new Date().toISOString(),
  };
}


function getBinderPhysicalPrintings(record = {}, binderId = "") {
  const printings =
    Array.isArray(record.tcg?.printings) && record.tcg.printings.length
      ? record.tcg.printings
      : record.tcg
      ? [record.tcg]
      : [];

  const binder = readTcgBinders().find(
    (entry) => entry.id === binderId
  );
  const binderName = String(binder?.name || "").trim().toLowerCase();

  return printings
    .filter((printing) => {
      const printingBinderId = String(printing.binderId || "").trim();
      const printingBinderName = String(printing.binder || "")
        .trim()
        .toLowerCase();

      return (
        printingBinderId === String(binderId || "") ||
        (!printingBinderId &&
          binderName &&
          printingBinderName === binderName)
      );
    })
    .map((printing) => ({
      ...record,
      binderRecordKey: `${record.id}:${printing.id || "legacy"}`,
      inventoryRecordId: record.id,
      printingId: printing.id || "",
      tcg: {
        ...(record.tcg || {}),
        ...printing,
        printings: record.tcg?.printings || [],
        activePrintingId: printing.id || "",
        quantity: Math.max(1, Number(printing.quantity || 1)),
        marketValue: Math.max(0, Number(printing.marketValue || 0)),
        selectedArtwork:
          printing.selectedArtwork ||
          record.tcg?.selectedArtwork ||
          record.metadata?.thumbnail ||
          "",
      },
    }));
}

function getAllBinderPhysicalPrintings(inventory = [], binderId = "") {
  return (Array.isArray(inventory) ? inventory : [])
    .flatMap((record) => getBinderPhysicalPrintings(record, binderId))
    .sort(
      (a, b) =>
        Number(a.tcg?.page || 0) - Number(b.tcg?.page || 0) ||
        Number(a.tcg?.pocket || 0) - Number(b.tcg?.pocket || 0)
    );
}


const tcgBinderSleevesDataPath = path.join(
  dataDir,
  "intake",
  "tcg-binder-sleeves.json"
);

function readTcgBinderSleeves() {
  const value = readJsonFile(tcgBinderSleevesDataPath, []);
  return Array.isArray(value) ? value : [];
}

function writeTcgBinderSleeves(assignments = []) {
  writeJsonFile(
    tcgBinderSleevesDataPath,
    Array.isArray(assignments) ? assignments : []
  );
}

function flattenTcgPhysicalPrintings(inventory = []) {
  return (Array.isArray(inventory) ? inventory : []).flatMap((record) => {
    const printings =
      Array.isArray(record.tcg?.printings) && record.tcg.printings.length
        ? record.tcg.printings
        : record.tcg
        ? [record.tcg]
        : [];

    return printings.map((printing) => ({
      inventoryRecordId: record.id,
      printingId: printing.id || "",
      title: record.tcg?.cardName || record.title || record.name || "Untitled card",
      image:
        printing.selectedArtwork ||
        record.tcg?.selectedArtwork ||
        record.metadata?.thumbnail ||
        record.poster ||
        "",
      providerCardId:
        printing.providerCardId ||
        record.tcg?.providerCardId ||
        "",
      setCode: printing.setCode || "",
      rarity: printing.rarity || "",
      edition: printing.edition || "",
      condition: printing.condition || "",
      language: printing.language || "",
      quantity: Math.max(1, Number(printing.quantity || 1)),
      marketValue: Math.max(0, Number(printing.marketValue || 0)),
      binderId: printing.binderId || "",
      binder: printing.binder || "",
      page: String(printing.page || ""),
      pocket: String(printing.pocket || ""),
      selectedArtwork: printing.selectedArtwork || "",
    }));
  });
}

function migrateLegacyBinderLocations() {
  const inventory = readIntakeLibraryRecords("inventory");
  const printings = flattenTcgPhysicalPrintings(inventory);
  const assignments = readTcgBinderSleeves();
  let changed = false;

  printings.forEach((printing) => {
    const binderId = String(printing.binderId || "").trim();
    const page = Number(printing.page || 0);
    const pocket = Number(printing.pocket || 0);

    if (!binderId || page < 1 || pocket < 1) return;

    const alreadyAssigned = assignments.some(
      (assignment) =>
        assignment.inventoryRecordId === printing.inventoryRecordId &&
        String(assignment.printingId || "") ===
          String(printing.printingId || "")
    );

    if (alreadyAssigned) return;

    const occupied = assignments.some(
      (assignment) =>
        assignment.binderId === binderId &&
        Number(assignment.page) === page &&
        Number(assignment.pocket) === pocket
    );

    if (occupied) return;

    assignments.push({
      id: makeIntakeId("sleeve"),
      binderId,
      page,
      pocket,
      inventoryRecordId: printing.inventoryRecordId,
      printingId: printing.printingId,
      quantity: printing.quantity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    changed = true;
  });

  if (changed) writeTcgBinderSleeves(assignments);
  return assignments;
}

function assignedQuantityForPrinting(
  assignments = [],
  inventoryRecordId = "",
  printingId = ""
) {
  return assignments
    .filter(
      (assignment) =>
        assignment.inventoryRecordId === inventoryRecordId &&
        String(assignment.printingId || "") === String(printingId || "")
    )
    .reduce(
      (sum, assignment) =>
        sum + Math.max(1, Number(assignment.quantity || 1)),
      0
    );
}

function hydrateBinderSleeves(binderId = "") {
  const inventory = readIntakeLibraryRecords("inventory");
  const printings = flattenTcgPhysicalPrintings(inventory);
  const assignments = migrateLegacyBinderLocations();

  const sleeves = assignments
    .filter((assignment) => assignment.binderId === binderId)
    .map((assignment) => {
      const printing = printings.find(
        (entry) =>
          entry.inventoryRecordId === assignment.inventoryRecordId &&
          String(entry.printingId || "") ===
            String(assignment.printingId || "")
      );

      return {
        ...assignment,
        title: printing?.title || "Missing card",
        image: printing?.image || "",
        providerCardId: printing?.providerCardId || "",
        setCode: printing?.setCode || "",
        rarity: printing?.rarity || "",
        edition: printing?.edition || "",
        condition: printing?.condition || "",
        language: printing?.language || "",
        marketValue: printing?.marketValue || 0,
        ownedQuantity: printing?.quantity || assignment.quantity || 1,
      };
    })
    .sort(
      (a, b) =>
        Number(a.page || 0) - Number(b.page || 0) ||
        Number(a.pocket || 0) - Number(b.pocket || 0)
    );

  const availablePrintings = printings
    .map((printing) => {
      const assignedQuantity = assignedQuantityForPrinting(
        assignments,
        printing.inventoryRecordId,
        printing.printingId
      );
      return {
        ...printing,
        assignedQuantity,
        availableQuantity: Math.max(
          0,
          Number(printing.quantity || 1) - assignedQuantity
        ),
      };
    })
    .filter((printing) => printing.availableQuantity > 0)
    .sort((a, b) =>
      `${a.title} ${a.setCode} ${a.rarity}`.localeCompare(
        `${b.title} ${b.setCode} ${b.rarity}`
      )
    );

  return {
    sleeves,
    availablePrintings,
    assignments,
  };
}

function validateSleeveCoordinates(binder, page, pocket) {
  const pageNumber = Number(page);
  const pocketNumber = Number(pocket);
  const maxPocket =
    Math.max(1, Number(binder.rows || 3)) *
    Math.max(1, Number(binder.columns || 3));

  if (
    pageNumber < 1 ||
    pageNumber > Number(binder.pages || 1) ||
    pocketNumber < 1 ||
    pocketNumber > maxPocket
  ) {
    throw new Error("Binder page or pocket is outside the configured layout.");
  }

  return {
    page: pageNumber,
    pocket: pocketNumber,
  };
}

app.get("/api/intake/tcg/binders", (req, res) => {
  const binders = readTcgBinders();
  const assignments = migrateLegacyBinderLocations();
  const inventory = readIntakeLibraryRecords("inventory");
  const printings = flattenTcgPhysicalPrintings(inventory);

  const hydrated = binders.map((binder) => {
    const binderAssignments = assignments.filter(
      (assignment) => assignment.binderId === binder.id
    );

    const cardCount = binderAssignments.reduce(
      (sum, assignment) =>
        sum + Math.max(1, Number(assignment.quantity || 1)),
      0
    );

    const value = binderAssignments.reduce((sum, assignment) => {
      const printing = printings.find(
        (entry) =>
          entry.inventoryRecordId === assignment.inventoryRecordId &&
          String(entry.printingId || "") ===
            String(assignment.printingId || "")
      );
      return (
        sum +
        Math.max(1, Number(assignment.quantity || 1)) *
          Number(printing?.marketValue || 0)
      );
    }, 0);

    return {
      ...binder,
      cardCount,
      printingCount: binderAssignments.length,
      value,
      capacity:
        binder.pages *
        binder.rows *
        binder.columns *
        (binder.doubleSided ? 2 : 1),
    };
  });

  res.json({ ok: true, binders: hydrated });
});

app.post("/api/intake/tcg/binders", express.json({ limit: "2mb" }), (req, res) => {
  const binders = readTcgBinders();
  const now = new Date().toISOString();
  const binder = {
    id: makeIntakeId("binder"),
    ...sanitizeBinder(req.body || {}),
    shareToken: makeIntakeId("binder-share"),
    createdAt: now,
    updatedAt: now,
  };
  binders.push(binder);
  writeTcgBinders(binders);
  res.status(201).json({ ok: true, binder });
});

app.patch("/api/intake/tcg/binders/:binderId", express.json({ limit: "2mb" }), (req, res) => {
  const binders = readTcgBinders();
  const index = binders.findIndex((binder) => binder.id === req.params.binderId);
  if (index < 0) return res.status(404).json({ ok: false, message: "Binder not found." });
  binders[index] = sanitizeBinder(req.body || {}, binders[index]);
  writeTcgBinders(binders);
  res.json({ ok: true, binder: binders[index] });
});

app.delete("/api/intake/tcg/binders/:binderId", (req, res) => {
  const binders = readTcgBinders();
  const next = binders.filter((binder) => binder.id !== req.params.binderId);
  if (next.length === binders.length) return res.status(404).json({ ok: false, message: "Binder not found." });
  writeTcgBinders(next);
  writeTcgBinderSleeves(
    readTcgBinderSleeves().filter(
      (assignment) => assignment.binderId !== req.params.binderId
    )
  );

  const inventory = readIntakeLibraryRecords("inventory");
  let changed = false;

  inventory.forEach((record) => {
    if (!record.tcg) return;

    if (Array.isArray(record.tcg.printings)) {
      let recordChanged = false;
      const printings = record.tcg.printings.map((printing) => {
        if (printing.binderId !== req.params.binderId) return printing;
        recordChanged = true;
        return {
          ...printing,
          binderId: "",
          binder: "",
          location: "",
          page: "",
          pocket: "",
          updatedAt: new Date().toISOString(),
        };
      });

      if (recordChanged) {
        record.tcg = summarizeTcgPrintings(record.tcg, printings);
        record.updatedAt = new Date().toISOString();
        changed = true;
      }
      return;
    }

    if (record.tcg.binderId === req.params.binderId) {
      record.tcg = {
        ...(record.tcg || {}),
        binderId: "",
        binder: "",
        location: "",
        page: "",
        pocket: "",
      };
      record.updatedAt = new Date().toISOString();
      changed = true;
    }
  });

  if (changed) writeIntakeLibraryRecords("inventory", inventory);
  res.json({ ok: true });
});

app.get("/api/intake/tcg/binders/:binderId/cards", (req, res) => {
  const binder = readTcgBinders().find(
    (entry) => entry.id === req.params.binderId
  );

  if (!binder) {
    return res
      .status(404)
      .json({ ok: false, message: "Binder not found." });
  }

  const data = hydrateBinderSleeves(binder.id);

  res.json({
    ok: true,
    binder,
    count: data.sleeves.length,
    records: data.sleeves,
    availablePrintings: data.availablePrintings,
  });
});


app.post(
  "/api/intake/tcg/binders/:binderId/sleeves",
  express.json({ limit: "1mb" }),
  (req, res) => {
    try {
      const binder = readTcgBinders().find(
        (entry) => entry.id === req.params.binderId
      );
      if (!binder) {
        return res
          .status(404)
          .json({ ok: false, message: "Binder not found." });
      }

      const { page, pocket } = validateSleeveCoordinates(
        binder,
        req.body?.page,
        req.body?.pocket
      );

      const inventoryRecordId = String(
        req.body?.inventoryRecordId || ""
      ).trim();
      const printingId = String(req.body?.printingId || "").trim();
      const requestedQuantity = Math.max(
        1,
        Number(req.body?.quantity || 1)
      );

      const inventory = readIntakeLibraryRecords("inventory");
      const printing = flattenTcgPhysicalPrintings(inventory).find(
        (entry) =>
          entry.inventoryRecordId === inventoryRecordId &&
          String(entry.printingId || "") === printingId
      );

      if (!printing) {
        return res.status(404).json({
          ok: false,
          message: "Physical printing not found.",
        });
      }

      const assignments = migrateLegacyBinderLocations();
      const occupied = assignments.find(
        (assignment) =>
          assignment.binderId === binder.id &&
          Number(assignment.page) === page &&
          Number(assignment.pocket) === pocket
      );

      if (occupied) {
        return res.status(409).json({
          ok: false,
          message: "That sleeve is already occupied.",
        });
      }

      const assigned = assignedQuantityForPrinting(
        assignments,
        inventoryRecordId,
        printingId
      );
      const available = Math.max(
        0,
        Number(printing.quantity || 1) - assigned
      );

      if (requestedQuantity > available) {
        return res.status(409).json({
          ok: false,
          message: `Only ${available} unassigned cop${
            available === 1 ? "y is" : "ies are"
          } available.`,
        });
      }

      const now = new Date().toISOString();
      const assignment = {
        id: makeIntakeId("sleeve"),
        binderId: binder.id,
        page,
        pocket,
        inventoryRecordId,
        printingId,
        quantity: requestedQuantity,
        createdAt: now,
        updatedAt: now,
      };

      assignments.push(assignment);
      writeTcgBinderSleeves(assignments);

      return res.status(201).json({
        ok: true,
        assignment,
        ...hydrateBinderSleeves(binder.id),
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error.message || "Unable to assign sleeve.",
      });
    }
  }
);

app.patch(
  "/api/intake/tcg/binders/:binderId/sleeves/:assignmentId",
  express.json({ limit: "1mb" }),
  (req, res) => {
    try {
      const binder = readTcgBinders().find(
        (entry) => entry.id === req.params.binderId
      );
      if (!binder) {
        return res
          .status(404)
          .json({ ok: false, message: "Binder not found." });
      }

      const assignments = readTcgBinderSleeves();
      const index = assignments.findIndex(
        (assignment) =>
          assignment.id === req.params.assignmentId &&
          assignment.binderId === binder.id
      );

      if (index < 0) {
        return res.status(404).json({
          ok: false,
          message: "Sleeve assignment not found.",
        });
      }

      const current = assignments[index];
      const coordinates = validateSleeveCoordinates(
        binder,
        req.body?.page ?? current.page,
        req.body?.pocket ?? current.pocket
      );

      const occupied = assignments.find(
        (assignment) =>
          assignment.id !== current.id &&
          assignment.binderId === binder.id &&
          Number(assignment.page) === coordinates.page &&
          Number(assignment.pocket) === coordinates.pocket
      );

      if (occupied) {
        return res.status(409).json({
          ok: false,
          message: "That destination sleeve is already occupied.",
        });
      }

      const requestedQuantity = Math.max(
        1,
        Number(req.body?.quantity ?? current.quantity ?? 1)
      );
      const inventory = readIntakeLibraryRecords("inventory");
      const printing = flattenTcgPhysicalPrintings(inventory).find(
        (entry) =>
          entry.inventoryRecordId === current.inventoryRecordId &&
          String(entry.printingId || "") ===
            String(current.printingId || "")
      );

      if (!printing) {
        return res.status(404).json({
          ok: false,
          message: "Physical printing not found.",
        });
      }

      const assignedElsewhere = assignments
        .filter(
          (assignment) =>
            assignment.id !== current.id &&
            assignment.inventoryRecordId === current.inventoryRecordId &&
            String(assignment.printingId || "") ===
              String(current.printingId || "")
        )
        .reduce(
          (sum, assignment) =>
            sum + Math.max(1, Number(assignment.quantity || 1)),
          0
        );

      const availableForThisSleeve = Math.max(
        0,
        Number(printing.quantity || 1) - assignedElsewhere
      );

      if (requestedQuantity > availableForThisSleeve) {
        return res.status(409).json({
          ok: false,
          message: `Only ${availableForThisSleeve} copies are available for this sleeve.`,
        });
      }

      assignments[index] = {
        ...current,
        page: coordinates.page,
        pocket: coordinates.pocket,
        quantity: requestedQuantity,
        updatedAt: new Date().toISOString(),
      };

      writeTcgBinderSleeves(assignments);

      return res.json({
        ok: true,
        assignment: assignments[index],
        ...hydrateBinderSleeves(binder.id),
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        message: error.message || "Unable to update sleeve.",
      });
    }
  }
);

app.delete(
  "/api/intake/tcg/binders/:binderId/sleeves/:assignmentId",
  (req, res) => {
    const assignments = readTcgBinderSleeves();
    const next = assignments.filter(
      (assignment) =>
        !(
          assignment.id === req.params.assignmentId &&
          assignment.binderId === req.params.binderId
        )
    );

    if (next.length === assignments.length) {
      return res.status(404).json({
        ok: false,
        message: "Sleeve assignment not found.",
      });
    }

    writeTcgBinderSleeves(next);

    return res.json({
      ok: true,
      ...hydrateBinderSleeves(req.params.binderId),
    });
  }
);

app.get("/api/public/tcg/binder/:shareToken", (req, res) => {
  const binder = readTcgBinders().find(
    (entry) => entry.shareToken === req.params.shareToken
  );

  if (!binder) {
    return res
      .status(404)
      .json({ ok: false, message: "Shared binder not found." });
  }

  const data = hydrateBinderSleeves(binder.id);

  res.json({
    ok: true,
    binder: {
      name: binder.name,
      description: binder.description,
      coverImage: binder.coverImage,
      rows: binder.rows,
      columns: binder.columns,
      pages: binder.pages,
      doubleSided: binder.doubleSided,
    },
    records: data.sleeves.map((sleeve) => ({
      id: sleeve.id,
      inventoryRecordId: sleeve.inventoryRecordId,
      printingId: sleeve.printingId,
      title: sleeve.title,
      poster: sleeve.image,
      tcg: {
        setCode: sleeve.setCode,
        rarity: sleeve.rarity,
        condition: sleeve.condition,
        quantity: sleeve.quantity,
        marketValue: sleeve.marketValue,
        page: sleeve.page,
        pocket: sleeve.pocket,
      },
    })),
  });
});

const tcgDecksDataPath = path.join(dataDir, "intake", "tcg-decks.json");
function readTcgDecks() { const value = readJsonFile(tcgDecksDataPath, []); return Array.isArray(value) ? value : []; }
function writeTcgDecks(value = []) { writeJsonFile(tcgDecksDataPath, Array.isArray(value) ? value : []); }
function sanitizeTcgDeckCards(cards = []) {
  return (Array.isArray(cards) ? cards : []).map((card) => ({
    id: String(card?.id || makeIntakeId("deck-card")),
    inventoryRecordId: String(card?.inventoryRecordId || ""),
    providerCardId: String(card?.providerCardId || ""),
    cardName: String(card?.cardName || "").trim(),
    setCode: normalizeYugiohSetCode(card?.setCode || ""),
    artwork: String(card?.artwork || ""),
    section: ["main","extra","side"].includes(String(card?.section || "").toLowerCase()) ? String(card.section).toLowerCase() : "main",
    quantity: Math.max(1, Math.min(3, Number(card?.quantity || 1))),
    owned: card?.owned !== false,
  })).filter((card) => card.cardName);
}
app.get("/api/intake/tcg/decks", (req, res) => res.json({ ok: true, decks: readTcgDecks() }));
app.post("/api/intake/tcg/decks", express.json({ limit: "2mb" }), (req, res) => {
  const decks = readTcgDecks(); const now = new Date().toISOString();
  const deck = { id: makeIntakeId("deck"), name: String(req.body?.name || "").trim() || "Untitled Deck", format: String(req.body?.format || "Advanced"), strategy: String(req.body?.strategy || ""), cards: sanitizeTcgDeckCards(req.body?.cards), createdAt: now, updatedAt: now };
  decks.push(deck); writeTcgDecks(decks); res.status(201).json({ ok: true, deck });
});
app.patch("/api/intake/tcg/decks/:deckId", express.json({ limit: "2mb" }), (req, res) => {
  const decks = readTcgDecks(); const index = decks.findIndex((deck) => deck.id === req.params.deckId);
  if (index < 0) return res.status(404).json({ ok: false, message: "Deck not found." });
  decks[index] = { ...decks[index], name: String(req.body?.name ?? decks[index].name).trim() || decks[index].name, format: String(req.body?.format ?? decks[index].format), strategy: String(req.body?.strategy ?? decks[index].strategy), cards: req.body?.cards === undefined ? decks[index].cards : sanitizeTcgDeckCards(req.body.cards), updatedAt: new Date().toISOString() };
  writeTcgDecks(decks); res.json({ ok: true, deck: decks[index] });
});

function getCaptureRequirements(libraryId = "inventory") {
  const requirements = {
    books: ["cover"],
    movies: ["front-cover"],
    inventory: ["main-photo"],
  };
  return requirements[libraryId] || [];
}


function normalizeTcgPrintingKey(printing = {}) {
  return [
    normalizeYugiohSetCode(printing.setCode || ""),
    String(printing.rarity || "").trim().toLowerCase(),
    String(printing.edition || "").trim().toLowerCase(),
    String(printing.condition || "").trim().toLowerCase(),
    String(printing.language || "").trim().toLowerCase(),
    String(printing.binderId || "").trim(),
    String(printing.page || "").trim(),
    String(printing.pocket || "").trim(),
    String(printing.selectedArtworkId || "").trim(),
  ].join("|");
}

function makeTcgPrinting(payload = {}) {
  const now = new Date().toISOString();
  const savedBinders = readTcgBinders();
  const requestedBinderId = String(payload.binderId || "").trim();
  const requestedBinderName = String(payload.binder || "").trim();
  const resolvedBinder =
    savedBinders.find((binder) => binder.id === requestedBinderId) ||
    savedBinders.find(
      (binder) =>
        requestedBinderName &&
        String(binder.name || "").trim().toLowerCase() ===
          requestedBinderName.toLowerCase()
    ) ||
    null;

  return {
    id: String(payload.printingId || makeIntakeId("printing")),
    setCode: normalizeYugiohSetCode(payload.setCode || ""),
    rarity: String(payload.rarity || "").trim(),
    edition: String(payload.edition || "").trim(),
    condition: String(payload.condition || "").trim(),
    language: String(payload.language || "").trim(),
    quantity: Math.max(1, Number(payload.quantity || 1)),
    purchasePrice: Math.max(0, Number(payload.purchasePrice || 0)),
    marketValue: Math.max(0, Number(payload.marketValue || 0)),
    printingPrice: Math.max(0, Number(payload.printingPrice || 0)),
    genericPrice: Math.max(0, Number(payload.genericPrice || 0)),
    priceSource: String(payload.priceSource || payload.provider || "YGOPRODeck"),
    priceSourceType: String(payload.priceSourceType || ""),
    priceDifferenceWarning: Boolean(payload.priceDifferenceWarning),
    provider: String(payload.provider || "YGOPRODeck"),
    providerCardId: String(payload.providerCardId || ""),
    selectedPrinting:
      payload.selectedPrinting && typeof payload.selectedPrinting === "object"
        ? payload.selectedPrinting
        : null,
    selectedArtwork: String(payload.selectedArtwork || payload.selectedPrinting?.image || ""),
    selectedArtworkId: String(payload.selectedArtworkId || ""),
    artworkVariants: Array.isArray(payload.artworkVariants) ? payload.artworkVariants : [],
    binderId: resolvedBinder?.id || requestedBinderId,
    binder: resolvedBinder?.name || requestedBinderName,
    page: String(payload.page || "").trim(),
    pocket: String(payload.pocket || "").trim(),
    location:
      resolvedBinder?.location ||
      String(payload.location || "").trim(),
    linkedDeckIds: Array.isArray(payload.linkedDeckIds)
      ? [...new Set(payload.linkedDeckIds.map(String))]
      : [],
    createdAt: payload.createdAt || now,
    updatedAt: now,
  };
}

function summarizeTcgPrintings(baseTcg = {}, printings = []) {
  const list = Array.isArray(printings) ? printings : [];
  const primary = list.find((printing) => printing.selectedArtwork) || list[0] || {};
  const totalQuantity = list.reduce(
    (sum, printing) => sum + Math.max(1, Number(printing.quantity || 1)),
    0
  );
  const totalMarketValue = list.reduce(
    (sum, printing) =>
      sum +
      Math.max(1, Number(printing.quantity || 1)) *
        Math.max(0, Number(printing.marketValue || 0)),
    0
  );
  const totalPurchaseCost = list.reduce(
    (sum, printing) =>
      sum +
      Math.max(1, Number(printing.quantity || 1)) *
        Math.max(0, Number(printing.purchasePrice || 0)),
    0
  );

  return {
    ...baseTcg,
    printings: list,
    quantity: totalQuantity,
    totalQuantity,
    totalMarketValue,
    totalPurchaseCost,
    marketValue: totalQuantity ? totalMarketValue / totalQuantity : 0,
    purchasePrice: totalQuantity ? totalPurchaseCost / totalQuantity : 0,
    setCode: primary.setCode || baseTcg.setCode || "",
    rarity: primary.rarity || baseTcg.rarity || "",
    edition: primary.edition || baseTcg.edition || "",
    condition: primary.condition || baseTcg.condition || "",
    language: primary.language || baseTcg.language || "",
    selectedPrinting: primary.selectedPrinting || baseTcg.selectedPrinting || null,
    selectedArtwork: primary.selectedArtwork || baseTcg.selectedArtwork || "",
    selectedArtworkId: primary.selectedArtworkId || baseTcg.selectedArtworkId || "",
    artworkVariants: primary.artworkVariants?.length
      ? primary.artworkVariants
      : baseTcg.artworkVariants || [],
    binderId: primary.binderId || "",
    binder: primary.binder || "",
    page: primary.page || "",
    pocket: primary.pocket || "",
    location: primary.location || "",
    linkedDeckIds: [
      ...new Set(
        list.flatMap((printing) =>
          Array.isArray(printing.linkedDeckIds) ? printing.linkedDeckIds : []
        )
      ),
    ],
  };
}

function mergeTcgPrinting(existingPrintings = [], incomingPayload = {}) {
  const incoming = makeTcgPrinting(incomingPayload);
  const key = normalizeTcgPrintingKey(incoming);
  const next = (Array.isArray(existingPrintings) ? existingPrintings : []).map(
    (printing) => ({ ...printing })
  );
  const index = next.findIndex(
    (printing) => normalizeTcgPrintingKey(printing) === key
  );

  if (index >= 0) {
    const current = next[index];
    next[index] = {
      ...current,
      ...incoming,
      id: current.id,
      quantity:
        Math.max(1, Number(current.quantity || 1)) +
        Math.max(1, Number(incoming.quantity || 1)),
      linkedDeckIds: [
        ...new Set([
          ...(Array.isArray(current.linkedDeckIds) ? current.linkedDeckIds : []),
          ...(Array.isArray(incoming.linkedDeckIds) ? incoming.linkedDeckIds : []),
        ]),
      ],
      createdAt: current.createdAt || incoming.createdAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    next.push(incoming);
  }

  return next;
}

function getTcgCardIdentity(record = {}) {
  const providerCardId = String(record.tcg?.providerCardId || "").trim();
  if (providerCardId) return `provider:${providerCardId}`;

  const identityKey = String(record.tcg?.cardIdentityKey || "").trim().toLowerCase();
  if (identityKey) return `identity:${identityKey}`;

  const name = String(record.tcg?.cardName || record.title || record.name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return name ? `name:${name}` : "";
}

function getRecordTcgPrintings(record = {}) {
  if (Array.isArray(record.tcg?.printings) && record.tcg.printings.length) {
    return record.tcg.printings.map((printing) => makeTcgPrinting(printing));
  }

  return record.tcg ? [makeTcgPrinting(record.tcg)] : [];
}

function consolidateTcgInventoryRecords(records = []) {
  const source = Array.isArray(records) ? records : [];
  const grouped = new Map();
  const passthrough = [];

  source.forEach((record) => {
    const isTcg =
      String(record.category || "").toLowerCase() === "trading-cards" &&
      record.tcg;

    if (!isTcg) {
      passthrough.push(record);
      return;
    }

    const identity = getTcgCardIdentity(record);
    if (!identity) {
      passthrough.push(record);
      return;
    }

    if (!grouped.has(identity)) grouped.set(identity, []);
    grouped.get(identity).push(record);
  });

  const idRemap = new Map();
  const consolidated = [];

  grouped.forEach((group, identity) => {
    if (group.length === 1 && Array.isArray(group[0].tcg?.printings)) {
      consolidated.push(group[0]);
      return;
    }

    const primary = group
      .slice()
      .sort((a, b) => {
        const aCreated = new Date(a.createdAt || 0).getTime();
        const bCreated = new Date(b.createdAt || 0).getTime();
        return aCreated - bCreated;
      })[0];

    let printings = [];
    group.forEach((record) => {
      getRecordTcgPrintings(record).forEach((printing) => {
        printings = mergeTcgPrinting(printings, printing);
      });
      if (record.id !== primary.id) idRemap.set(record.id, primary.id);
    });

    const summarizedTcg = summarizeTcgPrintings(
      {
        ...(primary.tcg || {}),
        cardIdentityKey:
          primary.tcg?.cardIdentityKey ||
          identity.replace(/^(provider|identity|name):/, ""),
        cardName:
          primary.tcg?.cardName ||
          primary.title ||
          primary.name ||
          "",
      },
      printings
    );

    const captures = group
      .flatMap((record) =>
        Array.isArray(record.captures) ? record.captures : []
      )
      .slice(-12);

    const merged = {
      ...primary,
      title:
        primary.tcg?.cardName ||
        primary.title ||
        primary.name ||
        group[0]?.title ||
        "Untitled card",
      name:
        primary.tcg?.cardName ||
        primary.name ||
        primary.title ||
        group[0]?.title ||
        "Untitled card",
      tcg: summarizedTcg,
      captures,
      metadata: {
        ...(primary.metadata || {}),
        thumbnail:
          summarizedTcg.selectedArtwork ||
          primary.metadata?.thumbnail ||
          "",
      },
      poster:
        summarizedTcg.selectedArtwork ||
        primary.poster ||
        "",
      updatedAt: new Date().toISOString(),
    };

    consolidated.push(merged);
  });

  return {
    records: [...passthrough, ...consolidated],
    idRemap,
    changed:
      idRemap.size > 0 ||
      consolidated.some(
        (record) =>
          Array.isArray(record.tcg?.printings) &&
          record.tcg.printings.length > 1
      ),
  };
}

function remapDeckInventoryRecordIds(idRemap = new Map()) {
  if (!(idRemap instanceof Map) || !idRemap.size) return;

  const decks = readTcgDecks();
  let changed = false;

  decks.forEach((deck) => {
    const nextCards = [];
    const seen = new Set();

    (Array.isArray(deck.cards) ? deck.cards : []).forEach((card) => {
      const inventoryRecordId =
        idRemap.get(card.inventoryRecordId) || card.inventoryRecordId;
      const key = [
        inventoryRecordId,
        card.section || "main",
        card.cardName || "",
      ].join("|");

      if (seen.has(key)) {
        const existing = nextCards.find(
          (entry) =>
            [
              entry.inventoryRecordId,
              entry.section || "main",
              entry.cardName || "",
            ].join("|") === key
        );
        if (existing) {
          existing.quantity = Math.max(
            Number(existing.quantity || 1),
            Number(card.quantity || 1)
          );
        }
        changed = true;
        return;
      }

      seen.add(key);
      nextCards.push({
        ...card,
        inventoryRecordId,
      });

      if (inventoryRecordId !== card.inventoryRecordId) changed = true;
    });

    if (changed) {
      deck.cards = nextCards;
      deck.updatedAt = new Date().toISOString();
    }
  });

  if (changed) writeTcgDecks(decks);
}


function createLibraryRecordFromIntake({ queueItem, session, metadata, duplicateAction = "create" }) {
  const libraryId = queueItem.libraryId || "inventory";
  let records = readIntakeLibraryRecords(libraryId);

  if (libraryId === "inventory") {
    const consolidation = consolidateTcgInventoryRecords(records);
    records = consolidation.records;
    if (consolidation.idRemap.size > 0) {
      writeIntakeLibraryRecords(libraryId, records);
      remapDeckInventoryRecordIds(consolidation.idRemap);
    }
  }

  const now = new Date().toISOString();

  if (
    libraryId === "inventory" &&
    String(queueItem.inventoryCategory || "").toLowerCase() === "trading-cards" &&
    queueItem.tcg &&
    typeof queueItem.tcg === "object"
  ) {
    const incomingIdentity = String(
      queueItem.tcg.cardIdentityKey ||
      queueItem.tcg.providerCardId ||
      queueItem.tcg.cardName ||
      queueItem.title ||
      ""
    ).trim().toLowerCase();

    const existingIndex = records.findIndex((item) => {
      if (!item?.tcg) return false;
      const existingIdentity = String(
        item.tcg.cardIdentityKey ||
        item.tcg.providerCardId ||
        item.tcg.cardName ||
        item.title ||
        ""
      ).trim().toLowerCase();
      return existingIdentity && existingIdentity === incomingIdentity;
    });

    if (existingIndex >= 0) {
      const existing = records[existingIndex];
      const legacyPrintings =
        Array.isArray(existing.tcg?.printings) && existing.tcg.printings.length
          ? existing.tcg.printings
          : existing.tcg
          ? [makeTcgPrinting(existing.tcg)]
          : [];
      const printings = mergeTcgPrinting(legacyPrintings, queueItem.tcg);
      const summarizedTcg = summarizeTcgPrintings(
        {
          ...(existing.tcg || {}),
          ...(queueItem.tcg || {}),
          cardIdentityKey: incomingIdentity,
          cardName:
            queueItem.tcg.cardName ||
            existing.tcg?.cardName ||
            queueItem.title ||
            existing.title,
        },
        printings
      );

      const updated = {
        ...existing,
        title:
          queueItem.title ||
          queueItem.tcg.cardName ||
          existing.title,
        name:
          queueItem.title ||
          queueItem.tcg.cardName ||
          existing.name,
        notes: queueItem.notes || existing.notes || "",
        tcg: summarizedTcg,
        captures: [
          ...(Array.isArray(existing.captures) ? existing.captures : []),
          ...(Array.isArray(queueItem.captures) ? queueItem.captures : []),
        ].slice(-12),
        metadata: {
          ...(existing.metadata || {}),
          ...(metadata && typeof metadata === "object" ? metadata : {}),
          thumbnail:
            summarizedTcg.selectedArtwork ||
            existing.metadata?.thumbnail ||
            "",
        },
        poster:
          summarizedTcg.selectedArtwork ||
          existing.poster ||
          "",
        updatedAt: now,
      };

      records[existingIndex] = updated;
      writeIntakeLibraryRecords(libraryId, records);

      const decks = readTcgDecks();
      let decksChanged = false;
      (summarizedTcg.linkedDeckIds || []).forEach((deckId) => {
        const deck = decks.find((entry) => entry.id === deckId);
        if (!deck) return;
        if ((deck.cards || []).some((card) => card.inventoryRecordId === updated.id)) return;
        deck.cards = [
          ...(deck.cards || []),
          {
            id: makeIntakeId("deck-card"),
            inventoryRecordId: updated.id,
            providerCardId: summarizedTcg.providerCardId || "",
            cardName: summarizedTcg.cardName || updated.title,
            setCode: summarizedTcg.setCode || "",
            artwork: summarizedTcg.selectedArtwork || "",
            section: "main",
            quantity: 1,
            owned: true,
          },
        ];
        deck.updatedAt = now;
        decksChanged = true;
      });
      if (decksChanged) writeTcgDecks(decks);

      return updated;
    }

    queueItem.tcg = summarizeTcgPrintings(
      {
        ...queueItem.tcg,
        cardIdentityKey: incomingIdentity,
      },
      [makeTcgPrinting(queueItem.tcg)]
    );
  }

  const record = {
    id: queueItem.id,
    homesteadId: queueItem.id,
    libraryId,
    title: queueItem.title,
    name: queueItem.title,
    author: queueItem.author || metadata?.authors?.join?.(", ") || metadata?.author || "",
    authors: Array.isArray(queueItem.authors) && queueItem.authors.length ? queueItem.authors : (Array.isArray(metadata?.authors) ? metadata.authors : []),
    publisher: queueItem.publisher || metadata?.publisher || "",
    publishedDate: queueItem.publishedDate || metadata?.publishedDate || "",
    isbn: libraryId === "books" ? (metadata?.isbn || queueItem.code || "") : "",
    code: queueItem.code || "",
    aliases: Array.isArray(queueItem.aliases) ? queueItem.aliases : [],
    metadata: {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
      ...(queueItem.valuation ? { valuation: queueItem.valuation } : {}),
    },
    valuation: queueItem.valuation || null,
    notes: queueItem.notes || "",
    category: libraryId === "inventory" ? (queueItem.inventoryCategory || "general") : "",
    tcg: queueItem.tcg && typeof queueItem.tcg === "object" ? queueItem.tcg : null,
    captures: Array.isArray(queueItem.captures) ? queueItem.captures : [],
    captureRequirements: getCaptureRequirements(libraryId),
    source: "intake-framework",
    sourceSessionId: session?.id || queueItem.sessionId || "",
    physicalCopyOf: duplicateAction === "copy" ? queueItem.duplicateOf || "" : "",
    linkedIdentityId: queueItem.linkedIdentityId || queueItem.id || "",
    linkedDestinations: queueItem.linkedDestinations && typeof queueItem.linkedDestinations === "object" ? queueItem.linkedDestinations : { [libraryId]: true },
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = { ...records[index], ...record, createdAt: records[index].createdAt || now };
  else records.push(record);
  writeIntakeLibraryRecords(libraryId, records);
  if (libraryId === "inventory" && record.tcg && Array.isArray(record.tcg.linkedDeckIds)) {
    const decks = readTcgDecks(); let changed = false;
    decks.forEach((deck) => {
      if (!record.tcg.linkedDeckIds.includes(deck.id)) return;
      if ((deck.cards || []).some((card) => card.inventoryRecordId === record.id)) return;
      deck.cards = [...(deck.cards || []), { id: makeIntakeId("deck-card"), inventoryRecordId: record.id, providerCardId: record.tcg.providerCardId || "", cardName: record.tcg.cardName || record.title, setCode: record.tcg.setCode || "", artwork: record.tcg.selectedArtwork || record.tcg.selectedPrinting?.image || "", section: "main", quantity: 1, owned: true }];
      deck.updatedAt = new Date().toISOString(); changed = true;
    });
    if (changed) writeTcgDecks(decks);
  }
  return record;
}

function readIntakeCollection(filePath) {
  const value = readJsonFile(filePath, []);
  return Array.isArray(value) ? value : [];
}

function makeIntakeId(prefix = "intake") {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

function sanitizeIntakeCapture(capture = {}, index = 0) {
  const dataUrl = String(capture?.dataUrl || "");
  return {
    id: String(capture?.id || makeIntakeId("capture")),
    name: String(capture?.name || `capture-${index + 1}.jpg`).slice(0, 240),
    type: String(capture?.type || "image/jpeg").slice(0, 120),
    size: Math.max(0, Number(capture?.size || 0)),
    dataUrl: /^data:image\//i.test(dataUrl) ? dataUrl : "",
  };
}

function isValidIsbn10(value = "") {
  const clean = String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (!/^\d{9}[\dX]$/.test(clean)) return false;
  const sum = [...clean].reduce((total, character, index) => {
    const digit = character === "X" ? 10 : Number(character);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function classifyIntakeCode(rawCode = "", requestedLibrary = "") {
  const code = String(rawCode || "").trim().replace(/\s+/g, "");
  const upper = code.toUpperCase();
  if (/^(HS|HOMESTEAD)[:\-]/.test(upper)) return { codeType: "homestead-qr", libraryId: requestedLibrary || "inventory" };
  if (/^97[89]\d{10}$/.test(code)) return { codeType: "isbn", libraryId: "books" };
  if (/^\d{9}[\dX]$/i.test(code) && isValidIsbn10(code)) return { codeType: "isbn", libraryId: "books" };
  if (/^\d{10}$/.test(code)) return { codeType: "isbn-or-upc", libraryId: requestedLibrary === "books" ? "books" : "inventory" };
  if (/^\d{8}$/.test(code)) return { codeType: "ean-8", libraryId: requestedLibrary || "inventory" };
  if (/^\d{12}$/.test(code)) return { codeType: "upc-a", libraryId: requestedLibrary || "inventory" };
  if (/^\d{13}$/.test(code)) return { codeType: "ean-13", libraryId: requestedLibrary || "inventory" };
  if (/^\d{14}$/.test(code)) return { codeType: "gtin-14", libraryId: requestedLibrary || "inventory" };
  if (/^https?:\/\//i.test(code)) return { codeType: "url-or-qr", libraryId: requestedLibrary || "inventory" };
  return { codeType: "unknown", libraryId: requestedLibrary || "inventory" };
}

function normalizeIntakeIdentityValue(value = "") {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function looksLikeScannableIntakeCode(value = "") {
  const clean = String(value || "").trim().replace(/\s+/g, "");
  return /^(?:\d{8}|\d{10}|\d{12,14}|(?:HS|HOMESTEAD)[:\-].+|https?:\/\/.+)$/i.test(clean);
}

function getIntakeItemCode(item = {}) {
  const candidates = [
    item.code,
    item.resolution?.code,
    item.identity?.value,
    ...(Array.isArray(item.aliases) ? item.aliases : []),
  ];
  const direct = candidates.find((value) => normalizeIntakeIdentityValue(value));
  if (direct) return String(direct).trim().replace(/\s+/g, "");
  return looksLikeScannableIntakeCode(item.title) ? String(item.title).trim().replace(/\s+/g, "") : "";
}

function findIntakeIdentity(code = "") {
  const normalized = normalizeIntakeIdentityValue(code);
  if (!normalized) return null;

  const storedIdentity = readIntakeCollection(intakeIdentitiesPath).find((identity) =>
    normalizeIntakeIdentityValue(identity?.value) === normalized ||
    (Array.isArray(identity?.aliases) && identity.aliases.some((alias) => normalizeIntakeIdentityValue(alias) === normalized))
  );
  if (storedIdentity) return storedIdentity;

  // Backward-compatible recovery: early Intake Framework builds saved the scanned
  // value as the activity title but did not always persist item.code/identities.json.
  // Resolve those queue rows as identities so rescanning cannot create duplicates.
  const activity = readIntakeCollection(activityDataPath).find((item) =>
    normalizeIntakeIdentityValue(getIntakeItemCode(item)) === normalized
  );
  if (!activity) return null;

  return {
    value: getIntakeItemCode(activity),
    type: activity.resolution?.codeType || classifyIntakeCode(code, activity.libraryId).codeType,
    homesteadId: activity.id,
    libraryId: activity.libraryId || "inventory",
    record: {
      id: activity.id,
      title: activity.title || code,
      name: activity.title || code,
      status: activity.status || "queued",
    },
    recoveredFromActivity: true,
  };
}

function updateStoredIntakeSession(sessionId, patch = {}) {
  const sessions = readIntakeCollection(intakeSessionsPath);
  const index = sessions.findIndex((item) => item.id === sessionId);
  if (index < 0) return null;
  const next = {
    ...sessions[index],
    ...patch,
    id: sessions[index].id,
    updatedAt: new Date().toISOString(),
  };
  sessions[index] = next;
  writeJsonFile(intakeSessionsPath, sessions.slice(-500));
  return next;
}

app.post("/api/intake/sessions", (req, res) => {
  try {
    const sessions = readIntakeCollection(intakeSessionsPath);
    const now = new Date().toISOString();
    const session = {
      id: makeIntakeId("session"),
      status: "waiting",
      source: String(req.body?.source || "universal-add"),
      requestedLibrary: String(req.body?.requestedLibrary || "inventory"),
      libraryId: String(req.body?.requestedLibrary || "inventory"),
      device: req.body?.device && typeof req.body.device === "object" ? req.body.device : {},
      code: "",
      resolution: null,
      captures: [],
      createdAt: now,
      updatedAt: now,
    };
    sessions.push(session);
    writeJsonFile(intakeSessionsPath, sessions.slice(-500));
    res.status(201).json({ ok: true, session });
  } catch (error) {
    console.error("Unable to create intake session:", error);
    res.status(500).json({ ok: false, message: error.message || "Unable to create intake session." });
  }
});

app.get("/api/intake/sessions/:sessionId", (req, res) => {
  const session = readIntakeCollection(intakeSessionsPath).find((item) => item.id === req.params.sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Intake session not found." });
  res.json({ ok: true, session });
});

app.patch("/api/intake/sessions/:sessionId", (req, res) => {
  try {
    const allowed = ["status", "source", "requestedLibrary", "libraryId", "code", "resolution", "captures", "metadata", "notes"];
    const patch = {};
    allowed.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) patch[key] = req.body[key];
    });
    if (Array.isArray(patch.captures)) {
      patch.captures = patch.captures.map(({ dataUrl, ...capture }) => capture).slice(0, 20);
    }
    const session = updateStoredIntakeSession(req.params.sessionId, patch);
    if (!session) return res.status(404).json({ ok: false, message: "Intake session not found." });
    res.json({ ok: true, session });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to update intake session." });
  }
});

app.post("/api/intake/resolve", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().replace(/\s+/g, "");
    if (!code) return res.status(400).json({ ok: false, message: "Scan or enter a code first." });
    const identity = findIntakeIdentity(code);
    const classification = classifyIntakeCode(code, String(req.body?.requestedLibrary || ""));
    const metadata = identity ? null : await lookupIntakeMetadata(code, classification.codeType, classification.libraryId);
    const result = identity
      ? {
          existing: true,
          code,
          codeType: identity.type || classification.codeType,
          libraryId: identity.libraryId || classification.libraryId,
          homesteadId: identity.homesteadId,
          record: identity.record || null,
        }
      : {
          existing: false,
          code,
          ...classification,
          metadata,
          suggestedTitle: metadata?.title || (classification.codeType === "isbn" ? "New book" : classification.codeType.startsWith("upc") || classification.codeType.startsWith("ean") ? "New scanned item" : "New item"),
        };
    if (req.body?.sessionId) updateStoredIntakeSession(String(req.body.sessionId), { status: "resolved", code, resolution: result, libraryId: result.libraryId });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to resolve code." });
  }
});

function getActivityItems() {
  return readIntakeCollection(activityDataPath).map((item) => ({
    activityType: item.activityType || "intake",
    ...item,
    code: getIntakeItemCode(item),
  }));
}

function getNeedsAttentionCount(items = []) {
  return items.filter((item) => ["queued", "pending", "needs-attention", "failed"].includes(String(item?.status || "queued"))).length;
}

app.get("/api/activity", (req, res) => {
  const items = getActivityItems().slice().reverse();
  const needsAttentionCount = getNeedsAttentionCount(items);
  if (String(req.query?.summary || "") === "1") return res.json({ ok: true, count: items.length, needsAttentionCount });
  res.json({ ok: true, count: items.length, needsAttentionCount, items });
});

app.patch("/api/activity/:activityId", (req, res) => {
  try {
    const items = getActivityItems();
    const index = items.findIndex((item) => item.id === req.params.activityId);
    if (index < 0) return res.status(404).json({ ok: false, message: "Activity not found." });
    const allowedStatuses = new Set(["queued", "pending", "matched", "needs-attention", "completed", "failed", "cancelled"]);
    const nextStatus = String(req.body?.status || items[index].status || "queued");
    if (!allowedStatuses.has(nextStatus)) return res.status(400).json({ ok: false, message: "Unsupported activity status." });
    items[index] = { ...items[index], status: nextStatus, updatedAt: new Date().toISOString() };
    writeJsonFile(activityDataPath, items.slice(-2000));
    res.json({ ok: true, item: items[index], needsAttentionCount: getNeedsAttentionCount(items) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to update activity." });
  }
});


app.delete("/api/activity/:activityId", (req, res) => {
  try {
    const items = readIntakeCollection(activityDataPath);
    const next = items.filter((item) => item.id !== req.params.activityId);
    if (next.length === items.length) return res.status(404).json({ ok: false, message: "Activity not found." });
    writeJsonFile(activityDataPath, next.slice(-2000));
    res.json({ ok: true, removedId: req.params.activityId, needsAttentionCount: getNeedsAttentionCount(next) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to remove activity." });
  }
});

app.post("/api/activity/cleanup-completed", (req, res) => {
  try {
    const items = readIntakeCollection(activityDataPath);
    const next = items.filter((item) => String(item?.status || "") !== "completed");
    writeJsonFile(activityDataPath, next.slice(-2000));
    res.json({ ok: true, removedCount: items.length - next.length, needsAttentionCount: getNeedsAttentionCount(next) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to clear completed activity." });
  }
});

app.get("/api/intake/library-records/:libraryId", (req, res) => {
  const libraryId = String(req.params.libraryId || "inventory");
  let records = readIntakeLibraryRecords(libraryId);

  if (libraryId === "inventory") {
    const result = consolidateTcgInventoryRecords(records);
    records = result.records;

    if (result.idRemap.size > 0) {
      writeIntakeLibraryRecords(libraryId, records);
      remapDeckInventoryRecordIds(result.idRemap);
    }
  }

  const responseRecords = records.slice().reverse();
  res.json({
    ok: true,
    count: responseRecords.length,
    records: responseRecords,
  });
});

app.get("/api/intake/library-records/:libraryId/:recordId", (req, res) => {
  const record = readIntakeLibraryRecords(req.params.libraryId).find((item) => item.id === req.params.recordId);
  if (!record) return res.status(404).json({ ok: false, message: "Library record not found." });
  res.json({ ok: true, record });
});

app.patch("/api/intake/library-records/:libraryId/:recordId", express.json({ limit: "2mb" }), (req, res) => {
  try {
    const libraryId = String(req.params.libraryId || "").trim();
    const recordId = String(req.params.recordId || "").trim();
    const records = readIntakeLibraryRecords(libraryId);
    const index = records.findIndex((item) => item.id === recordId);

    if (index < 0) {
      return res.status(404).json({ ok: false, message: "Library record not found." });
    }

    const current = records[index];
    const incomingTcg = req.body?.tcg && typeof req.body.tcg === "object" ? req.body.tcg : null;
    const nextLocation =
      incomingTcg?.location !== undefined
        ? String(incomingTcg.location || "").trim()
        : req.body?.location !== undefined
        ? String(req.body.location || "").trim()
        : current.tcg?.location || current.location || "";

    const nextTcg = incomingTcg
      ? {
          ...(current.tcg || {}),
          ...(incomingTcg.location !== undefined ? { location: nextLocation } : {}),
          ...(incomingTcg.binder !== undefined ? { binder: String(incomingTcg.binder || "").trim() } : {}),
          ...(incomingTcg.binderId !== undefined ? { binderId: String(incomingTcg.binderId || "").trim() } : {}),
          ...(incomingTcg.page !== undefined ? { page: String(incomingTcg.page || "").trim() } : {}),
          ...(incomingTcg.pocket !== undefined ? { pocket: String(incomingTcg.pocket || "").trim() } : {}),
          ...(incomingTcg.condition !== undefined ? { condition: String(incomingTcg.condition || "").trim() } : {}),
          ...(incomingTcg.quantity !== undefined ? { quantity: Math.max(1, Number(incomingTcg.quantity || 1)) } : {}),
          ...(incomingTcg.selectedArtwork !== undefined ? { selectedArtwork: String(incomingTcg.selectedArtwork || "") } : {}),
          ...(incomingTcg.selectedArtworkId !== undefined ? { selectedArtworkId: String(incomingTcg.selectedArtworkId || "") } : {}),
          ...(incomingTcg.artworkVariants !== undefined ? { artworkVariants: Array.isArray(incomingTcg.artworkVariants) ? incomingTcg.artworkVariants : [] } : {}),
          ...(incomingTcg.linkedDeckIds !== undefined ? { linkedDeckIds: Array.isArray(incomingTcg.linkedDeckIds) ? incomingTcg.linkedDeckIds.map(String) : [] } : {}),
          ...(incomingTcg.selectedPrinting !== undefined ? { selectedPrinting: { ...(current.tcg?.selectedPrinting || {}), ...(incomingTcg.selectedPrinting || {}) } } : {}),
        }
      : current.tcg;

    const previousLocation = current.tcg?.location || current.location || "";
    const updated = {
      ...current,
      ...(req.body?.title !== undefined ? { title: String(req.body.title || "").trim() || current.title } : {}),
      ...(req.body?.notes !== undefined ? { notes: String(req.body.notes || "").trim() } : {}),
      ...(req.body?.location !== undefined || incomingTcg?.location !== undefined ? { location: nextLocation } : {}),
      ...(nextTcg ? { tcg: nextTcg } : {}),
      ...(nextTcg?.selectedArtwork ? { metadata: { ...(current.metadata || {}), thumbnail: nextTcg.selectedArtwork, image: nextTcg.selectedArtwork }, poster: nextTcg.selectedArtwork } : {}),
      updatedAt: new Date().toISOString(),
    };

    records[index] = updated;
    writeIntakeLibraryRecords(libraryId, records);

    if (previousLocation !== nextLocation) {
      const activity = readIntakeCollection(activityDataPath);
      const now = new Date().toISOString();
      activity.push({
        id: makeIntakeId("activity"),
        activityType: "inventory-location-update",
        status: "completed",
        libraryId,
        title: updated.title || updated.name || "Inventory item",
        linkedRecord: { id: updated.id, libraryId },
        message: previousLocation
          ? `Moved from ${previousLocation} to ${nextLocation || "Unassigned"}.`
          : `Location set to ${nextLocation || "Unassigned"}.`,
        createdAt: now,
        updatedAt: now,
      });
      writeJsonFile(activityDataPath, activity.slice(-2000));
    }

    return res.json({ ok: true, record: updated });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Unable to update inventory item.",
    });
  }
});

app.patch(
  "/api/intake/library-records/inventory/:recordId/printings/:printingId",
  express.json({ limit: "2mb" }),
  (req, res) => {
    try {
      const recordId = String(req.params.recordId || "").trim();
      const printingId = String(req.params.printingId || "").trim();
      const records = readIntakeLibraryRecords("inventory");
      const recordIndex = records.findIndex((record) => record.id === recordId);

      if (recordIndex < 0) {
        return res.status(404).json({
          ok: false,
          message: "Inventory record not found.",
        });
      }

      const current = records[recordIndex];
      const printings = Array.isArray(current.tcg?.printings)
        ? current.tcg.printings.map((printing) => ({ ...printing }))
        : [];

      const printingIndex = printings.findIndex(
        (printing) => printing.id === printingId
      );

      if (printingIndex < 0) {
        return res.status(404).json({
          ok: false,
          message: "Physical printing not found.",
        });
      }

      const incoming = req.body && typeof req.body === "object"
        ? req.body
        : {};
      const binderId = String(incoming.binderId ?? printings[printingIndex].binderId ?? "");
      const binder = readTcgBinders().find((entry) => entry.id === binderId);

      printings[printingIndex] = {
        ...printings[printingIndex],
        ...(incoming.setCode !== undefined
          ? { setCode: normalizeYugiohSetCode(incoming.setCode || "") }
          : {}),
        ...(incoming.rarity !== undefined
          ? { rarity: String(incoming.rarity || "").trim() }
          : {}),
        ...(incoming.edition !== undefined
          ? { edition: String(incoming.edition || "").trim() }
          : {}),
        ...(incoming.condition !== undefined
          ? { condition: String(incoming.condition || "").trim() }
          : {}),
        ...(incoming.language !== undefined
          ? { language: String(incoming.language || "").trim() }
          : {}),
        ...(incoming.quantity !== undefined
          ? { quantity: Math.max(1, Number(incoming.quantity || 1)) }
          : {}),
        ...(incoming.purchasePrice !== undefined
          ? { purchasePrice: Math.max(0, Number(incoming.purchasePrice || 0)) }
          : {}),
        ...(incoming.marketValue !== undefined
          ? { marketValue: Math.max(0, Number(incoming.marketValue || 0)) }
          : {}),
        ...(incoming.printingPrice !== undefined
          ? { printingPrice: Math.max(0, Number(incoming.printingPrice || 0)) }
          : {}),
        ...(incoming.genericPrice !== undefined
          ? { genericPrice: Math.max(0, Number(incoming.genericPrice || 0)) }
          : {}),
        ...(incoming.priceSource !== undefined
          ? { priceSource: String(incoming.priceSource || "").trim() }
          : {}),
        ...(incoming.priceSourceType !== undefined
          ? { priceSourceType: String(incoming.priceSourceType || "").trim() }
          : {}),
        ...(incoming.selectedArtwork !== undefined
          ? { selectedArtwork: String(incoming.selectedArtwork || "") }
          : {}),
        ...(incoming.selectedArtworkId !== undefined
          ? { selectedArtworkId: String(incoming.selectedArtworkId || "") }
          : {}),
        ...(incoming.binderId !== undefined
          ? {
              binderId,
              binder: binder?.name || "",
              location: binder?.location || "",
            }
          : {}),
        ...(incoming.page !== undefined
          ? { page: String(incoming.page || "").trim() }
          : {}),
        ...(incoming.pocket !== undefined
          ? { pocket: String(incoming.pocket || "").trim() }
          : {}),
        updatedAt: new Date().toISOString(),
      };

      const summarizedTcg = summarizeTcgPrintings(
        current.tcg || {},
        printings
      );

      const updated = {
        ...current,
        tcg: summarizedTcg,
        metadata: {
          ...(current.metadata || {}),
          thumbnail:
            summarizedTcg.selectedArtwork ||
            current.metadata?.thumbnail ||
            "",
        },
        poster:
          summarizedTcg.selectedArtwork ||
          current.poster ||
          "",
        updatedAt: new Date().toISOString(),
      };

      records[recordIndex] = updated;
      writeIntakeLibraryRecords("inventory", records);

      return res.json({
        ok: true,
        record: updated,
        printing: printings[printingIndex],
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: error.message || "Unable to update physical printing.",
      });
    }
  }
);

app.delete(
  "/api/intake/library-records/inventory/:recordId/printings/:printingId",
  (req, res) => {
    try {
      const recordId = String(req.params.recordId || "").trim();
      const printingId = String(req.params.printingId || "").trim();
      const records = readIntakeLibraryRecords("inventory");
      const recordIndex = records.findIndex((record) => record.id === recordId);

      if (recordIndex < 0) {
        return res.status(404).json({
          ok: false,
          message: "Inventory record not found.",
        });
      }

      const current = records[recordIndex];
      const printings = Array.isArray(current.tcg?.printings)
        ? current.tcg.printings
        : [];
      const removed = printings.find((printing) => printing.id === printingId);
      const remaining = printings.filter(
        (printing) => printing.id !== printingId
      );

      if (!removed) {
        return res.status(404).json({
          ok: false,
          message: "Physical printing not found.",
        });
      }

      if (!remaining.length) {
        records.splice(recordIndex, 1);
        writeIntakeLibraryRecords("inventory", records);

        const decks = readTcgDecks();
        let decksChanged = false;
        decks.forEach((deck) => {
          const before = Array.isArray(deck.cards) ? deck.cards.length : 0;
          deck.cards = (Array.isArray(deck.cards) ? deck.cards : []).filter(
            (card) => card.inventoryRecordId !== recordId
          );
          if (deck.cards.length !== before) {
            deck.updatedAt = new Date().toISOString();
            decksChanged = true;
          }
        });
        if (decksChanged) writeTcgDecks(decks);

        return res.json({
          ok: true,
          recordDeleted: true,
          removed,
        });
      }

      const summarizedTcg = summarizeTcgPrintings(
        current.tcg || {},
        remaining
      );
      const updated = {
        ...current,
        tcg: summarizedTcg,
        metadata: {
          ...(current.metadata || {}),
          thumbnail:
            summarizedTcg.selectedArtwork ||
            current.metadata?.thumbnail ||
            "",
        },
        poster:
          summarizedTcg.selectedArtwork ||
          current.poster ||
          "",
        updatedAt: new Date().toISOString(),
      };

      records[recordIndex] = updated;
      writeIntakeLibraryRecords("inventory", records);

      return res.json({
        ok: true,
        recordDeleted: false,
        record: updated,
        removed,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: error.message || "Unable to delete physical printing.",
      });
    }
  }
);

app.delete("/api/intake/library-records/:libraryId/:recordId", (req, res) => {
  try {
    const libraryId = String(req.params.libraryId || "").trim();
    const recordId = String(req.params.recordId || "").trim();
    const records = readIntakeLibraryRecords(libraryId);
    const index = records.findIndex((item) => item.id === recordId);

    if (index < 0) {
      return res.status(404).json({
        ok: false,
        message: "Library record not found.",
      });
    }

    const [removed] = records.splice(index, 1);
    writeIntakeLibraryRecords(libraryId, records);

    if (libraryId === "inventory" && removed?.tcg) {
      const decks = readTcgDecks();
      let decksChanged = false;

      decks.forEach((deck) => {
        const before = Array.isArray(deck.cards) ? deck.cards.length : 0;
        deck.cards = (Array.isArray(deck.cards) ? deck.cards : []).filter(
          (card) => card.inventoryRecordId !== recordId
        );
        if (deck.cards.length !== before) {
          deck.updatedAt = new Date().toISOString();
          decksChanged = true;
        }
      });

      if (decksChanged) writeTcgDecks(decks);
    }

    const activity = readIntakeCollection(activityDataPath);
    const now = new Date().toISOString();
    activity.push({
      id: makeIntakeId("activity"),
      activityType: "inventory-delete",
      status: "completed",
      libraryId,
      title: removed?.title || removed?.name || "Inventory item",
      message: "Inventory record deleted.",
      createdAt: now,
      updatedAt: now,
    });
    writeJsonFile(activityDataPath, activity.slice(-2000));

    return res.json({
      ok: true,
      removed,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Unable to delete inventory item.",
    });
  }
});

app.post("/api/activity/:activityId/retry", async (req, res) => {
  try {
    const items = getActivityItems();
    const index = items.findIndex((item) => item.id === req.params.activityId);
    if (index < 0) return res.status(404).json({ ok: false, message: "Activity not found." });
    const item = items[index];
    const metadata = item.resolution?.metadata || await lookupIntakeMetadata(item.code, item.resolution?.codeType, item.libraryId);
    const record = createLibraryRecordFromIntake({ queueItem: item, session: { id: item.sessionId }, metadata, duplicateAction: item.activityType === "physical-copy" ? "copy" : "create" });
    items[index] = { ...item, status: "completed", linkedRecord: { id: record.id, libraryId: record.libraryId }, resolution: { ...(item.resolution || {}), metadata }, updatedAt: new Date().toISOString(), error: "" };
    writeJsonFile(activityDataPath, items.slice(-2000));
    res.json({ ok: true, item: items[index], record, needsAttentionCount: getNeedsAttentionCount(items) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to retry activity." });
  }
});

app.get("/api/activity/:activityId/label", (req, res) => {
  const item = getActivityItems().find((activity) => activity.id === req.params.activityId);
  if (!item) return res.status(404).json({ ok: false, message: "Activity not found." });
  res.json({ ok: true, label: { title: item.title || item.code || "Homestead item", code: item.code || item.id, homesteadId: item.linkedRecord?.id || item.id, libraryId: item.libraryId || "inventory", qrValue: `HOMESTEAD:${item.linkedRecord?.id || item.id}` } });
});

app.get("/api/intake/queue", (req, res) => {
  const items = getActivityItems();
  res.json({ ok: true, count: items.length, items: items.slice().reverse() });
});

app.post("/api/intake/sessions/:sessionId/complete", express.json({ limit: "48mb" }), (req, res) => {
  try {
    const sessions = readIntakeCollection(intakeSessionsPath);
    let session = sessions.find((item) => item.id === req.params.sessionId);
    if (!session && req.params.sessionId === "new") {
      const now = new Date().toISOString();
      session = { id: makeIntakeId("session"), status: "waiting", source: "fallback", device: {}, createdAt: now, updatedAt: now };
      sessions.push(session);
      writeJsonFile(intakeSessionsPath, sessions.slice(-500));
    }
    if (!session) return res.status(404).json({ ok: false, message: "Intake session not found." });

    const now = new Date().toISOString();
    const title = String(req.body?.title || "").trim();
    const codeCandidate =
      req.body?.code ||
      req.body?.resolution?.code ||
      session.code ||
      session.resolution?.code ||
      (looksLikeScannableIntakeCode(title) ? title : "");
    const code = String(codeCandidate || "").trim().replace(/\s+/g, "");
    const libraryId = String(req.body?.libraryId || session.libraryId || session.requestedLibrary || "inventory");
    const captures = Array.isArray(req.body?.captures) ? req.body.captures.slice(0, 12).map(sanitizeIntakeCapture) : [];
    const queue = readIntakeCollection(intakeQueuePath);
    const existingIdentity = code ? findIntakeIdentity(code) : null;
    const duplicateAction = String(req.body?.duplicateAction || "create");

    if (existingIdentity && !["update", "copy"].includes(duplicateAction)) {
      return res.status(409).json({
        ok: false,
        message: "This code is already linked to an existing Homestead item.",
        existing: {
          existing: true,
          code,
          codeType: existingIdentity.type || classifyIntakeCode(code, libraryId).codeType,
          libraryId: existingIdentity.libraryId || libraryId,
          homesteadId: existingIdentity.homesteadId,
          record: existingIdentity.record || null,
        },
      });
    }

    const homesteadId = duplicateAction === "update" && existingIdentity ? existingIdentity.homesteadId : makeIntakeId(libraryId || "item");
    const queueItem = {
      id: homesteadId,
      sessionId: session.id,
      status: duplicateAction === "update" ? "pending" : "queued",
      activityType: duplicateAction === "update" ? "duplicate-update" : duplicateAction === "copy" ? "physical-copy" : "intake",
      duplicateOf: existingIdentity?.homesteadId || "",
      libraryId,
      title: title || req.body?.resolution?.metadata?.title || req.body?.resolution?.suggestedTitle || "Untitled intake item",
      author: String(req.body?.author || "").trim(),
      authors: Array.isArray(req.body?.authors) ? req.body.authors.map((value) => String(value || "").trim()).filter(Boolean) : [],
      publisher: String(req.body?.publisher || "").trim(),
      publishedDate: String(req.body?.publishedDate || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      valuation: req.body?.valuation && typeof req.body.valuation === "object" ? req.body.valuation : null,
      tcg: req.body?.tcg && typeof req.body.tcg === "object" ? {
        game: String(req.body.tcg.game || "yugioh"),
        cardName: String(req.body.tcg.cardName || title || "").trim(),
        setCode: normalizeYugiohSetCode(req.body.tcg.setCode || ""),
        rarity: String(req.body.tcg.rarity || "").trim(),
        edition: String(req.body.tcg.edition || "Unlimited"),
        condition: String(req.body.tcg.condition || "Near Mint"),
        language: String(req.body.tcg.language || "English"),
        quantity: Math.max(1, Number(req.body.tcg.quantity || 1)),
        purchasePrice: Math.max(0, Number(req.body.tcg.purchasePrice || 0)),
        marketValue: Math.max(0, Number(req.body.tcg.marketValue || 0)),
        provider: String(req.body.tcg.provider || "manual"),
        providerCardId: String(req.body.tcg.providerCardId || ""),
        cardIdentityKey: String(
          req.body.tcg.cardIdentityKey ||
          req.body.tcg.providerCardId ||
          req.body.tcg.cardName ||
          title ||
          ""
        ).trim().toLowerCase(),
        selectedPrinting:
          req.body.tcg.selectedPrinting &&
          typeof req.body.tcg.selectedPrinting === "object"
            ? req.body.tcg.selectedPrinting
            : null,
        selectedArtwork: String(
          req.body.tcg.selectedArtwork ||
          req.body.tcg.selectedPrinting?.image ||
          ""
        ),
        selectedArtworkId: String(
          req.body.tcg.selectedArtworkId || ""
        ),
        artworkVariants: Array.isArray(req.body.tcg.artworkVariants)
          ? req.body.tcg.artworkVariants
          : [],
        printingPrice: Math.max(
          0,
          Number(req.body.tcg.printingPrice || 0)
        ),
        genericPrice: Math.max(
          0,
          Number(req.body.tcg.genericPrice || 0)
        ),
        priceSource: String(
          req.body.tcg.priceSource ||
          req.body.tcg.provider ||
          "manual"
        ),
        priceSourceType: String(
          req.body.tcg.priceSourceType || ""
        ),
        priceDifferenceWarning: Boolean(
          req.body.tcg.priceDifferenceWarning
        ),
        binderId: String(req.body.tcg.binderId || "").trim(),
        binder: String(req.body.tcg.binder || "").trim(),
        page: String(req.body.tcg.page || "").trim(),
        pocket: String(req.body.tcg.pocket || "").trim(),
        location: String(req.body.tcg.location || "").trim(),
        linkedDeckIds: Array.isArray(req.body.tcg.linkedDeckIds)
          ? [...new Set(req.body.tcg.linkedDeckIds.map(String))]
          : [],
        lastPriceRefresh: now,
        priceHistory: [{
          at: now,
          provider: String(
            req.body.tcg.priceSource ||
            req.body.tcg.provider ||
            "manual"
          ),
          marketValue: Math.max(
            0,
            Number(req.body.tcg.marketValue || 0)
          ),
          printingPrice: Math.max(
            0,
            Number(req.body.tcg.printingPrice || 0)
          ),
          genericPrice: Math.max(
            0,
            Number(req.body.tcg.genericPrice || 0)
          ),
          setCode: normalizeYugiohSetCode(
            req.body.tcg.setCode || ""
          ),
          rarity: String(req.body.tcg.rarity || "").trim(),
        }],
      } : null,
      inventoryCategory: String(req.body?.inventoryCategory || "general").trim().toLowerCase(),
      code,
      aliases: code ? [code] : [],
      linkedDestinations: req.body?.destinations && typeof req.body.destinations === "object" ? req.body.destinations : { [libraryId]: true },
      resolution: req.body?.resolution || session.resolution || null,
      captures,
      device: session.device || {},
      createdAt: now,
      updatedAt: now,
    };
    let linkedRecord = null;
    let linkedRecords = [];
    let adapterError = "";
    if (duplicateAction !== "update") {
      try {
        const metadata = req.body?.metadata || req.body?.resolution?.metadata || session.resolution?.metadata || null;
        const destinations = req.body?.destinations && typeof req.body.destinations === "object" ? req.body.destinations : { [libraryId]: true };
        const requestedLibraries = Object.entries(destinations).filter(([, enabled]) => Boolean(enabled)).map(([id]) => id);
        if (!requestedLibraries.length) requestedLibraries.push(libraryId);
        for (const destinationLibrary of requestedLibraries) {
          const destinationItem = { ...queueItem, id: destinationLibrary === libraryId ? queueItem.id : makeIntakeId(destinationLibrary), libraryId: destinationLibrary, linkedIdentityId: homesteadId, linkedDestinations: destinations };
          const record = createLibraryRecordFromIntake({ queueItem: destinationItem, session, metadata, duplicateAction });
          linkedRecords.push(record);
        }
        linkedRecord = linkedRecords.find((record) => record.libraryId === libraryId) || linkedRecords[0] || null;
        if (libraryId === "books" && req.body?.selectedDigitalSource && linkedRecord) {
          const digitalEdition = importSelectedBookFile(req.body.selectedDigitalSource, linkedRecord);
          const bookRecords = readIntakeLibraryRecords("books");
          const bookIndex = bookRecords.findIndex((record) => record.id === linkedRecord.id);
          if (bookIndex >= 0) {
            bookRecords[bookIndex] = { ...bookRecords[bookIndex], digitalEditions: [...(Array.isArray(bookRecords[bookIndex].digitalEditions) ? bookRecords[bookIndex].digitalEditions : []), digitalEdition], updatedAt: now };
            writeIntakeLibraryRecords("books", bookRecords);
            linkedRecord = bookRecords[bookIndex];
            linkedRecords = linkedRecords.map((record) => record.id === linkedRecord.id ? linkedRecord : record);
          }
          queueItem.digitalEdition = digitalEdition;
        }
        queueItem.status = "completed";
        queueItem.linkedRecord = linkedRecord ? { id: linkedRecord.id, libraryId: linkedRecord.libraryId } : null;
        queueItem.linkedRecords = linkedRecords.map((record) => ({ id: record.id, libraryId: record.libraryId }));
      } catch (error) {
        adapterError = error.message || "Library adapter failed.";
        queueItem.status = "needs-attention";
        queueItem.error = adapterError;
      }
    }
    queue.push(queueItem);
    writeJsonFile(intakeQueuePath, queue.slice(-2000));

    let updatedExistingIdentity = null;
    if (duplicateAction === "update" && existingIdentity) {
      const identities = readIntakeCollection(intakeIdentitiesPath);
      const normalized = code.toLowerCase();
      const identityIndex = identities.findIndex((item) => {
        const values = [item?.value, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
          .filter(Boolean)
          .map((value) => String(value).trim().toLowerCase());
        return values.includes(normalized) || item?.homesteadId === existingIdentity.homesteadId;
      });
      if (identityIndex >= 0) {
        const previous = identities[identityIndex] || {};
        const previousRecord = previous.record && typeof previous.record === "object" ? previous.record : {};
        const updates = Array.isArray(previousRecord.updates) ? previousRecord.updates : [];
        const updateEntry = {
          activityId: queueItem.id,
          notes: queueItem.notes,
          captures: captures.map(({ dataUrl, ...capture }) => capture),
          createdAt: now,
        };
        identities[identityIndex] = {
          ...previous,
          libraryId: previous.libraryId || libraryId,
          aliases: [...new Set([...(Array.isArray(previous.aliases) ? previous.aliases : []), code].filter(Boolean))],
          record: {
            ...previousRecord,
            id: previousRecord.id || existingIdentity.homesteadId,
            title: previousRecord.title || queueItem.title,
            name: previousRecord.name || queueItem.title,
            notes: queueItem.notes || previousRecord.notes || "",
            captures: [...(Array.isArray(previousRecord.captures) ? previousRecord.captures : []), ...captures.map(({ dataUrl, ...capture }) => capture)].slice(-40),
            updates: [...updates, updateEntry].slice(-100),
            updatedAt: now,
          },
          updatedAt: now,
        };
        updatedExistingIdentity = identities[identityIndex];
        writeJsonFile(intakeIdentitiesPath, identities.slice(-10000));
      }
    }

    if (code && !existingIdentity) {
      const identities = readIntakeCollection(intakeIdentitiesPath);
      const normalized = code.toLowerCase();
      const identity = {
        value: code,
        aliases: [code],
        type: queueItem.resolution?.codeType || classifyIntakeCode(code, libraryId).codeType,
        homesteadId,
        libraryId,
        record: { id: homesteadId, title: queueItem.title, name: queueItem.title, status: queueItem.status, linkedRecord: queueItem.linkedRecord || null, metadata: req.body?.resolution?.metadata || null },
        updatedAt: now,
      };
      const existingIndex = identities.findIndex((item) => String(item?.value || "").toLowerCase() === normalized);
      if (existingIndex >= 0) identities[existingIndex] = identity;
      else identities.push(identity);
      writeJsonFile(intakeIdentitiesPath, identities.slice(-10000));
    }

    const completed = updateStoredIntakeSession(session.id, { status: "complete", libraryId, code, title: queueItem.title, queueItemId: homesteadId, captures: captures.map(({ dataUrl, ...capture }) => capture), completedAt: now }) || { ...session, status: "complete", queueItemId: homesteadId };
    res.json({
      ok: true,
      session: completed,
      item: queueItem,
      record: linkedRecord,
      records: linkedRecords,
      existingItem: updatedExistingIdentity ? { homesteadId: updatedExistingIdentity.homesteadId, record: updatedExistingIdentity.record } : null,
      message: duplicateAction === "update"
        ? "Photos and notes attached to the existing item and logged in Activity Center."
        : adapterError
          ? `Intake saved, but the ${libraryId} adapter needs attention: ${adapterError}`
          : duplicateAction === "copy"
            ? "Physical copy created and linked to the Activity Center."
            : linkedRecords.length > 1
              ? `Created linked records in ${linkedRecords.map((record) => record.libraryId).join(" and ")} and completed the intake activity.`
              : queueItem.digitalEdition
                ? `Created the ${libraryId} record, imported the ${queueItem.digitalEdition.format} edition, and completed the intake activity.`
                : `Created the ${libraryId} record and completed the intake activity.`,
    });
  } catch (error) {
    console.error("Unable to complete intake session:", error);
    res.status(500).json({ ok: false, message: error.message || "Unable to save intake session." });
  }
});






const GOOGLE_BOOKS_BASE_URL = "https://www.googleapis.com/books/v1";

const ebayTokenCache = { token: "", expiresAt: 0 };

function valuationMedian(values = []) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function valuationSummary({ source, sourceType, values = [], matches = [], currency = "USD", notes = [] }) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return { ok: false, source, sourceType, matchesUsed: 0, currency, notes };
  const trim = clean.length >= 10 ? Math.floor(clean.length * 0.1) : 0;
  const usable = trim ? clean.slice(trim, clean.length - trim) : clean;
  return {
    ok: true,
    source,
    sourceType,
    currency,
    estimate: valuationMedian(usable),
    low: usable[0],
    high: usable[usable.length - 1],
    matchesUsed: usable.length,
    rawMatchCount: clean.length,
    confidence: usable.length >= 12 ? "high" : usable.length >= 5 ? "medium" : "low",
    observedAt: new Date().toISOString(),
    notes,
    matches: matches.slice(0, 20),
  };
}

function valuationQuery(item = {}) {
  return [item.title, item.year, item.format, item.edition, item.author, item.artist, item.publisher, item.label, item.catalogNumber]
    .filter(Boolean).map(String).map((value) => value.trim()).filter(Boolean).join(" ");
}

function getEbayValuationSettings() {
  const settings = getIntegrationConfigById("ebay");
  return {
    enabled: settings.enabled === true,
    clientId: String(settings.clientId || "").trim(),
    clientSecret: String(settings.clientSecret || "").trim(),
    marketplaceId: String(settings.marketplaceId || "EBAY_US").trim() || "EBAY_US",
  };
}

async function getEbayToken() {
  const settings = getEbayValuationSettings();
  if (!settings.clientId || !settings.clientSecret) throw new Error("eBay client ID and client secret are not configured.");
  if (ebayTokenCache.token && ebayTokenCache.expiresAt > Date.now() + 60000) return ebayTokenCache.token;

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || `eBay OAuth returned ${response.status}.`);
  ebayTokenCache.token = data.access_token;
  ebayTokenCache.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 7200)) * 1000;
  return ebayTokenCache.token;
}

function ebayListingRelevant(listing = {}, item = {}) {
  const title = String(listing.title || "").toLowerCase();
  if (["digital code", "download code", "replacement case", "empty case", "cover only", "artwork only", "lot of", "bundle of", "wholesale"].some((token) => title.includes(token))) return false;
  const format = String(item.format || "").toLowerCase().replace("-", "");
  const normalizedTitle = title.replace("-", "");
  if (format.includes("bluray") && !normalizedTitle.includes("blu")) return false;
  if (format.includes("dvd") && !normalizedTitle.includes("dvd")) return false;
  if ((format.includes("4k") || format.includes("uhd")) && !normalizedTitle.includes("4k") && !normalizedTitle.includes("uhd")) return false;
  return true;
}

async function estimateEbay(item = {}) {
  const settings = getEbayValuationSettings();
  if (!settings.enabled) throw new Error("eBay valuation is not enabled.");
  const token = await getEbayToken();
  const params = new URLSearchParams({ limit: "50" });
  const code = String(item.code || item.upc || item.isbn || "").replace(/\D/g, "");
  if (code.length === 12 || code.length === 13) params.set("gtin", code);
  else params.set("q", valuationQuery(item));

  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": settings.marketplaceId,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.[0]?.message || `eBay Browse API returned ${response.status}.`);

  const listings = (Array.isArray(data.itemSummaries) ? data.itemSummaries : []).filter((listing) => ebayListingRelevant(listing, item));
  return valuationSummary({
    source: "eBay",
    sourceType: "active-listings",
    values: listings.map((listing) => Number(listing.price?.value || 0)),
    currency: listings.find((listing) => listing.price?.currency)?.price?.currency || "USD",
    matches: listings.map((listing) => ({
      id: listing.itemId,
      title: listing.title,
      price: Number(listing.price?.value || 0),
      currency: listing.price?.currency || "USD",
      condition: listing.condition || "",
      image: listing.image?.imageUrl || "",
      url: listing.itemWebUrl || "",
    })),
    notes: [
      "Based on active asking prices, not completed sales.",
      code ? `Matched using GTIN ${code}.` : "Matched using title and edition keywords.",
    ],
  });
}

function getDiscogsValuationSettings() {
  const settings = getIntegrationConfigById("discogs");
  return { enabled: settings.enabled === true, token: String(settings.token || settings.apiKey || "").trim() };
}

async function estimateDiscogs(item = {}) {
  const settings = getDiscogsValuationSettings();
  if (!settings.enabled || !settings.token) throw new Error("Discogs token is not configured.");

  const search = new URLSearchParams({ type: "release", per_page: "8" });
  const barcode = String(item.code || item.barcode || "").replace(/\D/g, "");
  if (barcode) search.set("barcode", barcode);
  else search.set("q", valuationQuery(item));

  const headers = { Authorization: `Discogs token=${settings.token}`, "User-Agent": "Homestead/1.0" };
  const searchResponse = await fetch(`https://api.discogs.com/database/search?${search.toString()}`, { headers });
  const searchData = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok) throw new Error(searchData.message || `Discogs search returned ${searchResponse.status}.`);

  const suggestions = [];
  for (const release of (Array.isArray(searchData.results) ? searchData.results.slice(0, 5) : [])) {
    try {
      const response = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${encodeURIComponent(release.id)}`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      Object.entries(data || {}).forEach(([condition, detail]) => {
        const value = Number(detail?.value || 0);
        if (value > 0) suggestions.push({
          id: `${release.id}-${condition}`,
          title: `${release.title} · ${condition}`,
          price: value,
          currency: detail.currency || "USD",
          url: `https://www.discogs.com/release/${release.id}`,
        });
      });
    } catch {}
  }

  return valuationSummary({
    source: "Discogs",
    sourceType: "marketplace-price-suggestions",
    values: suggestions.map((entry) => entry.price),
    currency: suggestions[0]?.currency || "USD",
    matches: suggestions,
    notes: [
      barcode ? `Matched using barcode ${barcode}.` : "Matched using release and pressing metadata.",
      "Exact pressing identification materially affects record value.",
    ],
  });
}

async function estimateGoogleBooksRetail(item = {}) {
  const settings = getIntegrationConfigById("googlebooks");
  const isbn = String(item.code || item.isbn || "").replace(/[^0-9X]/gi, "");
  const params = new URLSearchParams({
    q: isbn ? `isbn:${isbn}` : `intitle:${String(item.title || "").trim()}`,
    maxResults: "5",
    country: "US",
  });
  if (settings.apiKey) params.set("key", settings.apiKey);
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Google Books returned ${response.status}.`);

  const matches = (Array.isArray(data.items) ? data.items : []).map((entry) => ({
    id: entry.id,
    title: entry.volumeInfo?.title || item.title || "Book",
    price: Number(entry.saleInfo?.retailPrice?.amount || entry.saleInfo?.listPrice?.amount || 0),
    currency: entry.saleInfo?.retailPrice?.currencyCode || entry.saleInfo?.listPrice?.currencyCode || "USD",
    url: entry.saleInfo?.buyLink || entry.volumeInfo?.infoLink || "",
  })).filter((entry) => entry.price > 0);

  return valuationSummary({
    source: "Google Books",
    sourceType: "current-retail-price",
    values: matches.map((entry) => entry.price),
    currency: matches[0]?.currency || "USD",
    matches,
    notes: ["Retail/list price fallback; not a used resale estimate."],
  });
}

app.get("/api/integrations/ebay/status", async (req, res) => {
  try {
    await getEbayToken();
    const settings = getEbayValuationSettings();
    res.json({ ok: true, message: `eBay Browse API connected · ${settings.marketplaceId}` });
  } catch (error) {
    res.status(502).json({ ok: false, message: error.message || "eBay connection test failed." });
  }
});

app.get("/api/integrations/discogs/status", async (req, res) => {
  try {
    const settings = getDiscogsValuationSettings();
    if (!settings.token) return res.status(400).json({ ok: false, message: "Enter a Discogs personal access token first." });
    const response = await fetch("https://api.discogs.com/oauth/identity", {
      headers: { Authorization: `Discogs token=${settings.token}`, "User-Agent": "Homestead/1.0" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Discogs returned ${response.status}.`);
    res.json({ ok: true, message: `Discogs connected${data.username ? ` · ${data.username}` : ""}` });
  } catch (error) {
    res.status(502).json({ ok: false, message: error.message || "Discogs connection test failed." });
  }
});


function normalizeElectronicsCandidate(item = {}, source = "Unknown", confidence = 0.5) {
  const title = String(item.title || item.name || item.product_name || "").trim();
  const brand = String(item.brand || item.manufacturer || "").trim();
  const model = String(item.model || item.mpn || item.modelNumber || "").trim();
  const image =
    item.image?.imageUrl ||
    item.image ||
    item.images?.[0] ||
    item.thumbnail ||
    "";
  return {
    id: String(item.itemId || item.id || item.ean || item.upc || `${source}-${title}-${model}`).replace(/\s+/g, "-"),
    title: title || [brand, model].filter(Boolean).join(" ") || "Unknown electronics item",
    brand,
    model,
    barcode: String(item.gtin || item.upc || item.ean || "").replace(/\D/g, ""),
    image,
    condition: String(item.condition || "").trim(),
    price: Number(item.price?.value || item.price || item.lowest_recorded_price || 0),
    currency: item.price?.currency || item.currency || "USD",
    source,
    sourceUrl: item.itemWebUrl || item.url || "",
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    raw: item,
  };
}

app.post("/api/intake/electronics/search", express.json({ limit: "1mb" }), async (req, res) => {
  const query = String(req.body?.query || "").trim();
  const barcode = String(req.body?.barcode || "").replace(/\D/g, "");
  if (!query && !barcode) return res.status(400).json({ ok: false, message: "Enter a barcode, product name, or model number." });

  const results = [];
  const warnings = [];

  if (barcode) {
    try {
      const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`, {
        headers: { Accept: "application/json", "User-Agent": "Homestead/1.0" },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.items)) {
        data.items.slice(0, 8).forEach((item) => results.push(normalizeElectronicsCandidate(item, "UPCitemdb", 0.98)));
      } else if (!response.ok) {
        warnings.push(`UPCitemdb returned ${response.status}.`);
      }
    } catch (error) {
      warnings.push(error.message || "UPCitemdb lookup failed.");
    }
  }

  try {
    const settings = getEbayValuationSettings();
    if (settings.enabled && settings.clientId && settings.clientSecret) {
      const token = await getEbayToken();
      const params = new URLSearchParams({ limit: "24" });
      if (barcode.length === 12 || barcode.length === 13) params.set("gtin", barcode);
      else params.set("q", query || barcode);
      const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": settings.marketplaceId,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.itemSummaries)) {
        data.itemSummaries.slice(0, 20).forEach((item, index) => {
          const confidence = barcode ? 0.94 : Math.max(0.55, 0.9 - index * 0.015);
          results.push(normalizeElectronicsCandidate(item, "eBay", confidence));
        });
      } else if (!response.ok) {
        warnings.push(data.errors?.[0]?.message || `eBay returned ${response.status}.`);
      }
    } else {
      warnings.push("eBay integration is not configured.");
    }
  } catch (error) {
    warnings.push(error.message || "eBay search failed.");
  }

  const seen = new Set();
  const deduped = results
    .filter((item) => {
      const key = `${item.barcode || ""}|${item.brand}|${item.model}|${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence || Number(a.price || 0) - Number(b.price || 0))
    .slice(0, 30);

  res.json({ ok: true, results: deduped, warnings });
});

app.post("/api/intake/electronics/add", express.json({ limit: "2mb" }), (req, res) => {
  try {
    const candidate = req.body?.candidate && typeof req.body.candidate === "object" ? req.body.candidate : null;
    if (!candidate) return res.status(400).json({ ok: false, message: "Choose an electronics candidate first." });

    const records = readIntakeLibraryRecords("inventory");
    const now = new Date().toISOString();
    const record = {
      id: `electronics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      libraryId: "inventory",
      category: "electronics",
      title: String(candidate.title || "Electronics item").trim(),
      code: String(candidate.barcode || "").trim(),
      location: String(req.body?.location || "").trim(),
      notes: "",
      metadata: {
        category: "electronics",
        brand: String(candidate.brand || "").trim(),
        model: String(candidate.model || "").trim(),
        serialNumber: String(req.body?.serialNumber || "").trim(),
        condition: String(req.body?.condition || "Used - Good").trim(),
        purchasePrice: Number(req.body?.purchasePrice || 0),
        image: String(candidate.image || "").trim(),
        source: String(candidate.source || "").trim(),
        sourceUrl: String(candidate.sourceUrl || "").trim(),
        sourceConfidence: Number(candidate.confidence || 0),
      },
      electronics: {
        brand: String(candidate.brand || "").trim(),
        model: String(candidate.model || "").trim(),
        serialNumber: String(req.body?.serialNumber || "").trim(),
        condition: String(req.body?.condition || "Used - Good").trim(),
        purchasePrice: Number(req.body?.purchasePrice || 0),
        estimatedListingValue: Number(candidate.price || 0),
        source: String(candidate.source || "").trim(),
      },
      valuation: Number(candidate.price || 0) > 0 ? {
        ok: true,
        estimate: Number(candidate.price || 0),
        low: Number(candidate.price || 0),
        high: Number(candidate.price || 0),
        matchesUsed: 1,
        source: String(candidate.source || "Source"),
        sourceType: "selected-listing",
        confidence: Number(candidate.confidence || 0) >= 0.9 ? "high" : "medium",
        observedAt: now,
      } : null,
      createdAt: now,
      updatedAt: now,
    };

    records.push(record);
    writeIntakeLibraryRecords("inventory", records);
    res.json({ ok: true, record });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to add electronics item." });
  }
});

function subtitleLanguageFromName(fileName = "") {
  const base = String(fileName || "").toLowerCase();
  const match = base.match(/(?:^|[._ -])(en|eng|es|spa|fr|fre|fra|de|ger|ita|it|pt|por|ja|jpn|ko|kor|zh|chi|zho)(?:[._ -]|$)/i);
  const code = match?.[1]?.toLowerCase() || "und";
  const aliases = { eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", ita: "it", por: "pt", jpn: "ja", kor: "ko", chi: "zh", zho: "zh" };
  return aliases[code] || code;
}

function subtitleLabel(language = "und", fileName = "") {
  const labels = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean", zh: "Chinese", und: "Subtitles" };
  const flags = [];
  if (/forced/i.test(fileName)) flags.push("Forced");
  if (/(?:^|[._ -])sdh(?:[._ -]|$)/i.test(fileName)) flags.push("SDH");
  return [labels[language] || language.toUpperCase(), ...flags].join(" · ");
}

function findSidecarSubtitles(videoPath = "") {
  const resolvedVideo = resolveHomesteadFilePath(videoPath) || resolveCaseInsensitivePath(videoPath);
  if (!resolvedVideo || !fs.existsSync(resolvedVideo)) return [];
  const folder = path.dirname(resolvedVideo);
  const videoBase = path.basename(resolvedVideo, path.extname(resolvedVideo)).toLowerCase();
  let entries = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && /\.(srt|vtt)$/i.test(entry.name))
    .filter((entry) => {
      const subtitleBase = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      return subtitleBase === videoBase || subtitleBase.startsWith(`${videoBase}.`) || subtitleBase.startsWith(`${videoBase}-`) || subtitleBase.startsWith(`${videoBase}_`);
    })
    .map((entry, index) => {
      const subtitlePath = path.join(folder, entry.name);
      const language = subtitleLanguageFromName(entry.name);
      return {
        id: `${index}-${entry.name}`,
        path: subtitlePath,
        format: path.extname(entry.name).slice(1).toLowerCase(),
        language,
        label: subtitleLabel(language, entry.name),
        forced: /forced/i.test(entry.name),
        default: /(?:^|[._ -])default(?:[._ -]|$)/i.test(entry.name),
      };
    });
}

function srtToVtt(text = "") {
  return `WEBVTT\n\n${String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

app.get("/api/media/sidecar-subtitles", (req, res) => {
  const videoPath = String(req.query.path || "").trim();
  if (!videoPath) return res.status(400).json({ ok: false, message: "Video path is required." });
  res.json({ ok: true, subtitles: findSidecarSubtitles(videoPath) });
});

app.get("/api/media/subtitle-track", (req, res) => {
  const requested = String(req.query.path || "").trim();
  const resolved = resolveHomesteadFilePath(requested) || resolveCaseInsensitivePath(requested);
  if (!resolved || !fs.existsSync(resolved) || !/\.(srt|vtt)$/i.test(resolved)) {
    return res.status(404).send("Subtitle not found");
  }

  const text = fs.readFileSync(resolved, "utf8");
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(/\.srt$/i.test(resolved) ? srtToVtt(text) : text);
});

app.post("/api/intake/valuation/estimate", express.json({ limit: "1mb" }), async (req, res) => {
  const item = req.body && typeof req.body === "object" ? req.body : {};
  const category = String(item.category || item.mediaType || "").trim().toLowerCase();
  const results = [];
  const attempts = [];

  async function tryProvider(name, fn) {
    try {
      const result = await fn();
      if (result?.ok) results.push(result);
      else attempts.push(`${name}: no priced matches`);
    } catch (error) {
      attempts.push(`${name}: ${error.message || "failed"}`);
    }
  }

  if (["record", "records", "vinyl", "music", "cd", "cassette"].includes(category)) {
    await tryProvider("Discogs", () => estimateDiscogs(item));
    await tryProvider("eBay", () => estimateEbay(item));
  } else if (["book", "books"].includes(category)) {
    await tryProvider("eBay", () => estimateEbay(item));
    await tryProvider("Google Books", () => estimateGoogleBooksRetail(item));
  } else {
    await tryProvider("eBay", () => estimateEbay(item));
  }

  if (!results.length) {
    return res.status(404).json({
      ok: false,
      message: "No valuation source returned a usable estimate. Configure eBay and optionally Discogs in Settings → Integrations.",
      attempts,
    });
  }

  const valuation = results.find((result) => result.source === "Discogs") ||
    results.find((result) => result.source === "eBay") ||
    results[0];

  res.json({
    ok: true,
    valuation,
    alternatives: results.filter((result) => result !== valuation),
    attempts,
  });
});



function getIntegrationConfigById(id = "") {
  const setup = readSetupConfig();
  const settings =
    setup?.integrationSettings?.[id] &&
    typeof setup.integrationSettings[id] === "object"
      ? setup.integrationSettings[id]
      : {};

  return {
    ...settings,
    enabled:
      setup?.integrations?.[id] === true ||
      settings.enabled === true,
  };
}

function buildIptvProviderUrls(settings = {}) {
  const serverUrl = String(settings.serverUrl || "").trim().replace(/\/+$/, "");
  const username = String(settings.username || "").trim();
  const password = String(settings.password || "").trim();
  const output = String(settings.output || "ts").trim() || "ts";

  if (!serverUrl || !username || !password) {
    return { m3uUrl: "", epgUrl: "" };
  }

  const query =
    `username=${encodeURIComponent(username)}` +
    `&password=${encodeURIComponent(password)}`;

  return {
    m3uUrl: `${serverUrl}/get.php?${query}&type=m3u_plus&output=${encodeURIComponent(output)}`,
    epgUrl: `${serverUrl}/xmltv.php?${query}`,
  };
}

app.get("/api/integrations/googlebooks/status", async (req, res) => {
  const settings = getIntegrationConfigById("googlebooks");
  const params = new URLSearchParams({
    q: "isbn:9780140328721",
    maxResults: "1",
  });
  if (settings.apiKey) params.set("key", settings.apiKey);

  try {
    const response = await fetch(
      `${GOOGLE_BOOKS_BASE_URL}/volumes?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Homestead/1.0",
        },
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        data?.message ||
        `Google Books returned ${response.status}.`
      );
    }

    return res.json({
      ok: true,
      connected: true,
      status: "connected",
      appName: "Google Books",
      message: `Google Books connected${settings.apiKey ? " with API key" : " without an API key"}.`,
      sampleTitle: data?.items?.[0]?.volumeInfo?.title || "",
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      connected: false,
      message: error.message || "Google Books connection test failed.",
    });
  }
});

app.get("/api/integrations/iptvprovider/status", async (req, res) => {
  const settings = getIntegrationConfigById("iptvprovider");
  const { m3uUrl, epgUrl } = buildIptvProviderUrls(settings);

  if (!settings.enabled || !settings.serverUrl || !settings.username || !settings.password) {
    return res.status(400).json({
      ok: false,
      connected: false,
      message: "Enter and save the provider server URL, username, and password first.",
    });
  }

  const serverUrl = String(settings.serverUrl).trim().replace(/\/+$/, "");
  const playerApiUrl =
    `${serverUrl}/player_api.php?username=${encodeURIComponent(settings.username)}` +
    `&password=${encodeURIComponent(settings.password)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(playerApiUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Homestead/1.0",
        },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.user_info?.auth === 0) {
        throw new Error(
          data?.user_info?.message ||
          data?.message ||
          `IPTV provider returned ${response.status}.`
        );
      }

      return res.json({
        ok: true,
        connected: true,
        status: "connected",
        appName: settings.providerName || "IPTV Provider",
        message: "IPTV provider login verified and playlist URLs generated.",
        generated: { m3uUrl, epgUrl },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return res.status(502).json({
      ok: false,
      connected: false,
      message: error?.name === "AbortError"
        ? "IPTV provider connection timed out."
        : error.message || "IPTV provider connection test failed.",
    });
  }
});

app.get("/api/integrations/xteve/status", async (req, res) => {
  const settings = getIntegrationConfigById("xteve");
  const baseUrl = String(settings.url || "").trim().replace(/\/+$/, "");

  if (!settings.enabled || !baseUrl) {
    return res.status(400).json({
      ok: false,
      connected: false,
      message: "Enter and save the xTeVe server URL first.",
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(baseUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/json",
          "User-Agent": "Homestead/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`xTeVe returned ${response.status}.`);
      }

      return res.json({
        ok: true,
        connected: true,
        status: "connected",
        appName: "xTeVe",
        message: "xTeVe server is reachable.",
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return res.status(502).json({
      ok: false,
      connected: false,
      message: error?.name === "AbortError"
        ? "xTeVe connection timed out."
        : error.message || "xTeVe connection test failed.",
    });
  }
});

const UPCMDB_BASE_URL = "https://us-central1-upcmdb-cbae5.cloudfunctions.net/api";

function getUpcmdbConfig() {
  const setup = readSetupConfig();
  const settings =
    setup?.integrationSettings?.upcmdb &&
    typeof setup.integrationSettings.upcmdb === "object"
      ? setup.integrationSettings.upcmdb
      : {};

  return {
    apiKey: String(settings.apiKey || process.env.UPCMDB_API_KEY || "").trim(),
    enabled: setup?.integrations?.upcmdb === true || settings.enabled === true,
  };
}

function normalizeUpcmdbProduct(raw = {}, scannedCode = "") {
  const title = String(raw.title || raw.name || "").trim();
  const year = String(raw.year || raw.releaseYear || "").trim();
  const format = String(raw.format || raw.media_format || "DVD").trim();
  const specialFeatures = String(
    raw.special_features ||
    raw.specialFeatures ||
    raw.collectors_edition ||
    raw.limited_edition ||
    raw.steelbook ||
    raw.boxset ||
    ""
  ).trim();

  const poster =
    raw.productImageUrl ||
    raw.product_image_url ||
    raw.poster ||
    raw.posterUrl ||
    raw.image ||
    raw.cover ||
    raw.thumbnail ||
    "";

  return {
    code: String(raw.upc || raw.ean || scannedCode || "").replace(/\D/g, ""),
    upc: String(raw.upc || scannedCode || "").replace(/\D/g, ""),
    ean: String(raw.ean || "").replace(/\D/g, ""),
    title,
    year,
    format,
    edition: specialFeatures && specialFeatures !== "null" ? specialFeatures : "Standard",
    specialFeatures: specialFeatures && specialFeatures !== "null" ? specialFeatures : "",
    publisher: raw.publisher || "",
    imdbId: raw.imdbID || raw.imdbId || raw.imdb_id || "",
    mediaType: String(raw.mediaType || raw.type || "movie").toLowerCase() === "tv" ? "tv" : "movie",
    plot: raw.plot || raw.description || "",
    runtime: raw.runtime || "",
    genre: raw.genre || "",
    director: raw.director || "",
    actors: raw.actors || "",
    rating: raw.imdbRating || raw.rating || "",
    poster,
    provider: "UPCMDB",
    raw,
  };
}

function getUpcmdbCodeCandidates(code = "") {
  const clean = String(code || "").replace(/\D/g, "");
  const candidates = [];

  const push = (value) => {
    const normalized = String(value || "").replace(/\D/g, "");
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  push(clean);

  // UPC-A is frequently represented as an EAN-13 with a leading zero.
  if (clean.length === 12) push(`0${clean}`);
  if (clean.length === 13 && clean.startsWith("0")) push(clean.slice(1));

  // Some scanners omit a leading zero from a UPC-A code.
  if (clean.length === 11) push(`0${clean}`);

  return candidates;
}

async function lookupUpcmdbSingle(code = "") {
  const cleanCode = String(code || "").replace(/\D/g, "");
  const { apiKey, enabled } = getUpcmdbConfig();

  if (!enabled || !apiKey) {
    return {
      status: "not-configured",
      product: null,
      message: "UPCMDB API key is not configured.",
      attemptedCode: cleanCode,
    };
  }

  const path =
    cleanCode.length === 13
      ? `/v1/lookup/ean/${encodeURIComponent(cleanCode)}`
      : `/v1/lookup/${encodeURIComponent(cleanCode)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${UPCMDB_BASE_URL}${path}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "User-Agent": "Homestead/1.0",
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (response.status === 404) {
      return {
        status: "not-found",
        product: null,
        message: "UPC was not found in UPCMDB.",
        attemptedCode: cleanCode,
      };
    }

    if (!response.ok) {
      const messages = {
        401: "UPCMDB rejected the API key.",
        403: "The UPCMDB key does not have permission for this request.",
        429: "UPCMDB request quota has been exceeded.",
      };
      const error = new Error(
        messages[response.status] ||
        data?.message ||
        data?.error ||
        `UPCMDB returned ${response.status}.`
      );
      error.status = response.status;
      throw error;
    }

    const record = Array.isArray(data)
      ? data[0]
      : data?.data || data?.record || data;

    return {
      status: "matched",
      product: normalizeUpcmdbProduct(record || {}, cleanCode),
      message: "UPCMDB match found.",
      attemptedCode: cleanCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupUpcmdb(code = "") {
  const candidates = getUpcmdbCodeCandidates(code);
  let lastResult = null;

  for (const candidate of candidates) {
    try {
      const result = await lookupUpcmdbSingle(candidate);
      lastResult = result;

      if (result.status === "matched" && result.product) {
        return {
          ...result,
          requestedCode: String(code || "").replace(/\D/g, ""),
          matchedCode: candidate,
          attemptedCodes: candidates,
        };
      }

      if (result.status === "not-configured") return result;
    } catch (error) {
      // Authentication and quota failures will not improve by trying another
      // barcode representation.
      if ([401, 403, 429].includes(Number(error.status))) throw error;
      lastResult = {
        status: "unavailable",
        product: null,
        message: error.message || "UPCMDB lookup failed.",
        attemptedCode: candidate,
      };
    }
  }

  return {
    ...(lastResult || {
      status: "not-found",
      product: null,
      message: "UPC was not found in UPCMDB.",
    }),
    requestedCode: String(code || "").replace(/\D/g, ""),
    attemptedCodes: candidates,
  };
}

app.get("/api/integrations/upcmdb/status", async (req, res) => {
  const { apiKey, enabled } = getUpcmdbConfig();

  if (!enabled || !apiKey) {
    return res.status(400).json({
      ok: false,
      connected: false,
      message: "Add and enable a UPCMDB API key first.",
    });
  }

  try {
    const result = await lookupUpcmdb("786936870923");

    if (result.status !== "matched" || !result.product) {
      return res.status(502).json({
        ok: false,
        connected: false,
        message: result.message || "UPCMDB test lookup did not return a record.",
      });
    }

    return res.json({
      ok: true,
      connected: true,
      status: "connected",
      appName: "UPCMDB",
      message: "UPCMDB connected successfully.",
      sample: {
        title: result.product.title,
        year: result.product.year,
        format: result.product.format,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      connected: false,
      message: error.message || "UPCMDB connection test failed.",
    });
  }
});

// Homestead Movie / TV intake: UPC lookup, TMDB/Seerr matching, physical editions, and batch-friendly completion.
function normalizeMediaTitle(value = "") {
  return String(value || "")
    .replace(/\b(?:dvd|blu[ -]?ray|4k|uhd|ultra hd|digital|steelbook|collector'?s edition|complete series|the complete series)\b/gi, " ")
    .replace(/\b(?:widescreen|fullscreen|special edition|anniversary edition)\b/gi, " ")
    .replace(/[\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPhysicalMediaDetails(title = "") {
  const raw = String(title || "");
  let format = "DVD";
  if (/4k|uhd|ultra hd/i.test(raw)) format = "4K UHD";
  else if (/blu[ -]?ray/i.test(raw)) format = "Blu-ray";
  else if (/vhs/i.test(raw)) format = "VHS";
  else if (/digital/i.test(raw)) format = "Digital";
  let edition = "Standard";
  if (/steelbook/i.test(raw)) edition = "Steelbook";
  else if (/collector/i.test(raw)) edition = "Collector Edition";
  else if (/complete series/i.test(raw)) edition = "Complete Series";
  else if (/special edition/i.test(raw)) edition = "Special Edition";
  const seasonMatch = raw.match(/(?:season|series)\s*(\d{1,2})/i);
  return { format, edition, seasonNumber: seasonMatch ? Number(seasonMatch[1]) : null };
}

async function searchSeerrForIntake(query = "") {
  const clean = String(query || "").trim();
  if (!clean) return [];
  const { baseUrl, apiKey } = getSeerrConfig();
  if (!baseUrl || !apiKey) return [];
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/api/v1/search?query=${strictEncodeQuery(clean)}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || `Seerr returned ${response.status}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((item) => ["movie", "tv"].includes(String(item?.mediaType || "")))
    .slice(0, 20)
    .map((item) => {
      const mediaType = String(item.mediaType) === "tv" ? "tv" : "movie";
      const title = item.title || item.name || item.originalTitle || item.originalName || "Untitled";
      const date = item.releaseDate || item.firstAirDate || item.release_date || item.first_air_date || "";
      const libraryId = mediaType === "tv" ? "tv" : "movies";
      const existingRecords = readIntakeLibraryRecords(libraryId);
      const existing = existingRecords.find((record) =>
        String(record?.metadata?.tmdbId || record?.tmdbId || "") === String(item.id) ||
        String(record?.title || "").trim().toLowerCase() === String(title).trim().toLowerCase()
      );
      return {
        id: item.id,
        tmdbId: item.id,
        mediaType,
        title,
        year: date ? String(date).slice(0, 4) : "",
        overview: item.overview || "",
        posterPath: item.posterPath || item.poster_path || "",
        poster: (item.posterPath || item.poster_path) ? `https://image.tmdb.org/t/p/w342${item.posterPath || item.poster_path}` : "",
        existing: existing ? { id: existing.id, title: existing.title, physicalCopies: existing.physicalCopies || [] } : null,
      };
    });
}

function getBaseTvTitle(value = "") {
  return String(value || "")
    .replace(/\bthe\s+complete\s+(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+season\b/ig, "")
    .replace(/\bcomplete\s+series\b/ig, "")
    .replace(/\bseason\s+\d+\b/ig, "")
    .replace(/\bseries\s+\d+\b/ig, "")
    .replace(/\b(?:dvd|blu-?ray|4k|uhd|box\s*set|collector'?s?\s+edition|special\s+edition)\b/ig, "")
    .replace(/\s*[-:|]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function detectSeasonNumber(value = "") {
  const text = String(value || "");
  const numeric = text.match(/\bseason\s+(\d{1,2})\b/i);
  if (numeric) return Number(numeric[1]);

  const words = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const wordMatch = text.match(
    /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/i
  );
  return wordMatch ? words[wordMatch[1].toLowerCase()] : null;
}

async function fetchSeerrTvDetails(tmdbId = "") {
  if (!tmdbId) return null;
  const { baseUrl, apiKey } = getSeerrConfig();
  if (!baseUrl || !apiKey) return null;

  const response = await fetch(
    `${String(baseUrl).replace(/\/+$/, "")}/api/v1/tv/${encodeURIComponent(tmdbId)}`,
    {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return data;
}

async function buildRelatedMediaSuggestions(product = {}, matches = []) {
  const primaryTv = matches.find((item) => item.mediaType === "tv");
  const sourceTitle = product?.title || primaryTv?.title || "";
  const baseTitle = getBaseTvTitle(sourceTitle);
  const scannedSeason = detectSeasonNumber(sourceTitle);
  const suggestions = [];

  if (primaryTv?.tmdbId) {
    try {
      const details = await fetchSeerrTvDetails(primaryTv.tmdbId);
      const seasons = Array.isArray(details?.seasons) ? details.seasons : [];

      seasons
        .filter((season) => Number(season?.seasonNumber ?? season?.season_number) > 0)
        .forEach((season) => {
          const seasonNumber = Number(
            season?.seasonNumber ?? season?.season_number
          );
          suggestions.push({
            id: `tv-${primaryTv.tmdbId}-season-${seasonNumber}`,
            tmdbId: primaryTv.tmdbId,
            mediaType: "tv",
            title: `${primaryTv.title} — Season ${seasonNumber}`,
            year: String(
              season?.airDate ||
              season?.air_date ||
              ""
            ).slice(0, 4),
            overview: season?.overview || "",
            poster:
              season?.posterPath || season?.poster_path
                ? `https://image.tmdb.org/t/p/w342${season.posterPath || season.poster_path}`
                : primaryTv.poster || "",
            seasonNumber,
            parentTitle: primaryTv.title,
            provider: "TMDB via Seerr",
            selectedByDefault: scannedSeason === seasonNumber,
          });
        });
    } catch (error) {
      console.warn("Unable to load related TV seasons:", error.message || error);
    }
  }

  if (baseTitle) {
    try {
      const relatedSearch = await searchSeerrForIntake(baseTitle);
      relatedSearch
        .filter((item) => {
          if (
            item.mediaType === primaryTv?.mediaType &&
            String(item.tmdbId) === String(primaryTv?.tmdbId)
          ) {
            return false;
          }
          return true;
        })
        .slice(0, 10)
        .forEach((item) => {
          suggestions.push({
            ...item,
            id: `related-${item.mediaType}-${item.id}`,
            provider: "TMDB via Seerr",
            selectedByDefault: false,
          });
        });
    } catch (error) {
      console.warn("Unable to load related media:", error.message || error);
    }
  }

  const seen = new Set();
  return suggestions.filter((item) => {
    const key = `${item.mediaType}:${item.tmdbId || item.id}:${item.seasonNumber || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


app.get("/api/intake/media/search", async (req, res) => {
  try {
    const query = String(req.query?.query || "").trim();
    if (!query) return res.status(400).json({ ok: false, message: "Enter a movie or TV title." });
    const matches = await searchSeerrForIntake(query);
    res.json({ ok: true, matches });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Media search failed." });
  }
});

app.get("/api/intake/media/lookup", async (req, res) => {
  try {
    const code = String(req.query?.code || "").replace(/\D/g, "");
    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({
        ok: false,
        message: "Enter a valid UPC, EAN, or GTIN.",
      });
    }

    let upcmdbResult;
    try {
      upcmdbResult = await lookupUpcmdb(code);
    } catch (error) {
      console.warn("UPCMDB media lookup failed:", error.message || error);
      upcmdbResult = {
        status: "unavailable",
        product: null,
        message: error.message || "UPCMDB lookup failed.",
      };
    }

    const product = upcmdbResult.product;
    const queryParts = [product?.title, product?.year].filter(Boolean);
    let matches = [];

    if (product?.title) {
      try {
        matches = await searchSeerrForIntake(queryParts.join(" "));
        if (!matches.length && product.year) {
          matches = await searchSeerrForIntake(product.title);
        }
      } catch (error) {
        console.warn("Seerr media match failed:", error.message || error);
      }
    }

    // UPCMDB is authoritative for the physical release. When Seerr returns
    // nothing, keep the flow usable with a confirmable UPCMDB metadata card.
    if (!matches.length && product?.title) {
      matches = [{
        id: product.imdbId || `upcmdb-${code}`,
        tmdbId: "",
        imdbId: product.imdbId || "",
        mediaType: product.mediaType || "movie",
        title: product.title,
        year: product.year || "",
        overview: product.plot || "",
        poster: product.poster || "",
        provider: "UPCMDB",
        existing: null,
      }];
    }

    const detected = {
      ...detectPhysicalMediaDetails(`${product?.format || ""} ${product?.edition || ""}`),
      format: product?.format || detectPhysicalMediaDetails(product?.title || "").format,
      edition: product?.edition || "Standard",
    };

    const existingIdentity = findIntakeIdentity(code);
    const existingFromMatch = matches.find((item) => item.existing)?.existing || null;
    const relatedMatches =
      product?.mediaType === "tv" || matches.some((item) => item.mediaType === "tv")
        ? await buildRelatedMediaSuggestions(product || {}, matches)
        : [];

    return res.json({
      ok: true,
      code,
      product,
      detected,
      matches,
      relatedMatches,
      existing: existingIdentity || existingFromMatch,
      providerStatus: {
        upcmdb: upcmdbResult.status,
        upcmdbMessage: upcmdbResult.message || "",
        seerr: matches.some((item) => item.provider !== "UPCMDB") ? "matched" : "not-matched",
      },
    });
  } catch (error) {
    console.error("Movie/TV intake lookup failed:", error);
    return res.status(500).json({
      ok: false,
      message: error.message || "Unable to look up this media UPC.",
    });
  }
});

app.post("/api/intake/media/complete", express.json({ limit: "12mb" }), (req, res) => {
  try {
    const now = new Date().toISOString();
    const match = req.body?.match || {};
    const mediaType = String(match.mediaType || "movie") === "tv" ? "tv" : "movie";
    const libraryId = mediaType === "tv" ? "tv" : "movies";
    const title = String(match.title || req.body?.product?.title || "Untitled media").trim();
    const tmdbId = String(match.tmdbId || match.id || "");
    const code = String(req.body?.code || "").replace(/\s+/g, "");
    const choice = String(req.body?.duplicateChoice || "create");
    const destinations = {
      media: req.body?.destinations?.media !== false,
      inventory: req.body?.destinations?.inventory !== false,
    };
    if (!destinations.media && !destinations.inventory) {
      return res.status(400).json({
        ok: false,
        message: "Choose Media Library, Physical Inventory, or both.",
      });
    }

    const incoming = req.body?.physicalCopy || {};
    const physicalCopy = {
      id: makeIntakeId("copy"),
      upc: code,
      format: String(incoming.format || "DVD"),
      region: String(incoming.region || ""),
      edition: String(incoming.edition || "Standard"),
      condition: String(incoming.condition || "Very Good"),
      location: String(incoming.location || ""),
      quantity: Math.max(1, Number(incoming.quantity || 1)),
      createdAt: now,
      updatedAt: now,
    };
    const records = readIntakeLibraryRecords(libraryId);
    let index = records.findIndex((record) =>
      (tmdbId && String(record?.metadata?.tmdbId || record?.tmdbId || "") === tmdbId) ||
      String(record?.title || "").trim().toLowerCase() === title.toLowerCase()
    );
    let record;
    if (index >= 0) {
      record = { ...records[index] };
      const copies = Array.isArray(record.physicalCopies) ? [...record.physicalCopies] : [];
      if (choice === "same-edition") {
        const copyIndex = copies.findIndex((copy) =>
          String(copy.format || "").toLowerCase() === physicalCopy.format.toLowerCase() &&
          String(copy.region || "").toLowerCase() === physicalCopy.region.toLowerCase() &&
          String(copy.edition || "").toLowerCase() === physicalCopy.edition.toLowerCase()
        );
        if (copyIndex >= 0) copies[copyIndex] = { ...copies[copyIndex], quantity: Math.max(1, Number(copies[copyIndex].quantity || 1)) + physicalCopy.quantity, updatedAt: now, upc: copies[copyIndex].upc || code };
        else copies.push(physicalCopy);
      } else copies.push(physicalCopy);
      record = { ...record, physicalCopies: copies, updatedAt: now };
      records[index] = record;
    } else {
      record = {
        id: makeIntakeId(libraryId), homesteadId: "", libraryId, title, name: title,
        metadata: {
          provider: match.provider || "TMDB via Seerr",
          tmdbId,
          imdbId: match.imdbId || req.body?.product?.imdbId || "",
          mediaType,
          year: match.year || req.body?.product?.year || "",
          overview: match.overview || req.body?.product?.plot || "",
          thumbnail: match.poster || req.body?.product?.poster || "",
          poster: match.poster || req.body?.product?.poster || "",
          upcProduct: req.body?.product || null,
        },
        physicalCopies: [physicalCopy], linkedDestinations: { [libraryId]: destinations.media, inventory: destinations.inventory }, source: "media-intake", status: "active", createdAt: now, updatedAt: now,
      };
      record.homesteadId = record.id;
      records.push(record);
      index = records.length - 1;
    }
    if (destinations.media) {
      writeIntakeLibraryRecords(libraryId, records);
    }

    let inventoryRecord = null;
    if (destinations.inventory) {
      const inventoryRecords = readIntakeLibraryRecords("inventory");
      inventoryRecord = {
      id: makeIntakeId("inventory"), homesteadId: record.id, linkedIdentityId: record.id, libraryId: "inventory", title,
      name: `${title} — ${physicalCopy.format}`, category: "media", code, aliases: code ? [code] : [],
      metadata: { ...record.metadata, mediaLibrary: libraryId, mediaRecordId: record.id }, physicalCopyOf: record.id,
      physicalCopy, quantity: physicalCopy.quantity, notes: physicalCopy.location ? `Location: ${physicalCopy.location}` : "",
      source: "media-intake", status: "active", createdAt: now, updatedAt: now,
    };
      inventoryRecords.push(inventoryRecord);
      writeIntakeLibraryRecords("inventory", inventoryRecords);
    }

    if (code) {
      const identities = readIntakeCollection(intakeIdentitiesPath);
      identities.push({ value: code, aliases: [code], type: classifyIntakeCode(code, libraryId).codeType, libraryId, homesteadId: record.id, record: { id: record.id, title: record.title, libraryId }, createdAt: now, updatedAt: now });
      writeJsonFile(intakeIdentitiesPath, identities.slice(-10000));
    }
    const queue = readIntakeCollection(intakeQueuePath);
    queue.push({ id: makeIntakeId("activity"), sessionId: String(req.body?.sessionId || ""), activityType: index >= 0 ? "physical-copy" : "intake", batchMode: req.body?.batchMode === true, status: "completed", libraryId, title, code, linkedRecord: { id: record.id, libraryId }, linkedRecords: [{ id: record.id, libraryId }, { id: inventoryRecord?.id, libraryId: "inventory" }], physicalCopy, createdAt: now, updatedAt: now });
    writeJsonFile(intakeQueuePath, queue.slice(-2000));
    res.json({ ok: true, record, inventoryRecord, physicalCopy });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || "Unable to save media item." });
  }
});

for (const plugin of pluginRegistry.scan()) {
  if (!plugin.valid || !plugin.enabled || !plugin.serverEntryPath) continue;
  try {
    fs.mkdirSync(plugin.dataRoot, { recursive: true });
    pluginRegistry.loadServerPlugin(plugin.id, {
      app,
      express,
      fs,
      path,
      dataDir,
    });
    loadedServerPlugins.add(plugin.id);
    console.log(`[plugins] Loaded ${plugin.name} ${plugin.version}`);
  } catch (error) {
    console.error(`[plugins] Unable to load ${plugin.id}:`, error);
  }
}

// All API and server routes must be registered before this SPA fallback.
// Otherwise Express serves index.html for valid API GET requests declared later.
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.get(/.*/, sendHomesteadBrandedIndex);

app.listen(PORT, () => {
  console.log(`Homestead server running on http://localhost:${PORT}`);
});
