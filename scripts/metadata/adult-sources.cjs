const ADULT_BROWSE_ONLY_SOURCE_IDS = new Set([
  "dirtypornpics",
  "freepussypics",
  "hotnudegirls",
  "hotblondesporn",
  "luxuretv",
  "euroxxx",
  "porndude",
  "rule34",
]);

const ADULT_BROWSE_ONLY_DOMAINS = new Set([
  "dirtypornpics.com",
  "freepussypics.net",
  "hotnudegirls.net",
  "hotblondesporn.com",
  "luxuretv.com",
  "euroxxx.net",
  "theporndude.com",
  "rule34.xxx",
]);

function normalizeAdultSourceDomain(value = "") {
  try {
    return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return String(value || "")
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0];
  }
}

function isAdultBrowseOnlySource(source = {}) {
  if (!source) return false;
  if (source.discoveryScope === "browse") return true;
  if (source.discoveryScope === "person-search") return false;

  const id = String(source.id || "").toLowerCase();
  if (ADULT_BROWSE_ONLY_SOURCE_IDS.has(id)) return true;

  const domain = normalizeAdultSourceDomain(source.baseUrl || source.searchUrlTemplate || "");
  if (ADULT_BROWSE_ONLY_DOMAINS.has(domain)) return true;

  const modes = Array.isArray(source.searchModes)
    ? source.searchModes.map((mode) => String(mode).toLowerCase())
    : [];
  const category = String(source.category || "").toLowerCase();
  const hasPersonCapability = Boolean(
    source.supportsFixMatch ||
    source.supportsBulkMetadata ||
    source.directProfileOnly ||
    modes.some((mode) => ["performer", "celebrity", "metadata"].includes(mode))
  );
  const browseSignals =
    modes.some((mode) => ["general", "browse"].includes(mode)) ||
    /general browse|source directory/.test(category);

  return browseSignals && !hasPersonCapability;
}

function sourceSupportsAdultPersonSearch(source = {}) {
  if (!source || source.enabled === false || source.status === "disabled") return false;
  if (isAdultBrowseOnlySource(source)) return false;
  if (source.discoveryScope === "person-search" || source.discoveryScope === "both") return true;

  const modes = Array.isArray(source.searchModes)
    ? source.searchModes.map((mode) => String(mode).toLowerCase())
    : [];
  const supports = Array.isArray(source.supports) ? source.supports : [];

  return Boolean(
    source.supportsFixMatch ||
    source.supportsBulkMetadata ||
    source.directProfileOnly ||
    modes.some((mode) => ["performer", "celebrity", "metadata"].includes(mode)) ||
    supports.some((type) =>
      ["performerMetadata", "biography", "bio", "identifiers", "socials"].includes(type)
    )
  );
}

const DEFAULT_ADULT_SOURCES = [
  {
    "id": "iafd",
    "name": "IAFD",
    "role": "performer",
    "category": "primary metadata / scene timeline",
    "badges": [
      "Priority",
      "Metadata",
      "Timeline",
      "Credits"
    ],
    "icon": "ID",
    "baseUrl": "https://www.iafd.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "identifiers",
      "timeline",
      "scenes",
      "credits"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 5,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.iafd.com/results.asp?searchtype=comprehensive&searchstring={queryPlus}",
    "providerIdKey": "iafd",
    "providerUrlTemplate": "https://www.iafd.com/person.rme/perfid={providerId}/gender=female",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Adult source registry / scene timeline provider. Kept after Wikidata, Wikipedia, and DefineBabe in performer profile matching."
  },
  {
    "id": "xxxbios",
    "name": "XXXBios",
    "role": "performer",
    "category": "primary bio / socials / awards",
    "badges": [
      "Priority",
      "Bio",
      "Socials",
      "Awards"
    ],
    "icon": "XXX",
    "baseUrl": "https://www.xxxbios.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "bio",
      "socials",
      "awards",
      "externalLinks"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 2,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.xxxbios.com/?s={queryPlus}",
    "providerIdKey": "xxxbios",
    "providerUrlTemplate": "https://www.xxxbios.com/female-pornstar/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Best long-form bio/social/awards provider."
  },
  {
    "id": "wikidata",
    "name": "Wikidata",
    "role": "both",
    "category": "identity / external ID bridge",
    "badges": [
      "ID Bridge",
      "Wikidata",
      "Wikipedia"
    ],
    "icon": "WD",
    "baseUrl": "https://www.wikidata.org",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "identifiers",
      "externalLinks"
    ],
    "searchModes": [
      "performer",
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity"
    ],
    "priority": 1,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.wikidata.org/w/index.php?search={queryPlus}",
    "providerIdKey": "wikidata",
    "providerUrlTemplate": "https://www.wikidata.org/wiki/{providerId}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Highest-priority identity bridge for performers; second behind TMDB for celebrities. Provides aliases, external IDs, birth data, occupation, image, and Wikipedia link when available."
  },
  {
    "id": "wikipedia",
    "name": "Wikipedia",
    "role": "both",
    "category": "biography / public image fallback",
    "badges": [
      "Bio",
      "Image",
      "Context"
    ],
    "icon": "W",
    "baseUrl": "https://en.wikipedia.org",
    "enabled": true,
    "supports": [
      "biography",
      "publicImage",
      "occupation",
      "externalLinks"
    ],
    "searchModes": [
      "performer",
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity"
    ],
    "priority": 2,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://en.wikipedia.org/w/index.php?search={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Biography, public image, occupation/context, and external-link fallback. Usually reached through Wikidata/Wikipedia summary in auto-fetch."
  },
  {
    "id": "eporner",
    "name": "Eporner",
    "role": "performer",
    "category": "rich profile / video discovery",
    "badges": [
      "Metadata",
      "Videos",
      "Profile"
    ],
    "icon": "E",
    "baseUrl": "https://www.eporner.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "scenes",
      "videos",
      "photos",
      "socials"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 4,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.eporner.com/search/{query}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Search works; performer profile has metadata, aliases, socials, bio, counts and videos."
  },
  {
    "id": "babewiki",
    "name": "BabeWiki",
    "role": "performer",
    "category": "profile metadata / artwork",
    "badges": [
      "Metadata",
      "Photos",
      "Profile"
    ],
    "icon": "BW",
    "baseUrl": "https://www.babewiki.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "artwork",
      "photos",
      "bio",
      "faceSearch"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "artwork",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 5,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "supportsFaceSearch": true,
    "faceSearchProvider": true,
    "faceSearchUrl": "https://www.babewiki.com/face-search",
    "faceSearchMode": "external-manual-upload",
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "slugOnly",
    "searchUrlTemplate": "https://www.babewiki.com/performer/{querySlug}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Direct performer slug pages are best; avoid adding filters to slug. Also used as the default external provider lane for Search by Photo."
  },
  {
    "id": "definebabe",
    "name": "DefineBabe",
    "role": "performer",
    "category": "metadata / media / paysites",
    "badges": [
      "Metadata",
      "Photos",
      "Videos",
      "Paysites"
    ],
    "icon": "DB",
    "baseUrl": "https://www.definebabe.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "photos",
      "videos",
      "paysites",
      "artwork"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "artwork",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 3,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.definebabe.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {
      "riley reid": "https://www.definebabe.com/models/lkpe/riley-reid/"
    },
    "directProfileOnly": false,
    "notes": "Performer profile source for aliases, birthday, birthplace, height, weight, measurements, photos/videos counts, and social links."
  },
  {
    "id": "freeones",
    "name": "FreeOnes",
    "role": "performer",
    "category": "performer profile directory / biography",
    "badges": [
      "Metadata",
      "Bio",
      "Profiles"
    ],
    "icon": "FO",
    "baseUrl": "https://www.freeones.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "bio",
      "photos",
      "externalLinks"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "artwork",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 6,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.freeones.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Performer profile directory/search source. Used for Advanced Person Search, not generic Browse Media."
  },
  {
    "id": "picsx",
    "name": "Pics-X",
    "role": "performer",
    "category": "photos / secondary metadata",
    "badges": [
      "Photos",
      "Artwork",
      "Metadata"
    ],
    "icon": "PX",
    "baseUrl": "https://www.pics-x.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "photos",
      "artwork",
      "photoSets",
      "galleries"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 7,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.pics-x.com/search?terms={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {
      "presley dawson": "https://www.pics-x.com/gallery/362037/pretty-pussy-nubiles#image-61",
      "persley dawson": "https://www.pics-x.com/gallery/362037/pretty-pussy-nubiles#image-61"
    },
    "directProfileOnly": false,
    "notes": "Correct query format uses search?terms=. Good for gallery/profile metadata and photos."
  },
  {
    "id": "youporn",
    "name": "YouPorn",
    "role": "performer",
    "category": "MindGeek-style profile / videos",
    "badges": [
      "Metadata",
      "Videos",
      "Provider Stats"
    ],
    "icon": "YP",
    "baseUrl": "https://www.youporn.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "scenes",
      "providerStats"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 8,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.youporn.com/search/?query={queryPlus}",
    "providerIdKey": "youporn",
    "providerUrlTemplate": "https://www.youporn.com/pornstar/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Same parser family. Store views/subscribers/rank only under providerStats, not global profile stats."
  },
  {
    "id": "redtube",
    "name": "RedTube",
    "role": "performer",
    "category": "MindGeek-style profile / videos",
    "badges": [
      "Metadata",
      "Videos",
      "Provider Stats"
    ],
    "icon": "RT",
    "baseUrl": "https://www.redtube.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "scenes",
      "providerStats"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 8,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.redtube.com/?search={queryPlus}",
    "providerIdKey": "redtube",
    "providerUrlTemplate": "https://www.redtube.com/pornstar/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Same parser family. Store views/subscribers/rank only under providerStats, not global profile stats."
  },
  {
    "id": "tube8",
    "name": "Tube8",
    "role": "performer",
    "category": "MindGeek-style profile / videos",
    "badges": [
      "Metadata",
      "Videos",
      "Provider Stats"
    ],
    "icon": "T8",
    "baseUrl": "https://www.tube8.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "scenes",
      "providerStats"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 8,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.tube8.com/searches.html?q={queryPlus}",
    "providerIdKey": "tube8",
    "providerUrlTemplate": "https://www.tube8.com/pornstar/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Same parser family. Store views/subscribers/rank only under providerStats, not global profile stats."
  },
  {
    "id": "pornhub",
    "name": "Pornhub",
    "role": "performer",
    "category": "profile / photos / videos",
    "badges": [
      "Metadata",
      "Videos",
      "Requires AV"
    ],
    "icon": "PH",
    "baseUrl": "https://www.pornhub.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "photos",
      "providerStats"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 9,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.pornhub.com/video/search?search={queryPlus}",
    "providerIdKey": "pornhub",
    "providerUrlTemplate": "https://www.pornhub.com/pornstar/{providerId}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "High-value profile/video/photo provider; age verification/session may be required."
  },
  {
    "id": "xhamster",
    "name": "xHamster",
    "role": "performer",
    "category": "profile / videos",
    "badges": [
      "Metadata",
      "Videos",
      "Profile"
    ],
    "icon": "XH",
    "baseUrl": "https://xhamster.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "photos",
      "providerStats"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 10,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "gender",
      "ethnicity",
      "breastType",
      "cupSize",
      "tattoos",
      "piercings",
      "hairColor",
      "country",
      "ageRange",
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://xhamster.com/search/{queryPlus}",
    "providerIdKey": "xhamster",
    "providerUrlTemplate": "https://xhamster.com/pornstars/{providerId}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Good performer profile and video discovery provider."
  },
  {
    "id": "babeWikiMaybe",
    "name": "BabeWiki alt",
    "role": "performer",
    "category": "disabled duplicate",
    "badges": [
      "Disabled"
    ],
    "icon": "BW",
    "baseUrl": "https://www.babewiki.com",
    "enabled": false,
    "supports": [],
    "searchModes": [],
    "profileTypes": [
      "performer"
    ],
    "priority": 999,
    "requiresSession": false,
    "status": "disabled",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.babewiki.com/performers?search={query}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Old search URL kept disabled; direct performer URL is preferred."
  },

  {
    "id": "thelordofporn",
    "name": "The Lord of Porn",
    "role": "performer",
    "category": "performer metadata, photos, videos, and browse profiles",
    "badges": [
      "Metadata",
      "Biography",
      "Photos",
      "Videos",
      "Socials",
      "Browse"
    ],
    "icon": "LP",
    "baseUrl": "https://thelordofporn.com",
    "enabled": true,
    "discoveryScope": "both",
    "supports": [
      "performerMetadata",
      "biography",
      "bodyDetails",
      "socials",
      "photos",
      "galleries",
      "videos",
      "artwork",
      "identifiers"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "artwork",
      "media",
      "browse",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 12,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {
      "biography": 10,
      "birthday": 9,
      "birthPlace": 9,
      "height": 9,
      "weight": 9,
      "measurements": 9,
      "hairColor": 8,
      "eyeColor": 8,
      "socials": 8,
      "artwork": 8,
      "photos": 7,
      "videos": 7
    },
    "supportedFilters": [
      "performer",
      "country",
      "age",
      "bodyType",
      "hairColor",
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "browseMode": "performer-index",
    "searchUrlTemplate": "https://thelordofporn.com/?s={queryPlus}",
    "providerIdKey": "thelordofporn",
    "providerUrlTemplate": "https://thelordofporn.com/?s={queryPlus}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Hybrid performer reference and browse source with biography, body metadata, photos, videos, rankings, awards, and social links."
  },
  {
    "id": "coedcherry",
    "name": "CoedCherry",
    "role": "performer",
    "category": "photo/gallery provider",
    "badges": [
      "Photos",
      "Gallery",
      "Import Candidate"
    ],
    "icon": "CC",
    "baseUrl": "https://www.coedcherry.com",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "artwork"
    ],
    "searchModes": [
      "performer",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 30,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor",
      "ethnicity",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "browseMode": "tag-index",
    "tagIndexUrl": "https://www.coedcherry.com/tags/",
    "tagUrlTemplate": "https://www.coedcherry.com/tags/{tagSlug}/",
    "searchUrlTemplate": "https://www.coedcherry.com/search/{querySlug}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Great image/gallery provider; not performer metadata."
  },
  {
    "id": "babesource",
    "name": "BabeSource",
    "role": "performer",
    "category": "media/photo galleries",
    "badges": [
      "Photos",
      "Media",
      "Known Slugs"
    ],
    "icon": "BS",
    "baseUrl": "https://babesource.com",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "videos",
      "artwork"
    ],
    "searchModes": [
      "performer",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 32,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor",
      "ethnicity"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://babesource.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {
      "riley reid": "https://babesource.com/pornstars/riley-reid-51/"
    },
    "directProfileOnly": false,
    "notes": "Media/photo results only; known performer slug mappings when available."
  },
  {
    "id": "nubiles",
    "name": "Nubiles",
    "role": "performer",
    "category": "direct profile / limited public photos",
    "badges": [
      "Direct Profile",
      "Photos",
      "Session Enhanced"
    ],
    "icon": "N",
    "baseUrl": "https://www.nubiles.net",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "photoSets",
      "artwork",
      "photos"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "artwork",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 31,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor",
      "ethnicity"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.nubiles.net/search/{query}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {
      "riley reid": "https://nubiles.net/model/profile/1566/riley-reid?coupon=63402&c=current-gallery-player-ad",
      "presley dawson": "https://nubiles.net/model/profile/2240/presley-dawson?coupon=63402&c=current-gallery-player-ad"
    },
    "directProfileOnly": true,
    "notes": "Direct-profile/manual mapping provider; limited public data without session."
  },
  {
    "id": "ftvgirls",
    "name": "FTVGirls",
    "role": "performer",
    "category": "magazine/artwork provider",
    "badges": [
      "Magazine",
      "Covers",
      "Session"
    ],
    "icon": "FTV",
    "baseUrl": "https://www.ftvgirls.com",
    "enabled": true,
    "supports": [
      "photos",
      "videos",
      "artwork",
      "covers"
    ],
    "searchModes": [
      "artwork",
      "media",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 45,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.ftvgirls.com/search/?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Good for magazine/cover artwork and recent updates; membership for full access."
  },
  {
    "id": "brazzers",
    "name": "Brazzers",
    "role": "performer",
    "category": "studio profile / scenes",
    "badges": [
      "Studio",
      "Metadata",
      "Scenes",
      "Session"
    ],
    "icon": "BZ",
    "baseUrl": "https://www.brazzers.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "scenes",
      "studio",
      "artwork"
    ],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 20,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.brazzers.com/searchmodels?q={query}&source=p1",
    "providerIdKey": "brazzers",
    "providerUrlTemplate": "https://www.brazzers.com/pornstar/{providerId}/{querySlug}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Searchmodels works; direct profile ID is best. Membership may be required."
  },
  {
    "id": "teamskeet",
    "name": "TeamSkeet",
    "role": "performer",
    "category": "studio artwork / media",
    "badges": [
      "Studio",
      "Poster",
      "Banner",
      "Scenes",
      "Session"
    ],
    "icon": "TS",
    "baseUrl": "https://www.teamskeet.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "studio",
      "artwork",
      "banner",
      "poster"
    ],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 22,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.teamskeet.com/models/{querySlug}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Good poster/banner/profile media page; likely membership for full access."
  },
  {
    "id": "iknowthatgirl",
    "name": "IKnowThatGirl",
    "role": "performer",
    "category": "studio profile / limited media",
    "badges": [
      "Studio",
      "Metadata",
      "Limited Media",
      "Session"
    ],
    "icon": "IK",
    "baseUrl": "https://www.iknowthatgirl.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "videos",
      "scenes",
      "studio",
      "artwork"
    ],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 23,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.iknowthatgirl.com/models?q={query}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Studio model profile with useful metadata but limited media."
  },
  {
    "id": "adulttime",
    "name": "AdultTime",
    "role": "performer",
    "category": "studio actor page / media",
    "badges": [
      "Studio",
      "Scenes",
      "Session"
    ],
    "icon": "AT",
    "baseUrl": "https://www.adulttime.com",
    "enabled": true,
    "supports": [],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 34,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.adulttime.com/actor/{querySlug}-porn-videos",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Actor page URL works; evaluate parser later."
  },
  {
    "id": "bangbros",
    "name": "BangBros",
    "role": "performer",
    "category": "studio scenes",
    "badges": [
      "Studio",
      "Scenes",
      "Session"
    ],
    "icon": "BB",
    "baseUrl": "https://www.bangbros.com",
    "enabled": true,
    "supports": [],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 35,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.bangbros.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Good studio media results; membership for full access."
  },
  {
    "id": "bang",
    "name": "Bang!",
    "role": "performer",
    "category": "studio media browser",
    "badges": [
      "Studio",
      "Media Browser",
      "Session"
    ],
    "icon": "B!",
    "baseUrl": "https://www.bang.com",
    "enabled": true,
    "supports": [],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 36,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.bang.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Good media browser/search; membership for full access."
  },
  {
    "id": "xempire",
    "name": "XEmpire",
    "role": "performer",
    "category": "DVD/video discovery",
    "badges": [
      "DVDs",
      "Videos",
      "Session"
    ],
    "icon": "XE",
    "baseUrl": "https://www.xempire.com",
    "enabled": true,
    "supports": [
      "videos",
      "dvds",
      "scenes",
      "studio",
      "sourceReferences"
    ],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 37,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.xempire.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Has DVDs/videos and light metadata; membership for full access."
  },
  {
    "id": "puretaboo",
    "name": "PureTaboo",
    "role": "performer",
    "category": "TV-style studio browser",
    "badges": [
      "Studio",
      "Media Browser",
      "Session"
    ],
    "icon": "PT",
    "baseUrl": "https://www.puretaboo.com",
    "enabled": true,
    "supports": [],
    "searchModes": [
      "performer",
      "media",
      "scenes",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 38,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.puretaboo.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "TV-library-like media browsing; membership for full access."
  },
  {
    "id": "realitykings",
    "name": "RealityKings",
    "role": "performer",
    "category": "studio media / needs URL fix",
    "badges": [
      "Studio",
      "Needs URL Fix"
    ],
    "icon": "RK",
    "baseUrl": "https://www.realitykings.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "studio"
    ],
    "searchModes": [
      "studio",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 60,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.realitykings.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Not very detailed; search URL still needs correction."
  },
  {
    "id": "stunning18",
    "name": "Stunning18",
    "role": "performer",
    "category": "niche gallery provider",
    "badges": [
      "Gallery",
      "Data Limited",
      "Session"
    ],
    "icon": "S18",
    "baseUrl": "https://www.stunning18.com",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "artwork"
    ],
    "searchModes": [
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 44,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.stunning18.com/search/{queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Niche photo/gallery provider; only useful when performer exists."
  },
  {
    "id": "vrporn",
    "name": "VRPorn",
    "role": "performer",
    "category": "VR performer/videos",
    "badges": [
      "VR",
      "Metadata",
      "Videos"
    ],
    "icon": "VR",
    "baseUrl": "https://vrporn.com",
    "enabled": true,
    "supports": [
      "performerMetadata",
      "vr",
      "videos",
      "scenes"
    ],
    "searchModes": [
      "performer",
      "metadata",
      "media",
      "vr",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 24,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://vrporn.com/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "https://vrporn.com/pornstars/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Search works; performer page is /pornstars/{slug}/. Best for VR-specific metadata and scenes."
  },
  {
    "id": "mylf",
    "name": "MYLF",
    "role": "performer",
    "category": "mature niche provider",
    "badges": [
      "Mature",
      "Studio",
      "Niche"
    ],
    "icon": "MY",
    "baseUrl": "https://www.mylf.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "studio"
    ],
    "searchModes": [
      "mature",
      "media",
      "studio",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 70,
    "requiresSession": true,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.mylf.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Mature/MILF niche provider; low priority for normal performer searches."
  },
  {
    "id": "pornone",
    "name": "PornOne",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "1",
    "baseUrl": "https://www.pornone.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.pornone.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "spicevids",
    "name": "SpiceVids",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "SV",
    "baseUrl": "https://www.spicevids.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.spicevids.com/searchvideos?q={query}&source=sv",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "faphouse",
    "name": "FapHouse",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "FH",
    "baseUrl": "https://www.faphouse.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.faphouse.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "pornoflix",
    "name": "PornoFlix",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "PF",
    "baseUrl": "https://www.pornoflix.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.pornoflix.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "neporn",
    "name": "NePorn",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "NP",
    "baseUrl": "https://neporn.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://neporn.com/search/?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "tubeorigin",
    "name": "TubeOrigin",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "TO",
    "baseUrl": "https://www.tubeorigin.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.tubeorigin.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video/channel search; not metadata/Fix Match."
  },
  {
    "id": "galaxyporn",
    "name": "GalaxyPorn",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only",
      "Import Candidate"
    ],
    "icon": "GX",
    "baseUrl": "https://galaxyporn.net",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences",
      "downloads"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://galaxyporn.net/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "download/import candidate; not metadata/Fix Match."
  },
  {
    "id": "upornia",
    "name": "Upornia",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only",
      "Import Candidate"
    ],
    "icon": "UP",
    "baseUrl": "https://upornia.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences",
      "downloads"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://upornia.com/search/1/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "download/import candidate; not metadata/Fix Match."
  },
  {
    "id": "hdzog",
    "name": "HDZog",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only",
      "Import Candidate"
    ],
    "icon": "HD",
    "baseUrl": "https://hdzog.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences",
      "downloads"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://hdzog.com/search/1/?s={query}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "pornlib",
    "name": "PornLib",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only",
      "Import Candidate"
    ],
    "icon": "PL",
    "baseUrl": "https://www.pornlib.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences",
      "downloads"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.pornlib.com/search/videos/{queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "sextu",
    "name": "SexTu / FullVideosPorn",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only",
      "Import Candidate"
    ],
    "icon": "SX",
    "baseUrl": "https://fullvideosporn.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences",
      "downloads"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://fullvideosporn.com/search/{queryPlus}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "media page only; not metadata/Fix Match."
  },
  {
    "id": "hutporner",
    "name": "HutPorner / HornySimp",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "HP",
    "baseUrl": "https://w11.hornysimp.com.lv",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://w11.hornysimp.com.lv/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "video search; not metadata/Fix Match."
  },
  {
    "id": "ogporn",
    "name": "OGPorn",
    "role": "performer",
    "category": "media/video only",
    "badges": [
      "Videos",
      "Media Only"
    ],
    "icon": "OG",
    "baseUrl": "https://ogporn.com",
    "enabled": true,
    "supports": [
      "videos",
      "scenes",
      "sourceReferences"
    ],
    "searchModes": [
      "media",
      "scenes",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": true,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality",
      "studio"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://ogporn.com/model/{querySlug}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "low-value media; not metadata/Fix Match."
  },
  {
    "id": "dirtypornpics",
    "name": "DirtyPornPics",
    "role": "both",
    "category": "general browse / tags",
    "badges": [
      "General Browse",
      "Tags",
      "Media"
    ],
    "icon": "DP",
    "baseUrl": "https://www.dirtypornpics.com",
    "enabled": true,
    "supports": [
      "videos",
      "photos",
      "galleries",
      "tags"
    ],
    "searchModes": [
      "general",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 90,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.dirtypornpics.com/search/{querySlug}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "general tag/photo galleries"
  },
  {
    "id": "freepussypics",
    "name": "FreePussyPics.net",
    "role": "both",
    "category": "general browse / photo galleries",
    "badges": [
      "General Browse",
      "Photos",
      "Galleries"
    ],
    "icon": "FP",
    "baseUrl": "https://www.freepussypics.net",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "images",
      "tags"
    ],
    "searchModes": [
      "general",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 90,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.freepussypics.net/search/{querySlug}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "General public adult photo/gallery browsing source. Browse/import only; not a profile identity or metadata source."
  },
  {
    "id": "hotnudegirls",
    "name": "HotNudeGirls.net",
    "role": "both",
    "category": "general browse / photo galleries",
    "badges": [
      "General Browse",
      "Photos",
      "Galleries"
    ],
    "icon": "HNG",
    "baseUrl": "https://hotnudegirls.net",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "images",
      "tags"
    ],
    "searchModes": [
      "general",
      "browse",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 91,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor",
      "bodyType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "browseMode": "category-tiles",
    "tagIndexUrl": "https://hotnudegirls.net/",
    "tagUrlTemplate": "https://hotnudegirls.net/free/{tagSlug}-pics/",
    "searchUrlTemplate": "https://hotnudegirls.net/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "General public adult photo/gallery browsing source. Browse/import only; not a profile identity or metadata source."
  },
  {
    "id": "hotblondesporn",
    "name": "HotBlondesPorn.com",
    "role": "both",
    "category": "general browse / photo galleries",
    "badges": [
      "General Browse",
      "Photos",
      "Galleries"
    ],
    "icon": "HBP",
    "baseUrl": "https://www.hotblondesporn.com",
    "enabled": true,
    "supports": [
      "photos",
      "galleries",
      "images",
      "tags"
    ],
    "searchModes": [
      "general",
      "browse",
      "artwork",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 92,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "hairColor",
      "bodyType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "browseMode": "category-tiles",
    "tagIndexUrl": "https://www.hotblondesporn.com/",
    "searchUrlTemplate": "https://www.hotblondesporn.com/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "General public adult blonde/photo/gallery browsing source. Browse/import only; not a profile identity or metadata source."
  },
  {
    "id": "luxuretv",
    "name": "LuxureTV",
    "role": "both",
    "category": "general browse / tags",
    "badges": [
      "General Browse",
      "Tags",
      "Media"
    ],
    "icon": "LX",
    "baseUrl": "https://www.luxuretv.com",
    "enabled": true,
    "supports": [
      "videos",
      "photos",
      "galleries",
      "tags"
    ],
    "searchModes": [
      "general",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 90,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.luxuretv.com/search/{query}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "general video browsing"
  },
  {
    "id": "euroxxx",
    "name": "EuroXXX",
    "role": "both",
    "category": "general browse / tags",
    "badges": [
      "General Browse",
      "Tags",
      "Media"
    ],
    "icon": "EU",
    "baseUrl": "https://www.euroxxx.com",
    "enabled": true,
    "supports": [
      "videos",
      "photos",
      "galleries",
      "tags"
    ],
    "searchModes": [
      "general",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 90,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": true,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.euroxxx.com/search/{queryPlus}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "general browsing, not performer-specific"
  },
  {
    "id": "aznude",
    "name": "AZNude",
    "role": "celebrity",
    "category": "celebrity/mainstream provider",
    "badges": [
      "Celebrity",
      "Photos"
    ],
    "icon": "AZ",
    "baseUrl": "https://www.aznude.com",
    "enabled": true,
    "supports": [
      "celebrities",
      "photos",
      "scenes"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.aznude.com/search.html?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Optional low-confidence celebrity media/source browsing only. Not used as a primary celebrity identity/metadata source."
  },
  {
    "id": "thefappening",
    "name": "TheFappening",
    "role": "celebrity",
    "category": "celebrity/mainstream provider",
    "badges": [
      "Celebrity",
      "Photos"
    ],
    "icon": "TF",
    "baseUrl": "https://thefappeningblog.com",
    "enabled": true,
    "supports": [
      "celebrities",
      "photos",
      "scenes"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://thefappeningblog.com/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Optional low-confidence celebrity media/source browsing only. Not used as a primary celebrity identity/metadata source."
  },
  {
    "id": "scandalplanet",
    "name": "Scandal Planet",
    "role": "celebrity",
    "category": "celebrity/mainstream provider",
    "badges": [
      "Celebrity",
      "Photos"
    ],
    "icon": "SP",
    "baseUrl": "https://scandalplanet.com",
    "enabled": true,
    "supports": [
      "celebrities",
      "photos",
      "scenes"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 80,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://scandalplanet.com/?s={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Optional low-confidence celebrity media/source browsing only. Not used as a primary celebrity identity/metadata source."
  },
  {
    "id": "tmdb",
    "name": "TMDB",
    "role": "celebrity",
    "category": "celebrity primary metadata",
    "badges": [
      "Primary",
      "TMDB Person",
      "Credits"
    ],
    "icon": "TM",
    "baseUrl": "https://www.themoviedb.org",
    "enabled": true,
    "supports": [
      "celebrityMetadata",
      "profileImage",
      "credits",
      "biography",
      "externalIds"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 0,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {
      "profileImage": 1,
      "knownFor": 1,
      "popularity": 1,
      "movieTvLinks": 1,
      "biography": 1,
      "birthday": 1,
      "deathday": 1,
      "birthPlace": 1
    },
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.themoviedb.org/search/person?query={queryPlus}",
    "providerIdKey": "tmdb",
    "providerUrlTemplate": "https://www.themoviedb.org/person/{providerId}",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Primary celebrity source for mainstream person identity, profile image, known-for credits, popularity, movie/TV links, biography, birthday/deathday, and birthplace."
  },
  {
    "id": "imdb",
    "name": "IMDb",
    "role": "celebrity",
    "category": "celebrity external ID / credits reference",
    "badges": [
      "IMDb ID",
      "Credits"
    ],
    "icon": "IM",
    "baseUrl": "https://www.imdb.com",
    "enabled": true,
    "supports": [
      "celebrities",
      "photos",
      "credits",
      "awards"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 4,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": true,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.imdb.com/find/?q={queryPlus}&s=nm",
    "providerIdKey": "imdb",
    "providerUrlTemplate": "https://www.imdb.com/name/{providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Used mainly as an external ID/reference link when available from TMDB or Wikidata."
  },
  {
    "id": "models-com",
    "name": "Models.com",
    "role": "celebrity",
    "category": "model / agency-style metadata",
    "badges": [
      "Models",
      "Measurements",
      "Agency"
    ],
    "icon": "M",
    "baseUrl": "https://models.com",
    "enabled": true,
    "supports": [
      "celebrityMetadata",
      "modelMetadata",
      "height",
      "measurements",
      "hair",
      "eyes",
      "shoeSize",
      "dressSize"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 5,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {
      "height": 1,
      "measurements": 1,
      "hairColor": 1,
      "eyeColor": 1,
      "shoeSize": 1,
      "dressSize": 1
    },
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://models.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Model/agency-style source for height, bust/waist/hips, hair, eyes, shoe size, and dress/clothing size."
  },
  {
    "id": "fashion-model-directory",
    "name": "Fashion Model Directory",
    "role": "celebrity",
    "category": "model / agency-style metadata",
    "badges": [
      "Models",
      "Measurements"
    ],
    "icon": "FMD",
    "baseUrl": "https://www.fashionmodeldirectory.com",
    "enabled": true,
    "supports": [
      "celebrityMetadata",
      "modelMetadata",
      "height",
      "measurements",
      "hair",
      "eyes",
      "shoeSize",
      "dressSize"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 6,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": true,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {
      "height": 2,
      "measurements": 2,
      "hairColor": 2,
      "eyeColor": 2,
      "shoeSize": 2,
      "dressSize": 2
    },
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.fashionmodeldirectory.com/search/?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Agency-style fallback for model physical details; lower priority than Models.com."
  },
  {
    "id": "celebrity-body-details",
    "name": "Celebrity body detail fallback",
    "role": "celebrity",
    "category": "low-confidence body details",
    "badges": [
      "Low Confidence",
      "Measurements"
    ],
    "icon": "CBD",
    "baseUrl": "https://www.google.com",
    "enabled": true,
    "supports": [
      "height",
      "weight",
      "measurements",
      "braSize",
      "shoeSize",
      "dressSize"
    ],
    "searchModes": [
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "celebrity"
    ],
    "priority": 70,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {
      "height": 7,
      "weight": 7,
      "measurements": 7,
      "braSize": 7,
      "shoeSize": 7,
      "dressSize": 7
    },
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.google.com/search?q={queryPlus}+height+measurements+shoe+dress+size",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Source-tagged optional fallback bucket for public celebrity/body-measurement sites. Store only with low confidence and source URL."
  },
  {
    "id": "custom-url",
    "name": "Custom metadata URLs",
    "role": "both",
    "category": "user-configured metadata",
    "badges": [
      "Custom",
      "Manual"
    ],
    "icon": "CMU",
    "baseUrl": "",
    "enabled": true,
    "supports": [
      "customMetadata",
      "externalLinks"
    ],
    "searchModes": [
      "performer",
      "celebrity",
      "metadata",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity"
    ],
    "priority": 75,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": true,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "{query}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "User-configured source URL templates from setup/settings. Supports {query}, {queryPlus}, and {querySlug}."
  },
  {
    "id": "porndude",
    "name": "ThePornDude",
    "role": "both",
    "category": "source directory",
    "badges": [
      "Directory",
      "Provider Catalog"
    ],
    "icon": "PD",
    "baseUrl": "https://theporndude.com",
    "enabled": true,
    "supports": [
      "directory",
      "sources"
    ],
    "searchModes": [
      "general",
      "studio",
      "media",
      "all"
    ],
    "profileTypes": [
      "performer",
      "celebrity",
      "general"
    ],
    "priority": 95,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://theporndude.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Provider catalog/source directory, not metadata."
  },
  {
    "id": "rule34",
    "name": "Rule34",
    "role": "both",
    "category": "anime / hentai tags",
    "badges": [
      "Anime",
      "Tags",
      "Images"
    ],
    "icon": "34",
    "baseUrl": "https://rule34.xxx",
    "enabled": true,
    "supports": [
      "images",
      "tags"
    ],
    "searchModes": [
      "anime",
      "general",
      "all"
    ],
    "profileTypes": [
      "general"
    ],
    "priority": 100,
    "requiresSession": false,
    "status": "active",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://rule34.xxx/index.php?page=post&s=list&tags={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Anime/hentai/tag images only; hide from normal performer metadata."
  },
  {
    "id": "wowgirls",
    "name": "WowGirls",
    "role": "performer",
    "category": "account required",
    "badges": [
      "Locked",
      "Paid Search"
    ],
    "icon": "WG",
    "baseUrl": "https://www.wowgirls.com",
    "enabled": false,
    "supports": [
      "photos",
      "videos"
    ],
    "searchModes": [
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 200,
    "requiresSession": true,
    "status": "locked",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.wowgirls.com/search?q={query}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Paid signup required for searching."
  },
  {
    "id": "pantyjob",
    "name": "Panty-Job",
    "role": "performer",
    "category": "account required",
    "badges": [
      "Locked",
      "Session"
    ],
    "icon": "PJ",
    "baseUrl": "https://www.panty-job.com",
    "enabled": false,
    "supports": [
      "photos",
      "videos"
    ],
    "searchModes": [
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 200,
    "requiresSession": true,
    "status": "locked",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.panty-job.com/search/{query}/",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "No anonymous search."
  },
  {
    "id": "adultmobile",
    "name": "AdultMobile",
    "role": "performer",
    "category": "account required",
    "badges": [
      "Locked",
      "Session"
    ],
    "icon": "AM",
    "baseUrl": "https://www.adultmobile.com",
    "enabled": false,
    "supports": [
      "videos"
    ],
    "searchModes": [
      "media",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 200,
    "requiresSession": true,
    "status": "locked",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.adultmobile.com/search?q={queryPlus}",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Membership required; search unclear without account."
  },
  {
    "id": "letsdoeit",
    "name": "LetsDoeIt",
    "role": "performer",
    "category": "disabled/broken",
    "badges": [
      "Disabled",
      "Broken"
    ],
    "icon": "X",
    "baseUrl": "https://www.letsdoeit.com",
    "enabled": false,
    "supports": [],
    "searchModes": [],
    "profileTypes": [
      "performer"
    ],
    "priority": 999,
    "requiresSession": false,
    "status": "disabled",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.letsdoeit.com",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Removed/disabled from default provider lists."
  },
  {
    "id": "gimmeporn",
    "name": "GimmePorn",
    "role": "performer",
    "category": "disabled/broken",
    "badges": [
      "Disabled",
      "Broken"
    ],
    "icon": "X",
    "baseUrl": "https://www.gimmeporn.com",
    "enabled": false,
    "supports": [],
    "searchModes": [],
    "profileTypes": [
      "performer"
    ],
    "priority": 999,
    "requiresSession": false,
    "status": "disabled",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.gimmeporn.com",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Removed/disabled from default provider lists."
  },
  {
    "id": "babesdirectory",
    "name": "BabesDirectory",
    "role": "performer",
    "category": "disabled/broken",
    "badges": [
      "Disabled",
      "Broken"
    ],
    "icon": "X",
    "baseUrl": "https://www.babesdirectory.com",
    "enabled": false,
    "supports": [],
    "searchModes": [],
    "profileTypes": [
      "performer"
    ],
    "priority": 999,
    "requiresSession": false,
    "status": "disabled",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://www.babesdirectory.com",
    "providerIdKey": "",
    "providerUrlTemplate": "",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Removed/disabled from default provider lists."
  },
  {
    "id": "fanza",
    "name": "FANZA",
    "role": "performer",
    "category": "provider id bridge",
    "badges": [
      "Provider ID",
      "Optional"
    ],
    "icon": "FZ",
    "baseUrl": "https://actress.dmm.co.jp",
    "enabled": false,
    "supports": [
      "performerMetadata"
    ],
    "searchModes": [
      "metadata",
      "all"
    ],
    "profileTypes": [
      "performer"
    ],
    "priority": 120,
    "requiresSession": false,
    "status": "optional",
    "supportsFixMatch": false,
    "supportsBulkMetadata": false,
    "supportsArtwork": false,
    "supportsScenes": false,
    "supportsImport": false,
    "fieldPriority": {},
    "supportedFilters": [
      "contentType",
      "studio",
      "quality"
    ],
    "filterStrategy": "queryAppend",
    "searchUrlTemplate": "https://actress.dmm.co.jp/-/search/=/searchstr={query}/",
    "providerIdKey": "fanzaActress",
    "providerUrlTemplate": "https://actress.dmm.co.jp/-/detail/=/actress_id={providerId}/",
    "profileOverrides": {},
    "directProfileOnly": false,
    "notes": "Optional provider ID bridge."
  }
];


function getFaviconUrl(baseUrl = "") {
  try {
    const parsed = new URL(String(baseUrl));
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return "";
  }
}

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";
}

function normalizeQuery(value = "") {
  return String(value || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getConfiguredAdultSources(setupConfig = {}) {
  const saved =
    setupConfig?.adultMetadataSources ||
    setupConfig?.libraryPreferences?.adult?.metadataSources ||
    setupConfig?.adultSources ||
    [];

  const byId = new Map(DEFAULT_ADULT_SOURCES.map((source) => [source.id, { ...source }]));

  if (Array.isArray(saved)) {
    for (const source of saved) {
      if (!source?.id) continue;
      byId.set(source.id, {
        ...(byId.get(source.id) || {}),
        ...source,
        enabled: source.enabled !== false,
      });
    }
  } else if (saved && typeof saved === "object") {
    for (const [id, patch] of Object.entries(saved)) {
      byId.set(id, {
        ...(byId.get(id) || { id, name: id }),
        ...(patch || {}),
        enabled: patch?.enabled !== false,
      });
    }
  }

  return [...byId.values()].map((source) => {
    const id = source.id || slugify(source.name);
    const baseUrl = source.baseUrl || source.url || "";
    return {
      ...source,
      id,
      name: source.name || source.id,
      baseUrl,
      iconUrl: source.iconUrl || source.faviconUrl || getFaviconUrl(baseUrl),
      supports: Array.isArray(source.supports) ? source.supports : [],
      supportedFilters: Array.isArray(source.supportedFilters) ? source.supportedFilters : [],
      searchModes: Array.isArray(source.searchModes) ? source.searchModes : [],
      profileTypes: Array.isArray(source.profileTypes) ? source.profileTypes : [],
      enabled: source.enabled !== false,
      role: source.role || "both",
      category: source.category || "source",
      badges: Array.isArray(source.badges) ? source.badges : [],
      priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 50,
      status: source.status || (source.enabled === false ? "disabled" : "active"),
      supportsFixMatch: Boolean(source.supportsFixMatch),
      supportsBulkMetadata: Boolean(source.supportsBulkMetadata),
      supportsArtwork: Boolean(source.supportsArtwork),
      supportsScenes: Boolean(source.supportsScenes),
      supportsImport: Boolean(source.supportsImport),
      fieldPriority: source.fieldPriority && typeof source.fieldPriority === "object" ? source.fieldPriority : {},
      notes: source.notes || "",
      directProfileOnly: Boolean(source.directProfileOnly),
      requiresSession: Boolean(source.requiresSession),
    };
  });
}

function buildFilterTerms(filters = {}, supportedFilters = []) {
  const supported = new Set(supportedFilters || []);
  const globalFilterKeys = new Set([
    "studio",
    "quality",
    "contentType",
    "bodyType",
    "ageStyle",
    "orientationTags",
    "styleTags",
    "hairColor",
    "cupSize",
  ]);
  const hasFilterValue = (value) => Array.isArray(value) ? value.length > 0 : Boolean(value);
  const normalizeValues = (value) => Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
  const entries = Object.entries(filters || {})
    .filter(([, value]) => hasFilterValue(value))
    .filter(([key]) => key !== "profileType")
    .filter(([key]) => !supported.size || supported.has(key) || globalFilterKeys.has(key));

  return entries
    .flatMap(([key, value]) => normalizeValues(value).map((item) => {
      if (key === "cupSize") return `${item} cup`;
      if (key === "breastType") return `${item}`;
      if (key === "ageRange") return `age ${item}`;
      if (key === "ageStyle") return `${item}`;
      if (key === "bodyType") return `${item}`;
      if (key === "orientationTags" || key === "styleTags") return `${item}`;
      return String(item);
    }))
    .join(" ");
}

function getProviderProfileOverride(source = {}, query = "") {
  const cleanQuery = normalizeQuery(query).toLowerCase();
  const overrides = source.profileOverrides || source.profileUrlOverrides || {};

  if (overrides && typeof overrides === "object" && overrides[cleanQuery]) {
    return overrides[cleanQuery];
  }

  return "";
}

function buildSourceSearchUrl(source, query, filters = {}, context = {}) {
  const cleanQuery = normalizeQuery(query);
  const profileOverride = getProviderProfileOverride(source, cleanQuery);

  if (profileOverride) {
    return profileOverride;
  }

  const providerIds = context.providerIds || {};
  const providerLinks = context.providerLinks || {};
  const providerIdKey = source.providerIdKey || "";
  const providerId = providerIdKey ? providerIds[providerIdKey] : "";

  if (providerIdKey && providerLinks[providerIdKey]) {
    return providerLinks[providerIdKey];
  }

  if (providerId && source.providerUrlTemplate) {
    return source.providerUrlTemplate.replaceAll("{providerId}", encodeURIComponent(providerId));
  }

  const filterTerms = source.filterStrategy === "slugOnly" ? "" : buildFilterTerms(filters, source.supportedFilters || []);
  const adaptedQuery = normalizeQuery([cleanQuery, filterTerms].filter(Boolean).join(" "));
  const encoded = encodeURIComponent(adaptedQuery || cleanQuery || filterTerms || "");
  const plus = encoded.replace(/%20/g, "+");
  const pathSafe = encoded.replace(/%20/g, "-");
  const template = source.searchUrlTemplate || `${source.baseUrl || ""}/search?q={query}`;
  return template
    .replaceAll("{query}", encoded)
    .replaceAll("{queryPlus}", plus)
    .replaceAll("{querySlug}", pathSafe);
}


const ADULT_BROWSE_TAG_KEY_LABELS = {
  gender: "Gender",
  ethnicity: "Ethnicity",
  ageStyle: "Age style",
  bodyType: "Body type",
  breastType: "Breast type",
  cupSize: "Cup size",
  hairColor: "Hair",
  orientationTags: "Scene",
  styleTags: "Theme",
  contentType: "Content",
  tattoos: "Tattoos",
  piercings: "Piercings",
  country: "Country",
  studio: "Studio",
};

const ADULT_BROWSE_TAG_ALIASES = {
  "female": ["female", "girls"],
  "male": ["male"],
  "transgender": ["transgender"],
  "non-binary": ["non-binary"],
  "asian": ["asian"],
  "black": ["black", "african american"],
  "caucasian": ["white", "caucasian"],
  "indian": ["indian"],
  "latin": ["latin", "latina"],
  "middle eastern": ["middle eastern", "arab"],
  "mixed": ["interracial", "mixed"],
  "18+ young adult": ["young", "college"],
  "college": ["college"],
  "mature": ["mature"],
  "milf": ["milf"],
  "cougar": ["cougar"],
  "petite": ["petite"],
  "slim": ["slim"],
  "athletic": ["athletic", "fitness"],
  "fit": ["fit", "fitness"],
  "average": ["average"],
  "curvy": ["curvy"],
  "thick": ["thick"],
  "bbw": ["bbw"],
  "plus size": ["bbw", "plus size"],
  "tall": ["tall"],
  "natural": ["natural"],
  "fake": ["fake"],
  "blonde": ["blonde"],
  "brunette": ["brunette"],
  "black hair": ["black hair", "brunette"],
  "redhead": ["redhead"],
  "auburn": ["redhead", "auburn"],
  "pink hair": ["pink hair"],
  "blue hair": ["blue hair"],
  "lesbian": ["lesbian"],
  "straight": ["straight"],
  "solo": ["solo"],
  "couple": ["couple"],
  "threesome": ["threesome"],
  "group": ["group"],
  "amateur": ["amateur"],
  "professional": ["professional"],
  "glamour": ["glamour"],
  "lingerie": ["lingerie"],
  "cosplay": ["cosplay"],
  "outdoor": ["outdoor"],
  "office": ["office"],
  "massage": ["massage"],
  "performers": ["performers", "models"],
  "scenes": ["scenes"],
  "videos": ["videos"],
  "photos": ["photos"],
  "artwork": ["artwork", "photos"],
  "galleries": ["galleries", "gallery"],
  "yes": ["tattoo", "piercing"],
  "no": [],
};

const ADULT_BROWSE_SOURCE_TAG_RULES = {
  coedcherry: {
    label: "Tag index",
    indexUrl: "https://www.coedcherry.com/tags/",
    pattern: "https://www.coedcherry.com/tags/{tagSlug}/",
    maxCards: 8,
    aliases: {
      "white": ["caucasian"],
      "girls": ["adult"],
      "young": ["college"],
      "natural": ["natural tits"],
      "fake": ["fake tits"],
      "a cup": ["a cup tits"],
      "aa cup": ["a cup tits"],
      "aaa cup": ["a cup tits"],
      "b cup": ["big tits"],
      "bb cup": ["big tits"],
      "c cup": ["big tits"],
      "cc cup": ["big tits"],
      "d cup": ["big tits"],
      "dd cup": ["big tits"],
      "ddd cup": ["big tits"],
      "e cup": ["big tits"],
      "ee cup": ["big tits"],
      "f cup": ["big tits"],
      "ff cup": ["big tits"],
      "g cup": ["big tits"],
      "gg cup": ["big tits"],
    },
  },
  hotnudegirls: {
    label: "Category tiles",
    indexUrl: "https://hotnudegirls.net/",
    pattern: "https://hotnudegirls.net/free/{tagSlug}-pics/",
    maxCards: 8,
    aliases: {
      "girls": ["hot-naked-girls"],
      "female": ["hot-naked-girls"],
      "young": ["college"],
      "college": ["college"],
      "mature": ["mature"],
      "milf": ["milf"],
      "redhead": ["redhead"],
      "blonde": ["blonde"],
      "brunette": ["brunette"],
      "natural": ["natural"],
      "solo": ["solo"],
      "amateur": ["amateur"],
      "lingerie": ["lingerie"],
      "outdoor": ["outdoor"],
    },
  },
};

function titleCaseAdultTerm(value = "") {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeBrowseFilterValues(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function getBrowseTagTermsForValue(key, value, source = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return [];

  const baseTerms = key === "cupSize"
    ? [`${normalized} cup`]
    : (ADULT_BROWSE_TAG_ALIASES[normalized] || [normalized]);

  const sourceRule = ADULT_BROWSE_SOURCE_TAG_RULES[source.id] || {};
  const sourceAliases = sourceRule.aliases || {};

  return [...new Set(baseTerms.flatMap((term) => {
    const lookup = String(term || "").toLowerCase();
    return sourceAliases[lookup] || [term];
  }).filter(Boolean))];
}

function buildAdultBrowseTagUrl(source = {}, tagTerm = "") {
  const rule = ADULT_BROWSE_SOURCE_TAG_RULES[source.id] || {};
  const pattern = source.tagUrlTemplate || source.tagUrlPattern || rule.pattern || "";
  if (!pattern) return "";

  const cleanTerm = normalizeQuery(tagTerm);
  const encoded = encodeURIComponent(cleanTerm);
  const plus = encoded.replace(/%20/g, "+");
  const tagSlug = slugify(cleanTerm);

  return pattern
    .replaceAll("{tag}", encoded)
    .replaceAll("{tagPlus}", plus)
    .replaceAll("{tagSlug}", tagSlug)
    .replaceAll("{query}", encoded)
    .replaceAll("{queryPlus}", plus)
    .replaceAll("{querySlug}", tagSlug);
}

function getAdultBrowseTagCandidates(filters = {}, source = {}) {
  const candidates = [];

  for (const [key, value] of Object.entries(filters || {})) {
    if (key === "profileType" || key === "quality" || !value) continue;

    for (const rawValue of normalizeBrowseFilterValues(value)) {
      const valueLabel = titleCaseAdultTerm(rawValue);
      const terms = getBrowseTagTermsForValue(key, rawValue, source);
      for (const term of terms) {
        const url = buildAdultBrowseTagUrl(source, term);
        if (!url) continue;
        candidates.push({
          key,
          label: `${ADULT_BROWSE_TAG_KEY_LABELS[key] || titleCaseAdultTerm(key)}: ${valueLabel}`,
          term,
          url,
          slug: slugify(term),
        });
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const id = `${candidate.key}:${candidate.slug}:${candidate.url}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(candidate);
  }

  const rule = ADULT_BROWSE_SOURCE_TAG_RULES[source.id] || {};
  const maxCards = Number(source.maxTagCards || source.browseTagMaxCards || rule.maxCards || 6);
  return unique.slice(0, Math.max(0, maxCards));
}

function createAdultBrowseTagCards({ source, query = "", filters = {}, sourceIndex = 0 } = {}) {
  const rule = ADULT_BROWSE_SOURCE_TAG_RULES[source.id] || {};
  const indexUrl = source.tagIndexUrl || source.tagsUrl || rule.indexUrl || "";
  const cards = [];

  if (indexUrl) {
    cards.push({
      id: `${source.id}-tag-index-${sourceIndex}`,
      provider: source.id,
      source: source.name,
      icon: source.icon || "#",
      iconUrl: source.iconUrl || source.faviconUrl || getFaviconUrl(source.baseUrl),
      baseUrl: source.baseUrl || "",
      type: "tag-index",
      resultGroup: "Tag / category pages",
      title: `${source.name}: Tag index`,
      subtitle: "Open the provider tag/category directory. Homestead can use selected filters to build direct tag pages.",
      url: indexUrl,
      status: "browse",
      supports: source.supports || [],
      supportedFilters: source.supportedFilters || [],
      badges: ["Tag Index", ...(source.badges || []).slice(0, 3)],
      category: source.category || "browse source",
      filters,
      canCreateProfileFromResult: true,
      canAttachToProfile: true,
      canImportSelectedMedia: true,
      notes: "Tag/category index page. Use source-specific tags without manually hunting through the provider.",
      adaptationNote: rule.label ? `${rule.label} source` : "Tag/category source",
      requiresSession: Boolean(source.requiresSession),
      supportsImport: Boolean(source.supportsImport),
      supportsArtwork: Boolean(source.supportsArtwork),
      supportsScenes: Boolean(source.supportsScenes),
    });
  }

  for (const candidate of getAdultBrowseTagCandidates(filters, source)) {
    cards.push({
      id: `${source.id}-tag-${candidate.slug}-${sourceIndex}`,
      provider: source.id,
      source: source.name,
      icon: source.icon || "#",
      iconUrl: source.iconUrl || source.faviconUrl || getFaviconUrl(source.baseUrl),
      baseUrl: source.baseUrl || "",
      type: "tag-page",
      resultGroup: "Tag / category pages",
      title: `${source.name}: ${candidate.label} · ${titleCaseAdultTerm(candidate.term)}`,
      subtitle: `Built from source tag “${titleCaseAdultTerm(candidate.term)}”. This is a virtual tag click generated from Homestead filters.`,
      url: candidate.url,
      status: "browse",
      supports: source.supports || [],
      supportedFilters: source.supportedFilters || [],
      badges: ["Auto Tag", "Browse", ...(source.badges || []).slice(0, 2)],
      category: source.category || "browse source",
      filters,
      filterKey: candidate.key,
      tagTerm: candidate.term,
      canCreateProfileFromResult: true,
      canAttachToProfile: true,
      canImportSelectedMedia: true,
      notes: "Direct tag/category page generated from selected Browse Media filters.",
      adaptationNote: `Virtual tag click · ${candidate.label}`,
      requiresSession: Boolean(source.requiresSession),
      supportsImport: Boolean(source.supportsImport),
      supportsArtwork: Boolean(source.supportsArtwork),
      supportsScenes: Boolean(source.supportsScenes),
    });
  }

  return cards;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 9000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function whisparrRequest(path, whisparr = {}, options = {}) {
  if (!whisparr?.baseUrl || !whisparr?.apiKey) return null;
  const base = String(whisparr.baseUrl).replace(/\/+$/, "");
  const apiPath = path.startsWith("/") ? path : `/${path}`;
  return fetchJson(`${base}${apiPath}`, {
    ...options,
    headers: {
      "X-Api-Key": whisparr.apiKey,
      ...(options.headers || {}),
    },
  });
}

async function firstWhisparrResult(paths = [], whisparr = {}) {
  for (const apiPath of paths) {
    try {
      const data = await whisparrRequest(apiPath, whisparr);
      if (Array.isArray(data) && data.length) return data;
      if (data?.records?.length) return data.records;
      if (data?.results?.length) return data.results;
    } catch (error) {
      // Try next known/future-compatible route.
    }
  }
  return [];
}

function normalizeWhisparrScene(item = {}, query = "") {
  const title = item.title || item.name || item.sortTitle || query;
  const id = item.id || item.tmdbId || item.foreignId || item.guid || slugify(`${title}-${item.year || ""}`);
  const remotePoster =
    item.remotePoster ||
    item.poster ||
    item.images?.find?.((image) => /poster|cover/i.test(image.coverType || image.type || ""))?.url ||
    item.images?.[0]?.url ||
    "";

  return {
    id: `whisparr-scene-${id}`,
    provider: "whisparr",
    source: "Whisparr",
    type: "scene",
    title,
    studio: item.studio || item.network || item.website || "",
    date: item.releaseDate || item.inCinemas || item.digitalRelease || item.year || "",
    duration: item.runtime || item.duration || null,
    thumbnail: remotePoster,
    poster: remotePoster,
    status: item.hasFile ? "local" : "available",
    whisparrId: item.id || null,
    raw: item,
  };
}

function createProviderDiscoveryCards(query, sources = []) {
  return sources
    .filter(sourceSupportsAdultPersonSearch)
    .sort((a, b) => (a.priority || 50) - (b.priority || 50))
    .map((source) => ({
      id: `${source.id}-${slugify(query)}`,
      provider: source.id,
      source: source.name,
      icon: source.icon || "🌐",
      iconUrl: source.iconUrl || source.faviconUrl || getFaviconUrl(source.baseUrl),
      baseUrl: source.baseUrl || "",
      type: "source",
      title: `${source.name} results for ${query}`,
      subtitle: `Open/search ${source.name}; selectable import can be wired per provider.`,
      supports: source.supports,
      supportedFilters: source.supportedFilters || [],
      url: buildSourceSearchUrl(source, query),
      status: "browse",
    }));
}

function createArtworkCandidates(query, sources = []) {
  return sources
    .filter((source) =>
      sourceSupportsAdultPersonSearch(source) &&
      source.supports?.some((type) => ["artwork", "photos", "photoSets", "images"].includes(type))
    )
    .sort((a, b) => (a.priority || 50) - (b.priority || 50))
    .map((source) => ({
      id: `${source.id}-artwork-${slugify(query)}`,
      provider: source.id,
      source: source.name,
      icon: source.icon || "🖼️",
      type: "artwork",
      title: `${source.name} artwork/photos`,
      subtitle: "Browse candidates, then save selected poster/banner/gallery items when the provider grabber is wired.",
      url: buildSourceSearchUrl(source, query),
      status: "browse",
    }));
}

function buildAdultBrowseQuery(query = "", filters = {}) {
  const cleanQuery = normalizeQuery(query);
  const filterTerms = buildFilterTerms(filters, []);
  return normalizeQuery([cleanQuery, filterTerms].filter(Boolean).join(" "));
}

function sourceSupportsAdultBrowse(source = {}) {
  if (!source || source.enabled === false || source.status === "disabled") return false;
  if (source.discoveryScope === "person-search") return false;
  if (isAdultBrowseOnlySource(source)) return true;
  if (source.directProfileOnly || source.supportsFixMatch || source.supportsBulkMetadata) return false;

  const supports = Array.isArray(source.supports) ? source.supports : [];
  const modes = Array.isArray(source.searchModes) ? source.searchModes : [];
  const category = String(source.category || "").toLowerCase();

  return Boolean(
    source.supportsArtwork ||
    source.supportsImport ||
    source.supportsScenes ||
    supports.some((type) => ["photos", "photoSets", "images", "artwork", "scenes", "videos", "galleries", "gallery"].includes(type)) ||
    modes.some((mode) => ["general", "browse", "artwork", "media", "studio", "mature", "vr", "anime"].includes(mode)) ||
    /browse|photo|gallery|media|tags|studio/.test(category)
  );
}

function classifyAdultBrowseResultGroup(source = {}) {
  const supports = Array.isArray(source.supports) ? source.supports : [];
  const category = String(source.category || "").toLowerCase();
  if (source.requiresSession) return "Locked / session sources";
  if (source.supportsScenes || source.supportsImport || supports.some((type) => ["scenes", "videos"].includes(type))) return "Media / scene sources";
  if (source.supportsArtwork || supports.some((type) => ["photos", "photoSets", "images", "artwork", "galleries", "gallery"].includes(type)) || /photo|gallery|tag/.test(category)) return "Artwork / photo sources";
  return "General sources";
}

function discoverAdultBrowseMedia({ query = "", filters = {}, sourceIds = [], setupConfig = {} } = {}) {
  const allSources = getConfiguredAdultSources(setupConfig);
  const selectedIds = new Set(Array.isArray(sourceIds) ? sourceIds.filter(Boolean) : []);
  const browseQuery = buildAdultBrowseQuery(query, filters);
  const activeFilters = Object.entries(filters || {}).filter(([key, value]) => key !== "profileType" && (Array.isArray(value) ? value.length > 0 : Boolean(value)));

  const sources = allSources
    .filter(sourceSupportsAdultBrowse)
    .filter((source) => !selectedIds.size || selectedIds.has(source.id))
    .sort((a, b) => (a.priority || 50) - (b.priority || 50));

  const results = sources.flatMap((source, index) => {
    const url = buildSourceSearchUrl(source, query, filters);
    const group = classifyAdultBrowseResultGroup(source);
    const titleParts = [
      query ? normalizeQuery(query) : "Browse",
      ...activeFilters.flatMap(([, value]) => Array.isArray(value) ? value.map((item) => String(item)) : [String(value)]),
    ].filter(Boolean);

    const sourceCard = {
      id: `${source.id}-browse-${slugify(browseQuery || activeFilters.map(([, value]) => value).join("-") || "all")}-${index}`,
      provider: source.id,
      source: source.name,
      icon: source.icon || "🖼️",
      iconUrl: source.iconUrl || source.faviconUrl || getFaviconUrl(source.baseUrl),
      baseUrl: source.baseUrl || "",
      type: group.includes("Video") ? "media-browse" : "photo-browse",
      resultGroup: group,
      title: `${source.name}: ${titleParts.length ? titleParts.join(" · ") : "Browse latest"}`,
      subtitle: query
        ? `Browse media results for “${normalizeQuery(query)}” with selected filters.`
        : `Browse by filters only. No person identity match required.`,
      url,
      status: "browse",
      supports: source.supports || [],
      supportedFilters: source.supportedFilters || [],
      badges: ["Browse", ...(source.badges || []).slice(0, 3)],
      category: source.category || "browse source",
      filters,
      canCreateProfileFromResult: true,
      canAttachToProfile: true,
      canImportSelectedMedia: true,
      notes: source.notes || "Browse/import source. Results are not treated as identity metadata.",
      requiresSession: Boolean(source.requiresSession),
      supportsImport: Boolean(source.supportsImport),
      supportsArtwork: Boolean(source.supportsArtwork),
      supportsScenes: Boolean(source.supportsScenes),
    };

    const tagCards = createAdultBrowseTagCards({ source, query, filters, sourceIndex: index });
    return [...tagCards, sourceCard];
  });

  return {
    ok: true,
    mode: "browse",
    query: normalizeQuery(query),
    browseQuery,
    filters,
    results,
    sources,
    summary: {
      sources: sources.length,
      results: results.length,
      sourceCards: sources.length,
      tagCards: results.filter((result) => String(result.type || "").includes("tag")).length,
      filters: activeFilters.length,
      blankName: !normalizeQuery(query),
    },
    message: !normalizeQuery(query)
      ? `${results.length} browse cards built from filters only.`
      : `${results.length} browse cards built for “${normalizeQuery(query)}”.`,
  };
}

async function discoverAdultPerformer(query, options = {}) {
  const cleanQuery = normalizeQuery(query);
  const sources = getConfiguredAdultSources(options.setupConfig || {});
  const enabledSources = sources.filter(sourceSupportsAdultPersonSearch);
  const whisparr = options.whisparr || {};

  const whisparrScenes = await firstWhisparrResult(
    [
      `/api/v3/movie/lookup?term=${encodeURIComponent(cleanQuery)}`,
      `/api/v1/movie/lookup?term=${encodeURIComponent(cleanQuery)}`,
      `/api/v3/scene/lookup?term=${encodeURIComponent(cleanQuery)}`,
      `/api/v1/scene/lookup?term=${encodeURIComponent(cleanQuery)}`,
    ],
    whisparr
  );

  const sceneCandidates = whisparrScenes.map((item) => normalizeWhisparrScene(item, cleanQuery));
  const sourceCards = createProviderDiscoveryCards(cleanQuery, enabledSources);
  const artworkCandidates = createArtworkCandidates(cleanQuery, enabledSources);

  return {
    ok: true,
    query: cleanQuery,
    mode: options.mode || "browse",
    performer: {
      id: slugify(cleanQuery),
      name: cleanQuery,
      status: "discovery",
      sourceCount: enabledSources.length,
      whisparrConnected: Boolean(whisparr?.baseUrl && whisparr?.apiKey),
    },
    sources: sourceCards,
    scenes: sceneCandidates,
    photos: artworkCandidates.filter((candidate) => /photo/i.test(candidate.title + candidate.subtitle)),
    artwork: artworkCandidates,
    summary: {
      scenes: sceneCandidates.length,
      sources: sourceCards.length,
      artwork: artworkCandidates.length,
      whisparrConnected: Boolean(whisparr?.baseUrl && whisparr?.apiKey),
    },
  };
}

function normalizeSelectedAdultItem(item = {}) {
  return {
    id: item.id || slugify(item.title || item.name || item.url || "selected-item"),
    provider: item.provider || "unknown",
    source: item.source || item.provider || "Unknown",
    type: item.type || "scene",
    title: item.title || item.name || "Untitled",
    url: item.url || item.webpageUrl || "",
    status: "requested",
    requestedAt: new Date().toISOString(),
    whisparrId: item.whisparrId || item.id || null,
    raw: item.raw || null,
  };
}

async function requestSelectedAdultContent({ query = "", selected = [], mode = "requestSelected", whisparr = {} } = {}) {
  const normalized = selected.map(normalizeSelectedAdultItem);
  const whisparrConnected = Boolean(whisparr?.baseUrl && whisparr?.apiKey);
  const whisparrAttempts = [];

  if (whisparrConnected && mode !== "browse") {
    for (const item of normalized.filter((entry) => entry.provider === "whisparr" && entry.whisparrId)) {
      try {
        const command = await whisparrRequest("/api/v3/command", whisparr, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "MoviesSearch",
            movieIds: [item.whisparrId],
          }),
        });
        whisparrAttempts.push({ itemId: item.id, ok: true, command });
      } catch (error) {
        whisparrAttempts.push({ itemId: item.id, ok: false, message: error.message });
      }
    }
  }

  return {
    ok: true,
    query: normalizeQuery(query),
    mode,
    selected: normalized,
    whisparrConnected,
    whisparrAttempts,
    message: whisparrAttempts.some((attempt) => attempt.ok)
      ? "Selected items were sent to Whisparr where supported."
      : "Selected items were saved as pending adult discovery requests.",
  };
}

module.exports = {
  DEFAULT_ADULT_SOURCES,
  ADULT_BROWSE_ONLY_SOURCE_IDS,
  ADULT_BROWSE_ONLY_DOMAINS,
  isAdultBrowseOnlySource,
  sourceSupportsAdultPersonSearch,
  sourceSupportsAdultBrowse,
  getConfiguredAdultSources,
  buildSourceSearchUrl,
  discoverAdultPerformer,
  discoverAdultBrowseMedia,
  requestSelectedAdultContent,
};
