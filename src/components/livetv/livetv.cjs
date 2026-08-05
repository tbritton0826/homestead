// src/components/livetv/livetv.cjs
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "livetv-config.json");
const CHANNELS_FILE = path.join(DATA_DIR, "livetv-channels.json");
const EPG_FILE = path.join(DATA_DIR, "livetv-epg.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createId(prefix = "src") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function makeChannelId(value, fallback) {
  return String(value || fallback || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "channel";
}

function getDefaultLiveTvConfig() {
  return {
    playlistUrl: "",
    epgUrl: "",
    xteveUrl: "",
    liveTvSources: [],
    channelOverrides: {},
    lastRefresh: null,
  };
}

function normalizeLiveTvConfig(config = {}) {
  const next = {
    ...getDefaultLiveTvConfig(),
    ...config,
  };

  if (!Array.isArray(next.liveTvSources)) {
    next.liveTvSources = [];
  }

  if (!next.channelOverrides || typeof next.channelOverrides !== "object") {
    next.channelOverrides = {};
  }

  // Backwards compatibility with old single M3U field
  if (
    next.playlistUrl &&
    !next.liveTvSources.some((source) => source.legacyKey === "playlistUrl")
  ) {
    next.liveTvSources.push({
      id: "source_main_m3u",
      legacyKey: "playlistUrl",
      name: "M3U Playlist",
      type: "m3u",
      url: next.playlistUrl,
      serverUrl: "",
      username: "",
      password: "",
      output: "m3u8",
      epgUrl: next.epgUrl || "",
      enabled: true,
      priority: 10,
      builtIn: false,
      lastScan: null,
      channelCount: 0,
      epgProgramCount: 0,
    });
  }

  // Backwards compatibility with old xTeVe/second M3U field
  if (
    next.xteveUrl &&
    !next.liveTvSources.some((source) => source.legacyKey === "xteveUrl")
  ) {
    next.liveTvSources.push({
      id: "source_second_m3u",
      legacyKey: "xteveUrl",
      name: "Second M3U / xTeVe",
      type: "m3u",
      url: next.xteveUrl,
      serverUrl: "",
      username: "",
      password: "",
      output: "m3u8",
      epgUrl: "",
      enabled: true,
      priority: 20,
      builtIn: false,
      lastScan: null,
      channelCount: 0,
      epgProgramCount: 0,
    });
  }

  next.liveTvSources = next.liveTvSources.map((source, index) => ({
    id: source.id || createId("source"),
    name: source.name || `M3U Source ${index + 1}`,
    type: source.type || "m3u",
    url: source.url || "",
    serverUrl: source.serverUrl || "",
    username: source.username || "",
    password: source.password || "",
    output: source.output || "m3u8",
    epgUrl: source.epgUrl || "",
    enabled: source.enabled !== false,
    priority: Number.isFinite(Number(source.priority))
      ? Number(source.priority)
      : (index + 1) * 10,
    builtIn: Boolean(source.builtIn),
    lastScan: source.lastScan || null,
    channelCount: Number(source.channelCount || 0),
    epgProgramCount: Number(source.epgProgramCount || 0),
    legacyKey: source.legacyKey || undefined,
  }));

  return next;
}

function getLiveTvConfig() {
  ensureDataDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    return getDefaultLiveTvConfig();
  }

  try {
    return normalizeLiveTvConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
  } catch {
    return getDefaultLiveTvConfig();
  }
}

function saveLiveTvConfig(config) {
  ensureDataDir();

  const existing = getLiveTvConfig();
  const next = normalizeLiveTvConfig({
    ...existing,
    ...config,
    updatedAt: new Date().toISOString(),
  });

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function getLiveTvChannels() {
  ensureDataDir();

  if (!fs.existsSync(CHANNELS_FILE)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveLiveTvChannels(channels) {
  ensureDataDir();
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
  return channels;
}

function getLiveTvEpg() {
  ensureDataDir();

  if (!fs.existsSync(EPG_FILE)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(EPG_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveLiveTvEpg(programs) {
  ensureDataDir();
  fs.writeFileSync(EPG_FILE, JSON.stringify(programs, null, 2));
  return programs;
}

function parseExtinfAttributes(line) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9-_]+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(line)) !== null) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseM3U(text, source = {}) {
  const sourceId = source.id || "unknown-source";
  const sourceName = source.name || "Unknown Source";

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const channels = [];
  let pendingInfo = null;

  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      const attrs = parseExtinfAttributes(line);
      const commaIndex = line.lastIndexOf(",");
      const fallbackName =
        commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "Unknown Channel";

pendingInfo = {
  id: attrs["tvg-id"] || attrs["channel-id"] || "",
  tvgId: attrs["tvg-id"] || attrs["channel-id"] || "",
  name: attrs["tvg-name"] || fallbackName,
  logo: attrs["tvg-logo"] || "",
  group: attrs["group-title"] || "Other",
};

      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    if (pendingInfo && /^https?:\/\//i.test(line)) {
      const channelId = makeChannelId(
        pendingInfo.id || pendingInfo.name,
        `channel-${channels.length + 1}`
      );

      const channel = {
        key: `${sourceId}::${channelId}::${channels.length + 1}`,
        sourceId,
        sourceName,
        id: channelId,
        name: pendingInfo.name || `Channel ${channels.length + 1}`,
        logo: pendingInfo.logo || "",
        group: pendingInfo.group || "Other",
        url: line,
        source: "m3u",
        visible: true,
        favorite: false,
		tvgId: pendingInfo.tvgId || "",
      };

      channels.push(channel);
      pendingInfo = null;
    }
  }

  return channels;
}

function applyChannelOverrides(channels, overrides = {}) {
  return channels.map((channel) => {
    const override = overrides[channel.key] || {};

    return {
      ...channel,
      visible: override.visible !== undefined ? Boolean(override.visible) : channel.visible !== false,
      favorite: Boolean(override.favorite),
      customName: override.customName || "",
      customGroup: override.customGroup || "",
      displayName: override.customName || channel.name,
      displayGroup: override.customGroup || channel.group,
      sortOrder: override.sortOrder ?? null,
    };
  });
}

function dedupeChannels(channels) {
  const deduped = [];
  const seen = new Set();

  for (const channel of channels) {
    const dedupeKey = channel.url || `${channel.sourceId}::${channel.id}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(channel);
  }

  return deduped;
}

async function fetchPlaylistText(playlistUrl) {
  const response = await fetch(playlistUrl, {
    headers: {
      "User-Agent": "Homestead LiveTV/1.0",
      Accept: "application/x-mpegURL,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`Playlist fetch failed: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function scanXtreamApiSource(source = {}) {
  const categoriesUrl = buildXtreamPlayerApiUrl(source, "get_live_categories");
  const streamsUrl = buildXtreamPlayerApiUrl(source, "get_live_streams");

  const [categoriesText, streamsText] = await Promise.all([
    fetchPlaylistText(categoriesUrl),
    fetchPlaylistText(streamsUrl),
  ]);

  const categories = JSON.parse(categoriesText);
  const streams = JSON.parse(streamsText);

  const categoryMap = new Map(
    Array.isArray(categories)
      ? categories.map((category) => [
          String(category.category_id),
          category.category_name || "Other",
        ])
      : []
  );

  if (!Array.isArray(streams)) {
    throw new Error("Xtream API did not return a live stream list");
  }

  return streams.map((stream, index) => {
    const channelId = makeChannelId(
      stream.epg_channel_id || stream.name || stream.stream_id,
      `channel-${index + 1}`
    );

    return {
      key: `${source.id}::${channelId}::${stream.stream_id}`,
      sourceId: source.id,
      sourceName: source.name || "IPTV Login",
      id: channelId,
      tvgId: stream.epg_channel_id || "",
      name: stream.name || `Channel ${index + 1}`,
      logo: stream.stream_icon || "",
      group: categoryMap.get(String(stream.category_id)) || "Other",
      url: stream.direct_source || buildXtreamStreamUrl(source, stream.stream_id),
      streamId: stream.stream_id,
      source: "xtream-api",
      visible: true,
      favorite: false,
    };
  });
}

async function scanLiveTvSource(source) {
  if (source.type === "xtream") {
    return await scanXtreamApiSource(source);
  }

  const playlistUrl = source.url || "";

  if (!playlistUrl) {
    throw new Error("Source URL is required");
  }

  const text = await fetchPlaylistText(playlistUrl);
  return parseM3U(text, source);
}

function cleanServerUrl(serverUrl = "") {
  return String(serverUrl || "").trim().replace(/\/+$/, "");
}

function buildXtreamM3uUrl(source = {}) {
  const serverUrl = cleanServerUrl(source.serverUrl);
  const username = encodeURIComponent(source.username || "");
  const password = encodeURIComponent(source.password || "");

  return `${serverUrl}/get.php?username=${username}&password=${password}&type=m3u_plus&output=m3u8`;
}

function buildXtreamPlayerApiUrl(source = {}, action = "") {
  const serverUrl = cleanServerUrl(source.serverUrl);
  const username = encodeURIComponent(source.username || "");
  const password = encodeURIComponent(source.password || "");

  const actionPart = action ? `&action=${encodeURIComponent(action)}` : "";

  return `${serverUrl}/player_api.php?username=${username}&password=${password}${actionPart}`;
}

function buildXtreamStreamUrl(source = {}, streamId) {
  const serverUrl = cleanServerUrl(source.serverUrl);
  const username = encodeURIComponent(source.username || "");
  const password = encodeURIComponent(source.password || "");
  const output = source.output || "m3u8";

  return `${serverUrl}/live/${username}/${password}/${streamId}.${output}`;
}

function buildXtreamEpgUrl(source = {}) {
  const serverUrl = cleanServerUrl(source.serverUrl);
  const username = encodeURIComponent(source.username || "");
  const password = encodeURIComponent(source.password || "");

  return `${serverUrl}/xmltv.php?username=${username}&password=${password}`;
}

function decodeXmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseXmltvDate(value = "") {
  const match = String(value).match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/
  );

  if (!match) return null;

  const [, year, month, day, hour, minute, second, offset] = match;

  if (!offset) {
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      )
    ).toISOString();
  }

  const offsetSign = offset.startsWith("-") ? -1 : 1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(3, 5));
  const offsetTotalMinutes = offsetSign * (offsetHours * 60 + offsetMinutes);

  const utcMs =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    ) -
    offsetTotalMinutes * 60 * 1000;

  return new Date(utcMs).toISOString();
}

function getTagText(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function parseXMLTV(xmlText, source = {}) {
  const programs = [];
  const programmeRegex = /<programme\s+([^>]*)>([\s\S]*?)<\/programme>/gi;
  const attrRegex = /([a-zA-Z0-9-_]+)="([^"]*)"/g;

  let programmeMatch;

  while ((programmeMatch = programmeRegex.exec(xmlText)) !== null) {
    const attrText = programmeMatch[1];
    const body = programmeMatch[2];
    const attrs = {};
    let attrMatch;

    while ((attrMatch = attrRegex.exec(attrText)) !== null) {
      attrs[attrMatch[1]] = decodeXmlEntities(attrMatch[2]);
    }

    const start = parseXmltvDate(attrs.start);
    const stop = parseXmltvDate(attrs.stop);

    if (!attrs.channel || !start || !stop) continue;

    programs.push({
      sourceId: source.id || "",
      sourceName: source.name || "",
      channel: attrs.channel,
      title: getTagText(body, "title") || "Untitled Program",
      subtitle: getTagText(body, "sub-title"),
      description: getTagText(body, "desc"),
      category: getTagText(body, "category"),
      start,
      stop,
    });
  }

  return programs;
}

async function fetchEpgPrograms(source = {}) {
  let epgUrl = source.epgUrl || "";

  if (!epgUrl && source.type === "xtream") {
    epgUrl = buildXtreamEpgUrl(source);
  }

  if (!epgUrl) {
    return [];
  }

  const text = await fetchPlaylistText(epgUrl);
  return parseXMLTV(text, source);
}

module.exports = {
  getLiveTvConfig,
  saveLiveTvConfig,
  getLiveTvChannels,
  saveLiveTvChannels,
  parseM3U,
  fetchPlaylistText,
  scanLiveTvSource,
  applyChannelOverrides,
  dedupeChannels,
  createId,
  getLiveTvEpg,
saveLiveTvEpg,
parseXMLTV,
fetchEpgPrograms,
buildXtreamM3uUrl,
buildXtreamEpgUrl,
buildXtreamPlayerApiUrl,
buildXtreamStreamUrl,
scanXtreamApiSource,
};