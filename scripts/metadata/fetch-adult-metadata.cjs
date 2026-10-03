const { createModelsLookup } = require("./models-com.cjs");
const lookupModelsProfile = createModelsLookup();
const DEFAULT_USER_AGENT = "Homestead/1.0 (adult-metadata)";
const ADULT_METADATA_HTTP_TIMEOUT_MS = Math.min(15000, Math.max(3000, Number(process.env.HOMESTEAD_ADULT_PROVIDER_TIMEOUT_MS || 7000)));

function cleanQuery(value = "") {
  return String(value || "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strictEncode(value = "") {
  return encodeURIComponent(String(value || "")).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}


const ADULT_METADATA_SOURCE_PROFILES = {
  celebrities: {
    id: "celebrities",
    label: "Celebrities",
    providerRank: {
      tmdb: 0,
      wikidata: 1,
      wikipedia: 2,
      imdb: 3,
      teenidols4you: 4,
      "models-com": 5,
      "fashion-model-directory": 6,
      custom: 6,
      "custom-url": 6,
      "celebrity-body-details": 7,
      celebritytall: 90,
      celebrityinside: 91,
      boobpedia: 8,
      musicbrainz: 9,
      "definebabe-search": 40,
      "freeones-search": 41,
      whisparr: 50,
      "tpdb-stashbox": 51,
      iafd: 52,
    },
  },
  performers: {
    id: "performers",
    label: "Performers",
    providerRank: {
      wikidata: 0,
      wikipedia: 1,
      definebabe: 2, freeones: 3, xxxbios: 4, "tpdb-stashbox": 5, whisparr: 6, iafd: 7,
      "custom-url": 8, custom: 8, boobpedia: 9, thenude: 10, "definebabe-search": 40, "freeones-search": 41, "iafd-search": 42,
      tmdb: 40,
      imdb: 41,
    },
  },
  personal: {
    id: "personal",
    label: "Personal",
    providerRank: {
      wikidata: 0,
      wikipedia: 1,
      "custom-url": 2,
      custom: 2,
      "definebabe-search": 8,
      "freeones-search": 9,
      "tpdb-stashbox": 10,
      whisparr: 11,
      iafd: 12,
      tmdb: 40,
    },
  },
};

function normalizeAdultLibraryType(value = "") {
  const normalized = String(value || "personal").toLowerCase();
  if (["celebrity", "celeb", "celebrities"].includes(normalized)) return "celebrities";
  if (["performer", "performers"].includes(normalized)) return "performers";
  if (["girl", "girls", "personal", "personalprofiles", "personal-profiles"].includes(normalized)) return "personal";
  return normalized || "personal";
}

function getAdultMetadataSourceProfile(libraryType = "personal") {
  const normalized = normalizeAdultLibraryType(libraryType);
  if (normalized === "celebrities") return ADULT_METADATA_SOURCE_PROFILES.celebrities;
  if (normalized === "performers") return ADULT_METADATA_SOURCE_PROFILES.performers;
  return ADULT_METADATA_SOURCE_PROFILES.personal;
}

function getAdultProviderRank(provider = "", profile = ADULT_METADATA_SOURCE_PROFILES.personal) {
  const key = String(provider || "").toLowerCase();
  return profile.providerRank?.[key] ?? 99;
}

function normalizeDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/([+-]?\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const year = match[1].replace(/^\+/, "");
  return `${year}-${match[2]}-${match[3]}`;
}

function normalizeAdultBirthday(value = "") {
  const normalized = normalizeDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(String(value || "").trim());
  const year = parsed.getUTCFullYear();
  if (Number.isNaN(parsed.getTime()) || year < 1900 || year > new Date().getUTCFullYear()) return normalized;
  return parsed.toISOString().slice(0, 10);
}

function getClaimValue(entity, property) {
  const claim = entity?.claims?.[property]?.[0];
  return claim?.mainsnak?.datavalue?.value || null;
}

function getClaimValues(entity, property) {
  const claims = entity?.claims?.[property] || [];
  return claims
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .filter(Boolean);
}

function getEntityId(value) {
  return value?.id || value?.["numeric-id"] ? `Q${value["numeric-id"]}` : "";
}


function getClaimStringValues(entity, property) {
  return getClaimValues(entity, property)
    .map((value) => {
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      if (value?.id) return value.id;
      if (value?.["numeric-id"]) return String(value["numeric-id"]);
      if (value?.amount) return String(value.amount).replace(/^\+/, "");
      return "";
    })
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function getFirstClaimString(entity, property) {
  return getClaimStringValues(entity, property)[0] || "";
}

function getQuantityClaim(entity, property) {
  const value = getClaimValue(entity, property);
  if (!value?.amount) return "";
  const amount = String(value.amount || "").replace(/^\+/, "");
  if (!amount) return "";
  const unitId = String(value.unit || "").match(/Q\d+$/)?.[0] || "";
  const units = { Q11573: "m", Q174728: "cm", Q11570: "kg", Q100995: "lb", Q218593: "in" };
  if (units[unitId]) return `${amount} ${units[unitId]}`;
  return amount;
}

const WIKIDATA_PROVIDER_ID_PROPERTIES = {
  wikidata: "id",
  imdb: "P345",
  tmdb: "P4985",
  adultFilmDatabase: "P3351",
  iafdFemale: "P3869",
  iafdMale: "P4505",
  pornhub: "P5246",
  youporn: "P5267",
  redtube: "P5540",
  onlyfans: "P8604",
  xhamster: "P8720",
  xxxbiosTrans: "P9174",
  xxxbiosFemale: "P9233",
  fanzaActress: "P9781",
  babesdirectory: "P10155",
  tube8: "P14374",
  instagram: "P2003",
};

function extractWikidataProviderIds(entity, entityId = "") {
  const providerIds = { wikidata: entityId };

  for (const [key, property] of Object.entries(WIKIDATA_PROVIDER_ID_PROPERTIES)) {
    if (property === "id") continue;
    const value = getFirstClaimString(entity, property);
    if (value) providerIds[key] = value;
  }

  if (providerIds.iafdFemale && !providerIds.iafd) providerIds.iafd = providerIds.iafdFemale;
  if (providerIds.iafdMale && !providerIds.iafd) providerIds.iafd = providerIds.iafdMale;
  if (providerIds.xxxbiosFemale && !providerIds.xxxbios) providerIds.xxxbios = providerIds.xxxbiosFemale;
  if (providerIds.xxxbiosTrans && !providerIds.xxxbios) providerIds.xxxbios = providerIds.xxxbiosTrans;

  return providerIds;
}

function buildWikidataProviderLinks(providerIds = {}) {
  const links = {};
  const add = (key, url) => {
    if (providerIds[key] && url) links[key] = url;
  };

  add("wikidata", `https://www.wikidata.org/wiki/${providerIds.wikidata}`);
  add("imdb", `https://www.imdb.com/name/${providerIds.imdb}/`);
  add("tmdb", `https://www.themoviedb.org/person/${providerIds.tmdb}`);
  add("pornhub", `https://www.pornhub.com/pornstar/${providerIds.pornhub}`);
  add("xhamster", `https://xhamster.com/pornstars/${providerIds.xhamster}`);
  add("youporn", `https://www.youporn.com/pornstar/${providerIds.youporn}/`);
  add("redtube", `https://www.redtube.com/pornstar/${providerIds.redtube}`);
  add("tube8", `https://www.tube8.com/pornstars/${providerIds.tube8}/`);
  add("iafd", `https://www.iafd.com/person.rme/perfid=${providerIds.iafd}/gender=female`);
  add("iafdFemale", `https://www.iafd.com/person.rme/perfid=${providerIds.iafdFemale}/gender=female`);
  add("iafdMale", `https://www.iafd.com/person.rme/perfid=${providerIds.iafdMale}/gender=male`);
  add("adultFilmDatabase", `https://www.adultfilmdatabase.com/actor/${providerIds.adultFilmDatabase}/`);
  add("babesdirectory", `https://www.babesdirectory.com/model/${providerIds.babesdirectory}/`);
  add("onlyfans", `https://onlyfans.com/${providerIds.onlyfans}`);
  add("instagram", `https://www.instagram.com/${providerIds.instagram}/`);
  add("fanzaActress", `https://actress.dmm.co.jp/-/detail/=/actress_id=${providerIds.fanzaActress}/`);
  add("xxxbios", `https://www.xxxbios.com/female-pornstar/${providerIds.xxxbios}/`);
  add("xxxbiosFemale", `https://www.xxxbios.com/female-pornstar/${providerIds.xxxbiosFemale}/`);
  add("xxxbiosTrans", `https://www.xxxbios.com/trans-pornstar/${providerIds.xxxbiosTrans}/`);

  return links;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(ADULT_METADATA_HTTP_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const compact = text.replace(/\s+/g, " ").slice(0, 160);
    data = { raw: text, parseError: true, snippet: compact };
    if (/^\s*</.test(text) || /<!doctype|<html|<body/i.test(text)) {
      const error = new Error(`Expected JSON from metadata provider but received HTML from ${url}. This usually means the provider blocked the request, redirected to a browser page, or the backend route is not being hit.`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function getWikidataLabels(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, 24);
  if (!uniqueIds.length) return {};

  const data = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${strictEncode(uniqueIds.join("|"))}&props=labels&languages=en&format=json`
  );

  const labels = {};
  for (const [id, entity] of Object.entries(data.entities || {})) {
    labels[id] = entity?.labels?.en?.value || id;
  }
  return labels;
}

async function getWikipediaSummary(title = "") {
  if (!title) return null;
  try {
    return await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${strictEncode(title)}`
    );
  } catch {
    return null;
  }
}

function isDisambiguationWikipediaSummary(summary = {}) {
  const type = String(summary.type || "").toLowerCase();
  const description = String(summary.description || "").toLowerCase();
  const extract = String(summary.extract || "").toLowerCase();
  return (
    type === "disambiguation" ||
    description.includes("disambiguation") ||
    extract.includes("may refer to:")
  );
}

async function searchWikipediaPerson(query, { limit = 4 } = {}) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  try {
    const search = await fetchJson(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${strictEncode(cleaned)}&srlimit=${Number(limit) || 4}&format=json&origin=*`
    );

    const rows = search?.query?.search || [];
    const results = [];

    for (const row of rows) {
      const title = row?.title || "";
      if (!title) continue;

      const summary = await getWikipediaSummary(title);
      if (!summary || isDisambiguationWikipediaSummary(summary)) continue;

      const summaryTitle = summary.title || title;
      const normalizedTitle = cleanQuery(summaryTitle).toLowerCase();
      const normalizedQuery = cleaned.toLowerCase();
      const isLikelyNameMatch =
        normalizedTitle === normalizedQuery ||
        normalizedTitle.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedTitle);

      if (!isLikelyNameMatch && results.length >= 2) continue;

      const image = summary?.thumbnail?.source || summary?.originalimage?.source || "";
      const description = summary?.extract || stripHtml(row?.snippet || "") || summary?.description || "";

      results.push(compactAdultMetadataObject({
        id: `wikipedia-${slugifyAdultSource(summaryTitle)}`,
        provider: "wikipedia",
        source: "Wikipedia",
        confidence: isLikelyNameMatch ? 0.74 : 0.52,
        name: summaryTitle,
        title: summaryTitle,
        description,
        biography: description,
        wikipediaTitle: summaryTitle,
        image,
        poster: image,
        url: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${strictEncode(summaryTitle).replace(/%20/g, "_")}`,
        providerIds: {},
        providerLinks: {
          wikipedia: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${strictEncode(summaryTitle).replace(/%20/g, "_")}`,
        },
        externalIds: {},
        externalLinks: {
          wikipedia: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${strictEncode(summaryTitle).replace(/%20/g, "_")}`,
        },
        raw: {
          wikipediaSearch: row,
          summary,
        },
      }));
    }

    return results;
  } catch (error) {
    console.warn(`Adult metadata Wikipedia search failed for "${cleaned}":`, error.message);
    return [];
  }
}

async function searchWikidataPerson(query, { limit = 5 } = {}) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const search = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${strictEncode(cleaned)}&language=en&format=json&limit=${limit}`
  );

  const results = [];

  for (const row of search.search || []) {
    const entityId = row.id;
    if (!entityId) continue;

    try {
      const entityData = await fetchJson(
        `https://www.wikidata.org/wiki/Special:EntityData/${strictEncode(entityId)}.json`
      );
      const entity = entityData?.entities?.[entityId];
      if (!entity) continue;

      const instanceIds = getClaimValues(entity, "P31").map(getEntityId);
      const isLikelyPerson = instanceIds.includes("Q5") || !!getClaimValue(entity, "P569");
      if (!isLikelyPerson) continue;

      const occupationIds = getClaimValues(entity, "P106").map(getEntityId);
      const countryIds = getClaimValues(entity, "P27").map(getEntityId);
      const genderIds = getClaimValues(entity, "P21").map(getEntityId);
      const birthplaceIds = getClaimValues(entity, "P19").map(getEntityId);
      const orientationIds = getClaimValues(entity, "P91").map(getEntityId);
      const industryIds = getClaimValues(entity, "P452").map(getEntityId);
      const genreIds = getClaimValues(entity, "P136").map(getEntityId);
      const relatedIds = [
        ...occupationIds,
        ...countryIds,
        ...genderIds,
        ...birthplaceIds,
        ...orientationIds,
        ...industryIds,
        ...genreIds,
      ];
      const labels = await getWikidataLabels(relatedIds);

      const birthDate = normalizeDate(getClaimValue(entity, "P569")?.time || "");
      const imageName = getClaimValue(entity, "P18") || "";
      const wikiTitle = entity?.sitelinks?.enwiki?.title || "";
      const summary = wikiTitle ? await getWikipediaSummary(wikiTitle) : null;
      const providerIds = extractWikidataProviderIds(entity, entityId);
      const providerLinks = buildWikidataProviderLinks(providerIds);
      const aliases = (entity?.aliases?.en || []).map((alias) => alias?.value).filter(Boolean);
      const height = getQuantityClaim(entity, "P2048");
      const weight = getQuantityClaim(entity, "P2067");
      const gender = genderIds.map((id) => labels[id] || id).filter(Boolean).join(", ");
      const birthPlace = birthplaceIds.map((id) => labels[id] || id).filter(Boolean).join(", ");
      const sexualOrientation = orientationIds.map((id) => labels[id] || id).filter(Boolean).join(", ");
      const industries = industryIds.map((id) => labels[id] || id).filter(Boolean);
      const genres = genreIds.map((id) => labels[id] || id).filter(Boolean);

      results.push({
        id: entityId,
        provider: "wikidata",
        source: "Wikidata / Wikipedia",
        confidence: String(row.label || "").toLowerCase() === cleaned.toLowerCase() ? 0.92 : 0.68,
        name: row.label || entity?.labels?.en?.value || cleaned,
        title: row.label || entity?.labels?.en?.value || cleaned,
        description: summary?.extract || row.description || "",
        birthday: birthDate,
        birthDate,
        image: summary?.thumbnail?.source || summary?.originalimage?.source || "",
        poster: summary?.thumbnail?.source || summary?.originalimage?.source || "",
        occupations: occupationIds.map((id) => labels[id] || id).filter(Boolean),
        occupation: occupationIds.map((id) => labels[id] || id).filter(Boolean).join(", "),
        nationality: countryIds.map((id) => labels[id] || id).filter(Boolean).join(", "),
        countryOfCitizenship: countryIds.map((id) => labels[id] || id).filter(Boolean).join(", "),
        gender,
        sexOrGender: gender,
        birthPlace,
        placeOfBirth: birthPlace,
        sexualOrientation,
        orientation: sexualOrientation,
        industries,
        industry: industries.join(", "),
        genres,
        genre: genres.join(", "),
        imdbId: getClaimValue(entity, "P345") || "",
        officialWebsite: getClaimValue(entity, "P856") || "",
        wikipediaTitle: wikiTitle,
        wikidataId: entityId,
        aliases,
        alsoKnownAs: aliases,
        height,
        weight,
        providerIds,
        providerLinks,
        externalIds: providerIds,
        externalLinks: providerLinks,
        url: wikiTitle ? `https://en.wikipedia.org/wiki/${strictEncode(wikiTitle).replace(/%20/g, "_")}` : `https://www.wikidata.org/wiki/${entityId}`,
        raw: {
          wikidataSearch: row,
          summary,
        },
      });
    } catch (error) {
      console.warn(`Adult metadata Wikidata candidate failed for ${entityId}:`, error.message);
    }
  }

  return results;
}

function normalizeWhisparrCandidate(item = {}, query = "") {
  const name = item.name || item.fullName || item.title || item.sortName || query;
  return {
    id: item.foreignPerformerId || item.foreignId || item.id || item.tvdbId || item.imdbId || name,
    provider: "whisparr",
    source: "Whisparr",
    confidence: String(name || "").toLowerCase() === String(query || "").toLowerCase() ? 0.95 : 0.72,
    name,
    title: name,
    description: item.overview || item.biography || item.description || "",
    birthday: normalizeDate(item.birthday || item.birthDate || item.dateOfBirth || ""),
    birthDate: normalizeDate(item.birthday || item.birthDate || item.dateOfBirth || ""),
    poster:
      item.remotePoster ||
      item.poster ||
      item.images?.find?.((image) => image.coverType === "poster")?.remoteUrl ||
      item.images?.[0]?.remoteUrl ||
      "",
    image:
      item.remotePoster ||
      item.poster ||
      item.images?.find?.((image) => image.coverType === "poster")?.remoteUrl ||
      item.images?.[0]?.remoteUrl ||
      "",
    tags: item.tags || [],
    status: item.status || "",
    monitored: item.monitored ?? false,
    whisparrId: item.id || null,
    foreignPerformerId: item.foreignPerformerId || item.foreignId || "",
    url: item.website || item.url || "",
    raw: item,
  };
}

async function searchWhisparrMetadata(query, config = {}) {
  const cleaned = cleanQuery(query);
  const baseUrl = String(config.baseUrl || config.url || "").replace(/\/+$/, "");
  const apiKey = config.apiKey || config.key || "";

  if (!cleaned || !baseUrl || !apiKey) return [];

  const lookupPaths = [
    `/api/v3/person/lookup?term=${strictEncode(cleaned)}`,
    `/api/v3/performer/lookup?term=${strictEncode(cleaned)}`,
    `/api/v1/person/lookup?term=${strictEncode(cleaned)}`,
    `/api/v1/performer/lookup?term=${strictEncode(cleaned)}`,
  ];

  for (const lookupPath of lookupPaths) {
    try {
      const data = await fetchJson(`${baseUrl}${lookupPath}`, {
        headers: { "X-Api-Key": apiKey },
      });
      const rows = Array.isArray(data) ? data : data?.results || [];
      if (rows.length) {
        return rows.slice(0, 12).map((item) => normalizeWhisparrCandidate(item, cleaned));
      }
    } catch (error) {
      if (error.status !== 404) {
        console.warn(`Whisparr lookup failed at ${lookupPath}:`, error.message);
      }
    }
  }

  return [];
}



function slugifyAdultSource(value = "", separator = "-") {
  return cleanQuery(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

function underscoreAdultSourceName(value = "") {
  return cleanQuery(value).replace(/\s+/g, "_");
}

function firstAdultMetadataValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length) return value;
    if (typeof value === "object" && Object.keys(value).length) return value;
    const text = String(value || "").trim();
    if (text) return value;
  }
  return "";
}

function compactAdultMetadataObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return String(value).trim() !== "";
    })
  );
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(ADULT_METADATA_HTTP_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": DEFAULT_USER_AGENT,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Request failed: ${response.status}`);
    error.status = response.status;
    error.data = { snippet: text.replace(/\s+/g, " ").slice(0, 160) };
    throw error;
  }
  return text;
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseLabelFromHtml(html = "", labels = []) {
  for (const label of labels) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`>\\s*${escaped}\\s*[:：]?\\s*<\\/[^>]+>\\s*(?:<[^>]+>\\s*){1,3}([^<]{1,160})`, "i"),
      new RegExp(`${escaped}\\s*[:：]?\\s*<\\/[^>]+>\\s*(?:<[^>]+>\\s*){1,3}([^<]{1,160})`, "i"),
      new RegExp(`${escaped}\\s*[:：]\\s*(?:<[^>]+>\\s*){1,3}([^<\\n]{1,160})`, "i"),
      new RegExp(`${escaped}\\s*[:：]\\s*([^<\\n]{1,160})`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return stripHtml(match[1]);
    }
  }
  return "";
}

function parseAdultMeasurements(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d{2,3}(?:\.\d+)?)([A-Z]{1,4})?\s*[-–]\s*(\d{2,3}(?:\.\d+)?)\s*[-–]\s*(\d{2,3}(?:\.\d+)?)/i);
  if (!match) return { measurementsRaw: raw };
  return compactAdultMetadataObject({
    measurementsRaw: `${match[1]}-${match[3]}-${match[4]}`,
    measurementsSourceRaw: raw,
    bust: match[1],
    waist: match[3],
    hips: match[4],
    braSize: match[2] ? `${match[1]}${match[2].toUpperCase()}` : "",
    braBand: match[2] ? match[1] : "",
    cupSize: match[2]?.toUpperCase() || "",
  });
}

function parseAdultBraSize(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/\b(\d{2,3})\s*([A-Z]{1,4})\b/i);
  return compactAdultMetadataObject({ braSize: raw, braBand: match?.[1] || "", cupSize: match?.[2]?.toUpperCase() || "" });
}

function normalizeAdultTextList(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeAdultTextList).filter(Boolean);
  if (value && typeof value === "object") return normalizeAdultTextList(value.name || value.value || value.label || "");
  return String(value || "").split(/[,;|]+/).map((entry) => entry.trim()).filter(Boolean);
}

function extractAdultJsonLdPeople(html = "") {
  const people = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const parsed = JSON.parse(String(match[1] || "").trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item)) { queue.push(...item); continue; }
        if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
        if (normalizeAdultTextList(item["@type"]).map((value) => value.toLowerCase()).includes("person")) people.push(item);
      }
    } catch {}
  }
  return people;
}

function adultStructuredScalar(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(adultStructuredScalar).filter(Boolean).join(", ");
  if (typeof value === "object") return adultStructuredScalar(value.name || value.value || value.address || value.url || "");
  return stripHtml(String(value)).trim();
}

function extractAdultStructuredPerson(html = "", query = "") {
  const wanted = cleanQuery(query).toLowerCase();
  const people = extractAdultJsonLdPeople(html);
  const person = people.find((entry) => cleanQuery(entry?.name || "").toLowerCase() === wanted)
    || people.find((entry) => adultIdentityMatches(query, entry?.name || ""))
    || {};
  return compactAdultMetadataObject({
    name: adultStructuredScalar(person.name), birthName: adultStructuredScalar(person.birthName || person.additionalName),
    aliases: normalizeAdultTextList(person.alternateName), birthday: normalizeDate(adultStructuredScalar(person.birthDate)),
    birthPlace: adultStructuredScalar(person.birthPlace), nationality: adultStructuredScalar(person.nationality),
    gender: adultStructuredScalar(person.gender), height: adultStructuredScalar(person.height), weight: adultStructuredScalar(person.weight),
    occupation: adultStructuredScalar(person.jobTitle || person.hasOccupation), biography: adultStructuredScalar(person.description),
    officialWebsite: adultStructuredScalar(person.url), poster: adultStructuredScalar(person.image),
    sameAs: normalizeAdultTextList(person.sameAs).filter((value) => /^https?:\/\//i.test(value)),
  });
}

function classifyAdultSocialUrl(value = "") {
  const url = String(value || "").trim(); const lower = url.toLowerCase();
  if (!/^https?:\/\//i.test(url)) return "";
  if (/instagram\.com/.test(lower)) return "instagram"; if (/(?:twitter|x)\.com/.test(lower)) return "x";
  if (/tiktok\.com/.test(lower)) return "tiktok"; if (/reddit\.com/.test(lower)) return "reddit";
  if (/bsky\.app/.test(lower)) return "bluesky"; if (/youtube\.com|youtu\.be/.test(lower)) return "youtube";
  if (/onlyfans\.com/.test(lower)) return "onlyfans"; if (/facebook\.com/.test(lower)) return "facebook"; return "";
}

function extractAdultSocials(html = "", urls = []) {
  const discovered = [...normalizeAdultTextList(urls)]; const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi; let match;
  while ((match = pattern.exec(html)) && discovered.length < 200) discovered.push(match[1]);
  const socials = {}; for (const url of discovered) { const type = classifyAdultSocialUrl(url); if (type && !socials[type]) socials[type] = url; }
  return socials;
}

function normalizeAdultSocialBlock(value) {
  if (!value) return {}; if (!Array.isArray(value) && typeof value === "object") return { ...value }; const output = {};
  for (const entry of Array.isArray(value) ? value : []) { const url = String(entry?.url || entry?.href || "").trim(); const type = String(entry?.type || entry?.provider || classifyAdultSocialUrl(url) || "other").toLowerCase(); if (url && !output[type]) output[type] = url; }
  return output;
}

function isMeaningfulAdultBiography(value = "", query = "") {
  const text = stripHtml(value).trim(); if (text.length < 35 || /open source search|custom metadata source|search results?|not found|access denied|enable javascript/i.test(text)) return false;
  const words = cleanQuery(query).toLowerCase().split(/\s+/).filter((word) => word.length >= 3); return !words.length || words.some((word) => text.toLowerCase().includes(word));
}

function parseAdultMarkRecords(raw = "", source = "public profile") {
  const text = stripHtml(raw);
  if (!text || /^no(ne)?$/i.test(text) || /\[object Object\]|nominee|award|winner|best smile/i.test(text)) return [];
  return text
    .split(/[,;•]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((entry) => ({ description: entry, source, confidence: "low" }));
}

function validatedAdultColor(value = "", kind = "hair") {
  const text = stripHtml(value).trim();
  const allowed = kind === "eye"
    ? /^(?:brown|blue|green|hazel|gr[ae]y|amber|black|heterochromia)$/i
    : /^(?:black|brown|brunette|blond(?:e)?|red|auburn|gr[ae]y|white|blue|green|pink|purple|multicolou?r|bald)$/i;
  return allowed.test(text) ? text : "";
}

function validatedAdultSize(value = "", kind = "dress") {
  const text = stripHtml(value).trim().replace(/^(\d{1,2}(?:\.5)?)\s*\((US|UK|EU)\)$/i, "$2 $1");
  if (!text || /^\d{4}$/.test(text)) return "";
  if (kind === "shoe") return /^(?:(?:US|UK|EU)\s*)?(?:\d{1,2}(?:\.5)?)$/i.test(text) ? text : "";
  return /^(?:(?:US|UK|EU)\s*)?(?:\d{1,2}|X{0,3}[SML]|[SML]|one size)$/i.test(text) ? text : "";
}

function validatedAdultHeight(value = "") {
  const text = stripHtml(value).trim().replace(/[’′]/g, "'").replace(/[“”″]/g, '"');
  if (!text || text.length > 48 || /[{};=]|\b(?:method|polygon|border|classes?|function|return|qtip)\b/i.test(text)) return "";
  let match = text.match(/\b([3-7])\s*(?:ft|feet|foot|')\s*(\d{1,2})?\s*(?:in(?:ches?)?|\")?(?:\s|$)/i);
  if (match) {
    const feet = Number(match[1]);
    const inches = Number(match[2] || 0);
    return inches >= 0 && inches <= 11 ? `${feet} ft ${inches} in` : "";
  }
  match = text.match(/^\s*(9\d|1\d{2}|2[0-4]\d|250)\s*cm\s*$/i);
  if (match) return `${Number(match[1])} cm`;
  match = text.match(/^\s*(0\.9\d?|1(?:\.\d{1,2})?|2(?:\.[0-4]\d?)?)\s*m\s*$/i);
  if (match) return `${Number(match[1])} m`;
  match = text.match(/^\s*([3-8]\d|9[0-6])\s*(?:in|inches|\")\s*$/i);
  if (match) {
    const inches = Number(match[1]);
    return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
  }
  return "";
}

function buildAdultBodyDetailsFromHtml(html = "", sourceName = "", sourceUrl = "") {
  const measurementText = firstAdultMetadataValue(
    parseLabelFromHtml(html, ["Measurements", "Bust/Waist/Hips", "Bust - Waist - Hips", "Stats"]),
    ""
  );
  const measurements = parseAdultMeasurements(measurementText);
  const tattooRaw = parseLabelFromHtml(html, ["Tattoos", "Tattoo"]);
  const piercingRaw = parseLabelFromHtml(html, ["Piercings", "Piercing"]);
  const bra = parseAdultBraSize(parseLabelFromHtml(html, ["Bra/cup size", "Bra Size", "Bra", "Cup Size", "Cup"]));

  return compactAdultMetadataObject({
    height: validatedAdultHeight(parseLabelFromHtml(html, ["Height"])),
    weight: parseLabelFromHtml(html, ["Weight"]),
    ...measurements,
    ...bra,
    pantySize: parseLabelFromHtml(html, ["Panty Size", "Underwear Size"]),
    shoeSize: validatedAdultSize(parseLabelFromHtml(html, ["Shoe Size", "Shoes"]), "shoe"),
    dressSize: validatedAdultSize(parseLabelFromHtml(html, ["Dress Size", "US Dress Size", "UK Dress Size"]), "dress"),
    clothingSize: parseLabelFromHtml(html, ["Clothing Size", "Apparel Size", "General Size"]),
    hairColor: validatedAdultColor(parseLabelFromHtml(html, ["Hair Color", "Hair colour", "Hair"]), "hair"),
    eyeColor: validatedAdultColor(parseLabelFromHtml(html, ["Eye Color", "Eye colour"]), "eye"),
    tattoos: parseAdultMarkRecords(tattooRaw, sourceName),
    piercings: parseAdultMarkRecords(piercingRaw, sourceName),
    sourceName,
    sourceUrl,
    confidence: "low",
  });
}

function decodeAdultHtmlAttribute(value = "") {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function adultIdentityMatches(query = "", candidateName = "") {
  const wanted = cleanQuery(query).toLowerCase();
  const actual = cleanQuery(candidateName).toLowerCase();
  if (!wanted || !actual) return false;
  const wantedTokens = wanted.split(/\s+/).filter(Boolean);
  const actualTokens = actual.split(/\s+/).filter(Boolean);
  return wanted === actual || wantedTokens.every((token) => actualTokens.some((part) => part.startsWith(token)));
}

function adultAgeOnDate(birthday = "", when = new Date()) {
  const match = String(birthday || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  let age = when.getUTCFullYear() - Number(match[1]);
  if (when.getUTCMonth() + 1 < Number(match[2]) || (when.getUTCMonth() + 1 === Number(match[2]) && when.getUTCDate() < Number(match[3]))) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

function absoluteAdultSourceUrl(value = "", baseUrl = "") {
  try { return new URL(decodeAdultHtmlAttribute(value), baseUrl).toString(); }
  catch { return ""; }
}

function extractAdultPageLinks(html = "", baseUrl = "") {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && links.length < 1200) {
    const url = absoluteAdultSourceUrl(match[1], baseUrl);
    const label = stripHtml(match[2]);
    if (url && label) links.push({ url, label });
  }
  return links;
}

function extractTeenIdolsReviewMedia(html = "", profileUrl = "", birthday = "") {
  const output = [];
  const seen = new Set();
  const birthYear = Number(String(birthday || "").slice(0, 4)) || 0;
  const adultYear = birthYear ? birthYear + 18 : 0;
  const pattern = /<img\b([^>]*?)src=["']([^"']+)["']([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html)) && output.length < 30) {
    const attrs = `${match[1]} ${match[3]}`;
    const url = absoluteAdultSourceUrl(match[2], profileUrl);
    if (!url || seen.has(url) || !/teenidols4you\.com/i.test(url) || /(?:logo|sprite|icon|spacer|banner|button)/i.test(url)) continue;
    seen.add(url);
    const label = stripHtml((attrs.match(/(?:alt|title)=["']([^"']+)["']/i) || [])[1] || "TeenIdols photo");
    const context = stripHtml(html.slice(Math.max(0, match.index - 180), Math.min(html.length, pattern.lastIndex + 180)));
    const year = Number((`${label} ${context}`.match(/\b(19\d{2}|20\d{2})\b/) || [])[1]) || 0;
    if (adultYear && year && year < adultYear) continue;
    const verifiedAdultEra = Boolean(adultYear && year > adultYear);
    output.push({
      url,
      previewUrl: url,
      sourceUrl: profileUrl,
      source: "Teen Idols 4 You",
      title: label || "TeenIdols photo",
      kind: "photo",
      galleryYear: year || "",
      ageStatus: verifiedAdultEra ? "verified-adult-era" : "uncertain",
      requiresAgeReview: !verifiedAdultEra,
      selected: verifiedAdultEra,
      reviewReason: verifiedAdultEra ? "Gallery year is after the subject's 18th-birthday year." : "The photo date does not prove the subject was 18 or older; approve only after reviewing it.",
    });
  }
  return output;
}

async function searchTeenIdolsMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  try {
    const indexes = await Promise.allSettled([
      fetchText("https://www.teenidols4you.com/Actors.html", { signal: AbortSignal.timeout(4500) }),
      fetchText("https://www.teenidols4you.com/Singers.html", { signal: AbortSignal.timeout(4500) }),
    ]);
    const links = indexes.flatMap((result) => result.status === "fulfilled" ? extractAdultPageLinks(result.value, "https://www.teenidols4you.com/") : []);
    const match = links.find((entry) => adultIdentityMatches(cleaned, entry.label) && /teenidols4you\.com/i.test(entry.url));
    if (!match) return [];
    const html = await fetchText(match.url, { signal: AbortSignal.timeout(4500) });
    const structured = extractAdultStructuredPerson(html, cleaned);
    const pageName = structured.name || stripHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || match.label);
    if (!adultIdentityMatches(cleaned, pageName)) return [];
    const birthday = normalizeAdultBirthday(firstAdultMetadataValue(structured.birthday, parseLabelFromHtml(html, ["Birth Date", "Birthday", "Date of Birth"])));
    const currentAge = adultAgeOnDate(birthday);
    if (currentAge !== null && currentAge < 18) return [];
    const biography = structured.biography || stripHtml((html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || "");
    const linksOnPage = extractAdultPageLinks(html, match.url);
    const filmographyUrl = linksOnPage.find((entry) => /filmo|filmography|credits/i.test(`${entry.url} ${entry.label}`))?.url || "";
    const mediaCandidates = currentAge !== null && currentAge >= 18 ? extractTeenIdolsReviewMedia(html, match.url, birthday) : [];
    return [compactAdultMetadataObject({
      id: match.url,
      provider: "teenidols4you",
      source: "Teen Idols 4 You",
      confidence: adultIdentityMatches(cleaned, pageName) ? 0.62 : 0.42,
      name: pageName,
      title: pageName,
      birthday,
      birthDate: birthday,
      birthPlace: structured.birthPlace,
      nationality: structured.nationality,
      occupation: structured.occupation,
      biography: isMeaningfulAdultBiography(biography, cleaned) ? biography : "",
      aliases: structured.aliases,
      knownFor: linksOnPage.filter((entry) => /filmo|movie|film|series|television/i.test(`${entry.url} ${entry.label}`)).slice(0, 20).map((entry) => ({ title: entry.label, url: entry.url })),
      movieTvLinks: filmographyUrl ? [filmographyUrl] : [],
      mediaCandidates,
      currentAge,
      ageVerificationStatus: currentAge === null ? "unknown-review-required" : "verified-current-adult",
      generalCelebritySource: true,
      adultOnlyProvider: false,
      mediaReviewRequired: true,
      providerLinks: { teenidols4you: match.url, ...(filmographyUrl ? { teenidols4youFilmography: filmographyUrl } : {}) },
      externalLinks: { teenidols4you: match.url, ...(filmographyUrl ? { teenidols4youFilmography: filmographyUrl } : {}) },
      url: match.url,
      sourceUrl: match.url,
      metadataFetchedAt: new Date().toISOString(),
    })];
  } catch (error) {
    console.warn("Teen Idols 4 You lookup failed; other celebrity metadata retained:", error.message);
    return [];
  }
}

function celebrityTallPlainTextBody(html = "", sourceUrl = "") {
  const text = stripHtml(html);
  const tableValue = (labels = []) => {
    const wanted = new Set(labels.map((label) => cleanQuery(label).toLowerCase()));
    const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripHtml(match[1] || "").trim());
      if (cells.length >= 2 && wanted.has(cleanQuery(cells[0]).toLowerCase()) && cells[1]) return cells[1];
    }
    return "";
  };
  const valueAfter = (labels = []) => {
    const fromTable = tableValue(labels);
    if (fromTable) return fromTable;
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(new RegExp(`${escaped}\\s*[:：-]\\s*([^|•]{1,80}?)(?=\\s+(?:Height|Weight|Body Measurements|Bust|Waist|Hips|Bra Size|Shoe Size|Dress Size|Hair Color|Eye Color|Date of Birth)\\s*[:：-]|$)`, "i"));
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  const measurementsRaw = valueAfter(["Body Measurements", "Measurements"]);
  return compactAdultMetadataObject({
    height: validatedAdultHeight(valueAfter(["Height in Feet Inches", "Height"])),
    weight: valueAfter(["Weight in Pounds", "Weight"]),
    ...parseAdultMeasurements(measurementsRaw),
    ...parseAdultBraSize(valueAfter(["Bra Size", "Bra/cup size"])),
    shoeSize: validatedAdultSize(valueAfter(["Feet/Shoe Size", "Shoe Size"]), "shoe"),
    dressSize: validatedAdultSize(valueAfter(["Dress Size"]), "dress"),
    hairColor: validatedAdultColor(valueAfter(["Hair Color"]), "hair"),
    eyeColor: validatedAdultColor(valueAfter(["Eye Color"]), "eye"),
    sourceName: "CelebrityTall",
    sourceUrl,
    confidence: "low",
  });
}

async function searchCelebrityTallMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const slug = slugifyAdultSource(cleaned);
  const candidateUrls = [
    `https://celebritytall.com/${slug}-height-weight-age/`,
    `https://celebritytall.com/${slug}/`,
  ];
  try {
    const fetchedPages = (await Promise.allSettled(candidateUrls.map(async (url) => ({
      url,
      html: await fetchText(url, { signal: AbortSignal.timeout(6000) }),
    })))).flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    let matchedPage = fetchedPages.find(({ html }) => {
      const structured = extractAdultStructuredPerson(html, cleaned);
      const heading = stripHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/\s+(?:height|measurements|body|bio).*$/i, "").trim();
      return adultIdentityMatches(cleaned, structured.name || heading || "");
    });
    if (!matchedPage) {
      const searchUrl = `https://celebritytall.com/?s=${encodeURIComponent(cleaned)}`;
      const searchHtml = await fetchText(searchUrl, { signal: AbortSignal.timeout(6000) });
      const resultLink = extractAdultPageLinks(searchHtml, searchUrl).find((entry) => adultIdentityMatches(cleaned, entry.label) && /celebritytall\.com/i.test(entry.url));
      if (resultLink) matchedPage = { url: resultLink.url, html: await fetchText(resultLink.url, { signal: AbortSignal.timeout(6000) }) };
    }
    if (!matchedPage) return [];
    const { url, html } = matchedPage;
    const structured = extractAdultStructuredPerson(html, cleaned);
    const heading = stripHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/\s+(?:height|measurements|body|bio).*$/i, "").trim();
    const pageName = structured.name || heading || cleaned;
    if (!adultIdentityMatches(cleaned, pageName)) return [];
    // The generic label parser can see CSS declarations such as "height: 1em".
    // Prefer the source-specific table parser whenever CelebrityTall provides a row.
    const body = { ...buildAdultBodyDetailsFromHtml(html, "CelebrityTall", url), ...celebrityTallPlainTextBody(html, url) };
    const bodyFields = ["height", "weight", "measurementsRaw", "bust", "waist", "hips", "braSize", "shoeSize", "dressSize", "hairColor", "eyeColor"];
    if (!bodyFields.some((field) => body[field])) return [];
    return [compactAdultMetadataObject({
      id: url,
      provider: "celebritytall",
      source: "CelebrityTall (estimated fallback)",
      confidence: 0.28,
      name: pageName,
      title: pageName,
      ...body,
      body,
      enrichmentOnly: true,
      fallbackOnly: true,
      lowConfidenceFallback: true,
      requiresReview: true,
      metadataDisclaimer: "Secondary-source estimates; use only when stronger sources have no measurements and review before saving.",
      providerLinks: { celebritytall: url },
      externalLinks: { celebritytall: url },
      url,
      sourceUrl: url,
      metadataFetchedAt: new Date().toISOString(),
    })];
  } catch (error) {
    console.warn("CelebrityTall fallback unavailable; other celebrity metadata retained:", error.message);
    return [];
  }
}

function celebrityInsidePlainTextBody(html = "", sourceUrl = "") {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const tableValue = (labels = []) => {
    const wanted = labels.map((label) => cleanQuery(label).toLowerCase());
    for (const row of rows) {
      const cells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripHtml(match[1] || "").trim());
      if (cells.length < 2) continue;
      const label = cleanQuery(cells[0]).toLowerCase();
      if (wanted.some((entry) => label === entry || label.startsWith(`${entry} `))) return cells[1] || "";
    }
    return "";
  };
  const measurementsRaw = tableValue(["body measurements", "figure measurements", "measurements"]);
  const cupRaw = tableValue(["bra cup size", "cup size"]);
  const fullBraRaw = tableValue(["bra size"]);
  const fullBra = /^\s*\d{2,3}\s*[a-z]{1,4}\s*$/i.test(fullBraRaw) ? parseAdultBraSize(fullBraRaw) : {};
  const cupSize = /^[a-z]{1,4}$/i.test(cupRaw.trim()) ? cupRaw.trim().toUpperCase() : "";
  return compactAdultMetadataObject({
    height: validatedAdultHeight(tableValue(["height in feet", "height", "height in centimeter"])),
    weight: tableValue(["weight in pounds", "weight", "weight in kilogram"]),
    ...parseAdultMeasurements(measurementsRaw),
    ...fullBra,
    cupSize: fullBra.cupSize || cupSize,
    shoeSize: validatedAdultSize(tableValue(["shoe size", "feet/shoe size"]), "shoe"),
    dressSize: validatedAdultSize(tableValue(["dress size"]), "dress"),
    hairColor: validatedAdultColor(tableValue(["hair color", "natural hair color"]), "hair"),
    eyeColor: validatedAdultColor(tableValue(["eye color"]), "eye"),
    sourceName: "CelebrityInside",
    sourceUrl,
    confidence: "low",
  });
}

async function searchCelebrityInsideMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const slug = slugifyAdultSource(cleaned);
  const candidateUrls = [
    `https://celebrityinside.com/body-measurements/actress/${slug}-height-weight-shoe-bra-size-stats/`,
    `https://celebrityinside.com/body-measurements/models/${slug}-height-weight-shoe-bra-size-stats/`,
    `https://celebrityinside.com/body-measurements/singer/${slug}-height-weight-shoe-bra-size-stats/`,
  ];
  try {
    const pages = (await Promise.allSettled(candidateUrls.map(async (url) => ({ url, html: await fetchText(url, { signal: AbortSignal.timeout(6000) }) }))))
      .flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    let matchedPage = pages.find(({ html }) => {
      const structured = extractAdultStructuredPerson(html, cleaned);
      const heading = stripHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/\s+(?:height|weight|body|measurements).*$/i, "").trim();
      return adultIdentityMatches(cleaned, structured.name || heading);
    });
    if (!matchedPage) {
      const searchUrl = `https://celebrityinside.com/?s=${encodeURIComponent(cleaned)}`;
      const searchHtml = await fetchText(searchUrl, { signal: AbortSignal.timeout(6000) });
      const resultLink = extractAdultPageLinks(searchHtml, searchUrl).find((entry) => adultIdentityMatches(cleaned, entry.label) && /celebrityinside\.com\/body-measurements\//i.test(entry.url));
      if (resultLink) matchedPage = { url: resultLink.url, html: await fetchText(resultLink.url, { signal: AbortSignal.timeout(6000) }) };
    }
    if (!matchedPage) return [];
    const { url, html } = matchedPage;
    const structured = extractAdultStructuredPerson(html, cleaned);
    const heading = stripHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/\s+(?:height|weight|body|measurements).*$/i, "").trim();
    const pageName = structured.name || heading || cleaned;
    if (!adultIdentityMatches(cleaned, pageName)) return [];
    const body = celebrityInsidePlainTextBody(html, url);
    if (!["height", "weight", "measurementsRaw", "bust", "waist", "hips", "braSize", "cupSize", "shoeSize", "dressSize", "hairColor", "eyeColor"].some((field) => body[field])) return [];
    const birthday = normalizeAdultBirthday(structured.birthday || parseLabelFromHtml(html, ["Date of Birth", "Birthday"]));
    return [compactAdultMetadataObject({
      id: url,
      provider: "celebrityinside",
      source: "CelebrityInside (estimated fallback)",
      confidence: 0.26,
      name: pageName,
      title: pageName,
      birthday,
      birthDate: birthday,
      ...body,
      body,
      enrichmentOnly: true,
      fallbackOnly: true,
      lowConfidenceFallback: true,
      requiresReview: true,
      metadataDisclaimer: "Secondary-source estimates; identity and every proposed value require review before saving.",
      providerLinks: { celebrityinside: url },
      externalLinks: { celebrityinside: url },
      url,
      sourceUrl: url,
      metadataFetchedAt: new Date().toISOString(),
    })];
  } catch (error) {
    console.warn("CelebrityInside fallback unavailable; other celebrity metadata retained:", error.message);
    return [];
  }
}

function parseTheNudeProfileHtml(html = "", sourceUrl = "", query = "") {
  const heading = stripHtml((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").trim();
  const title = stripHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
  const pageName = heading || title.replace(/\s+nude\b[\s\S]*$/i, "").trim() || cleanQuery(query);
  if (!pageName || !adultIdentityMatches(query || pageName, pageName)) return null;

  const body = buildAdultBodyDetailsFromHtml(html, "TheNude", sourceUrl);
  const aliases = [...new Set(normalizeAdultTextList(parseLabelFromHtml(html, ["AKA", "Aliases", "Also known as"])))];
  const providerId = parseLabelFromHtml(html, ["ICGID"]);
  const birthdayRaw = parseLabelFromHtml(html, ["Born", "Birth Date", "Birthday"]);
  const birthday = /\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d{2}\b/i.test(birthdayRaw)
    ? normalizeAdultBirthday(birthdayRaw)
    : "";
  const firstSeen = parseLabelFromHtml(html, ["First Seen"]);
  const lastSeen = parseLabelFromHtml(html, ["Last Seen"]);
  const bodyType = parseLabelFromHtml(html, ["Body Type"]);
  const breastDetails = parseLabelFromHtml(html, ["Breasts"]);
  const activities = normalizeAdultTextList(parseLabelFromHtml(html, ["Activities"]));
  const biographyCandidate = firstAdultMetadataValue(
    extractAdultMetaTag(html, "description"),
    extractAdultMetaTag(html, "og:description")
  );
  const biography = isMeaningfulAdultBiography(biographyCandidate, pageName)
    ? stripHtml(biographyCandidate).slice(0, 5000)
    : "";
  const poster = firstAdultMetadataValue(extractAdultMetaTag(html, "og:image"), extractAdultMetaTag(html, "twitter:image"));
  const birthplace = parseLabelFromHtml(html, ["Birthplace", "Place of Birth"]);
  const ethnicity = parseLabelFromHtml(html, ["Ethnicity"]);
  const officialWebsite = parseLabelFromHtml(html, ["Official Site", "Official Website"]);
  const socials = extractAdultSocials(html);

  return compactAdultMetadataObject({
    id: sourceUrl,
    provider: "thenude",
    source: "TheNude (supplemental performer metadata)",
    confidence: 0.44,
    name: pageName,
    title: pageName,
    birthday,
    birthDate: birthday,
    aliases,
    alsoKnownAs: aliases,
    birthPlace: birthplace,
    placeOfBirth: birthplace,
    ethnicity,
    careerStart: firstSeen,
    careerEnd: lastSeen,
    yearsActive: firstSeen && lastSeen ? `${firstSeen}-${lastSeen}` : firstSeen || lastSeen,
    biography,
    description: biography,
    body: compactAdultMetadataObject({ ...body, bodyType, breastDetails }),
    bodyDetails: compactAdultMetadataObject({ ...body, bodyType, breastDetails }),
    ...body,
    bodyType,
    breastDetails,
    activities,
    genres: activities,
    officialWebsite,
    socials,
    socialLinks: socials,
    poster,
    image: poster,
    providerIds: providerId ? { thenude: providerId } : {},
    externalIds: providerId ? { thenude: providerId } : {},
    providerLinks: { thenude: sourceUrl, ...socials },
    externalLinks: { thenude: sourceUrl, ...socials },
    url: sourceUrl,
    sourceUrl,
    enrichmentOnly: true,
    fallbackOnly: true,
    requiresReview: true,
    lowConfidenceFallback: true,
    mediaReviewRequired: true,
    metadataDisclaimer: "Supplemental performer-directory metadata. Confirm identity and review each proposed value before saving; media is never auto-imported.",
    metadataCapability: "detail",
    fetchStatus: "complete",
    metadataFetchedAt: new Date().toISOString(),
  });
}

async function searchTheNudeMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  const searchUrl = `https://www.thenude.com/index.php?page=search&action=searchModels&__form_name=navbar-search&m_aka=on&m_name=${strictEncode(cleaned)}`;
  try {
    const searchHtml = await fetchText(searchUrl, { signal: AbortSignal.timeout(7000) });
    const links = extractAdultPageLinks(searchHtml, searchUrl)
      .filter((entry) => /thenude\.com\/(?!index\.php|cover\/)[^/?#]+_\d+\.htm(?:[?#]|$)/i.test(entry.url))
      .filter((entry) => adultIdentityMatches(cleaned, entry.label.replace(/\s+nude\b[\s\S]*$/i, "")))
      .slice(0, 3);
    const settled = await Promise.allSettled(links.map(async ({ url }) => {
      const html = await fetchText(url, { signal: AbortSignal.timeout(7000) });
      return parseTheNudeProfileHtml(html, url, cleaned);
    }));
    return settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  } catch (error) {
    console.warn("TheNude performer metadata lookup unavailable; other providers retained:", error.message);
    return [];
  }
}

function scoreAdultMetadataCandidate(query = "", candidate = {}, providerRank = 10) {
  const q = cleanQuery(query).toLowerCase();
  const n = cleanQuery(candidate.name || candidate.title || "").toLowerCase();
  let score = 20 - providerRank;
  if (n === q) score += 70;
  else if (n && (n.includes(q) || q.includes(n))) score += 40;
  const aliases = Array.isArray(candidate.aliases || candidate.alsoKnownAs) ? (candidate.aliases || candidate.alsoKnownAs) : [];
  if (aliases.some((alias) => cleanQuery(alias).toLowerCase() === q)) score += 35;
  if (candidate.birthday || candidate.birthDate) score += 5;
  if (candidate.poster || candidate.image) score += 5;
  if (candidate.height || candidate.measurements || candidate.measurementsRaw || candidate.body?.height || candidate.body?.measurementsRaw) score += 8;
  return Math.max(0, Math.min(100, score));
}

async function searchStashBoxMetadata(query) {
  const cleaned = cleanQuery(query);
  const endpoint = process.env.TPDB_ENDPOINT || process.env.TPDB_API_URL || process.env.STASHBOX_ENDPOINT || "";
  const apiKey = process.env.TPDB_API_KEY || process.env.STASHBOX_API_KEY || "";
  if (!cleaned || !endpoint) return [];

  const graphql = {
    query: `query FindPerformers($term: String!) { findPerformers(performer_filter: { name: { value: $term, modifier: INCLUDES } }, filter: { per_page: 8 }) { performers { id name aliases birthdate country ethnicity eye_color hair_color height_cm measurements fake_tits tattoos piercings image_path urls { url site { name } } } } }`,
    variables: { term: cleaned },
  };

  try {
    const data = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { ApiKey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(graphql),
    });
    const rows = data?.data?.findPerformers?.performers || data?.data?.performers || [];
    return rows.map((person) => {
      const url = person.urls?.[0]?.url || "";
      const body = compactAdultMetadataObject({
        height: person.height_cm ? `${person.height_cm} cm` : "",
        measurementsRaw: person.measurements || "",
        hairColor: person.hair_color || "",
        eyeColor: person.eye_color || "",
        tattoos: person.tattoos ? [{ description: person.tattoos, source: "TPDB/Stash-box", confidence: "medium" }] : [],
        piercings: person.piercings ? [{ description: person.piercings, source: "TPDB/Stash-box", confidence: "medium" }] : [],
        sourceName: "TPDB / Stash-box",
        sourceUrl: url,
        confidence: "medium",
      });
      return compactAdultMetadataObject({
        id: person.id,
        provider: "tpdb-stashbox",
        source: "TPDB / Stash-box",
        confidence: cleanQuery(person.name).toLowerCase() === cleaned.toLowerCase() ? 0.94 : 0.76,
        name: person.name,
        title: person.name,
        aliases: person.aliases || [],
        alsoKnownAs: person.aliases || [],
        birthday: normalizeDate(person.birthdate || ""),
        birthDate: normalizeDate(person.birthdate || ""),
        nationality: person.country || "",
        ethnicity: person.ethnicity || "",
        poster: person.image_path || "",
        image: person.image_path || "",
        url,
        body,
        bodyDetails: body,
        height: body.height,
        measurements: body.measurementsRaw,
        measurementsRaw: body.measurementsRaw,
        hairColor: body.hairColor,
        eyeColor: body.eyeColor,
        tattoos: body.tattoos,
        piercings: body.piercings,
        raw: person,
      });
    });
  } catch (error) {
    console.warn("TPDB/Stash-box lookup failed:", error.message);
    return [];
  }
}

async function fetchTmdbPersonDetails(personId, authOptions = {}) {
  if (!personId) return null;
  return fetchJson(
    `https://api.themoviedb.org/3/person/${strictEncode(personId)}?append_to_response=combined_credits,external_ids,images&language=en-US`,
    authOptions
  );
}

function normalizeTmdbCreditSummary(details = {}, searchPerson = {}) {
  const combined = details.combined_credits || {};
  const credits = [
    ...(combined.cast || []),
    ...(combined.crew || []),
    ...(searchPerson.known_for || []),
  ];

  const seen = new Set();
  return credits
    .filter((item) => item && (item.title || item.name))
    .sort((a, b) => Number(b.popularity || b.vote_count || 0) - Number(a.popularity || a.vote_count || 0))
    .filter((item) => {
      const key = `${item.media_type || "media"}-${item.id || item.title || item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function searchTmdbPersonMetadata(query) {
  const cleaned = cleanQuery(query);
  const bearer = process.env.TMDB_BEARER_TOKEN || "";
  const apiKey = process.env.TMDB_API_KEY || "";
  if (!cleaned || (!bearer && !apiKey)) return [];

  const authOptions = bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {};

  try {
    const data = await fetchJson(
      `https://api.themoviedb.org/3/search/person?query=${strictEncode(cleaned)}&include_adult=false&language=en-US&page=1${apiKey ? `&api_key=${strictEncode(apiKey)}` : ""}`,
      authOptions
    );

    const rows = (data.results || []).slice(0, 5);
    const detailedRows = await Promise.all(rows.map(async (person) => {
      try {
        const details = await fetchTmdbPersonDetails(String(person.id), authOptions);
        return { person, details: details || {} };
      } catch {
        return { person, details: {} };
      }
    }));

    return detailedRows.map(({ person, details }) => {
      const knownFor = normalizeTmdbCreditSummary(details, person);
      const imdbId = details.external_ids?.imdb_id || "";
      const profilePath = details.profile_path || person.profile_path || "";
      const providerIds = compactAdultMetadataObject({
        tmdb: String(person.id),
        imdb: imdbId,
      });
      const providerLinks = compactAdultMetadataObject({
        tmdb: `https://www.themoviedb.org/person/${person.id}`,
        imdb: imdbId ? `https://www.imdb.com/name/${imdbId}/` : "",
      });

      return compactAdultMetadataObject({
        id: person.id,
        provider: "tmdb",
        source: "TMDB Person",
        confidence: String(person.name || "").toLowerCase() === cleaned.toLowerCase() ? 0.94 : 0.72,
        name: person.name,
        title: person.name,
        description: details.biography || knownFor.map((item) => item.title || item.name).filter(Boolean).slice(0, 4).join(", "),
        biography: details.biography || "",
        knownFor,
        knownForDepartment: details.known_for_department || person.known_for_department || "",
        popularity: person.popularity || details.popularity || 0,
        birthday: normalizeDate(details.birthday || ""),
        birthDate: normalizeDate(details.birthday || ""),
        deathday: normalizeDate(details.deathday || ""),
        deathDate: normalizeDate(details.deathday || ""),
        birthPlace: details.place_of_birth || "",
        placeOfBirth: details.place_of_birth || "",
        poster: profilePath ? `https://image.tmdb.org/t/p/w500${profilePath}` : "",
        image: profilePath ? `https://image.tmdb.org/t/p/w500${profilePath}` : "",
        imdbId,
        providerIds,
        externalIds: providerIds,
        providerLinks,
        externalLinks: providerLinks,
        url: `https://www.themoviedb.org/person/${person.id}`,
        raw: { search: person, details },
      });
    });
  } catch (error) {
    console.warn("TMDB person lookup failed:", error.message);
    return [];
  }
}

async function searchMusicBrainzPersonMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  try {
    const data = await fetchJson(`https://musicbrainz.org/ws/2/artist?query=${strictEncode(`artist:${cleaned}`)}&fmt=json&limit=5`);
    return (data.artists || []).map((artist) => ({
      id: artist.id,
      provider: "musicbrainz",
      source: "MusicBrainz",
      confidence: String(artist.name || "").toLowerCase() === cleaned.toLowerCase() ? 0.9 : 0.66,
      name: artist.name,
      title: artist.name,
      description: [artist.type, artist.disambiguation, artist.country].filter(Boolean).join(" · "),
      birthday: artist["life-span"]?.begin || "",
      birthDate: artist["life-span"]?.begin || "",
      aliases: (artist.aliases || []).map((alias) => alias.name).filter(Boolean).slice(0, 8),
      providerIds: { musicbrainz: artist.id },
      externalIds: { musicbrainz: artist.id },
      providerLinks: { musicbrainz: `https://musicbrainz.org/artist/${artist.id}` },
      externalLinks: { musicbrainz: `https://musicbrainz.org/artist/${artist.id}` },
      url: `https://musicbrainz.org/artist/${artist.id}`,
      raw: artist,
    }));
  } catch (error) {
    console.warn("MusicBrainz lookup failed:", error.message);
    return [];
  }
}


function resolveAdultMetadataUrl(value = "", baseUrl = "") {
  try {
    return new URL(String(value || ""), baseUrl).toString();
  } catch {
    return "";
  }
}

function extractAdultMetaTag(html = "", key = "") {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripHtml(match[1]).trim();
  }
  return "";
}

function extractTheLordOfPornProfileLink(html = "", query = "", searchUrl = "") {
  const cleaned = cleanQuery(query).toLowerCase();
  const candidates = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const href = resolveAdultMetadataUrl(match[1], searchUrl);
    if (!href || !/thelordofporn\.com/i.test(href)) continue;

    const text = stripHtml(match[2]).replace(/\s+/g, " ").trim();
    const lowerText = text.toLowerCase();
    const lowerHref = href.toLowerCase();
    const score =
      (lowerText === cleaned ? 100 : 0) +
      (lowerText.includes(cleaned) ? 45 : 0) +
      (lowerHref.includes(slugifyAdultSource(query)) ? 35 : 0) +
      (/pornstar|performer|model|profile/i.test(lowerHref) ? 12 : 0);

    if (score > 0) candidates.push({ href, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.href || "";
}

function extractTheLordOfPornBiography(html = "") {
  const sectionPatterns = [
    /<(?:section|div)[^>]*(?:id|class)=["'][^"']*(?:bio|biography|description|about)[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/i,
    /<h[1-4][^>]*>\s*(?:Biography|About|Bio)\s*<\/h[1-4]>([\s\S]*?)(?=<h[1-4]|$)/i,
  ];

  for (const pattern of sectionPatterns) {
    const match = html.match(pattern);
    const text = stripHtml(match?.[1] || "").replace(/\s+/g, " ").trim();
    if (text.length >= 80) return text.slice(0, 5000);
  }

  return extractAdultMetaTag(html, "description") || extractAdultMetaTag(html, "og:description");
}

function extractTheLordOfPornLinks(html = "", pageUrl = "", performerName = "") {
  const socials = {};
  const providerLinks = { thelordofporn: pageUrl };
  const externalLinks = { thelordofporn: pageUrl };
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const aliases = String(performerName || "").toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3);
  const blockedBrandTerms = ["thelordofporn", "lordofporn", "tlop", "the lord of porn"];
  let match;

  while ((match = pattern.exec(html))) {
    const href = resolveAdultMetadataUrl(match[1], pageUrl);
    if (!href) continue;
    const lower = href.toLowerCase();
    const label = stripHtml(match[2] || "").toLowerCase();
    if (blockedBrandTerms.some((term) => lower.includes(term.replace(/\s+/g, "")) || label.includes(term))) continue;
    const pathText = decodeURIComponent(lower).replace(/[^a-z0-9]+/g, " ");
    const identityRelevant = aliases.length && aliases.some((part) => pathText.includes(part) || label.includes(part));
    if (!identityRelevant) continue;

    if (/twitter\.com|x\.com/.test(lower)) socials.twitter = href;
    else if (/instagram\.com/.test(lower)) socials.instagram = href;
    else if (/tiktok\.com/.test(lower)) socials.tiktok = href;
    else if (/onlyfans\.com/.test(lower)) socials.onlyfans = href;
    else if (/youtube\.com|youtu\.be/.test(lower)) socials.youtube = href;
    else if (/twitch\.tv/.test(lower)) socials.twitch = href;
  }

  Object.assign(providerLinks, socials);
  Object.assign(externalLinks, socials);
  return { socials, providerLinks, externalLinks };
}

function extractTheLordOfPornMedia(html = "", pageUrl = "", performerName = "") {
  const photos = [];
  const videos = [];
  const seenPhotos = new Set();
  const seenVideos = new Set();
  const identityTokens = cleanQuery(performerName).toLowerCase().split(/\s+/).filter((token) => token.length >= 3);
  const belongsToPerformer = (value = "") => !identityTokens.length || identityTokens.some((token) => String(value).toLowerCase().includes(token));

  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(html)) && photos.length < 40) {
    const url = resolveAdultMetadataUrl(match[1], pageUrl);
    if (!url || seenPhotos.has(url)) continue;
    if (!/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) continue;
    if (/logo|icon|avatar|sprite|flag/i.test(url)) continue;
    if (/-150x150\b/i.test(url) && !belongsToPerformer(url)) continue;
    if (!belongsToPerformer(url) && photos.length > 0) continue;
    seenPhotos.add(url);
    photos.push(url);
  }

  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkPattern.exec(html)) && videos.length < 30) {
    const url = resolveAdultMetadataUrl(match[1], pageUrl);
    const text = stripHtml(match[2]).replace(/\s+/g, " ").trim();
    if (!url || seenVideos.has(url)) continue;
    if (!/video|watch|scene/i.test(`${url} ${text}`) || !belongsToPerformer(`${url} ${text}`)) continue;
    if (!/thelordofporn\.com/i.test(url)) continue;
    seenVideos.add(url);
    videos.push({ title: text || "Video / scene", url });
  }

  return { photos, videos };
}

async function searchTheLordOfPornMetadata(query) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  try {
    const searchUrl = `https://thelordofporn.com/?s=${strictEncode(cleaned)}`;
    const searchHtml = await fetchText(searchUrl);
    const profileUrl = extractTheLordOfPornProfileLink(searchHtml, cleaned, searchUrl);
    if (!profileUrl) return [];

    const html = await fetchText(profileUrl);
    const title =
      extractAdultMetaTag(html, "og:title") ||
      stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "") ||
      stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || cleaned);
    const candidateName = title
      .replace(/\s*[-|–—]\s*The Lord of Porn.*$/i, "")
      .replace(/\s*[-|–—].*$/i, "")
      .trim() || cleaned;

    if (isJunkAdultMetadataCandidate({
      provider: "thelordofporn",
      source: "The Lord of Porn",
      name: candidateName,
      title,
      url: profileUrl,
    })) {
      return [];
    }

    const body = buildAdultBodyDetailsFromHtml(html, "The Lord of Porn", profileUrl);
    const birthday = parseLabelFromHtml(html, ["Born", "Birthday", "Birth Date", "Date of Birth"]);
    const birthplace = parseLabelFromHtml(html, ["Born", "Birthplace", "Place of Birth", "Born in"]);
    const careerStart = parseLabelFromHtml(html, ["Career Start", "Career started", "Years active"]);
    const biography = extractTheLordOfPornBiography(html);
    const poster =
      extractAdultMetaTag(html, "og:image") ||
      extractAdultMetaTag(html, "twitter:image") ||
      "";
    const links = extractTheLordOfPornLinks(html, profileUrl, candidateName);
    const media = extractTheLordOfPornMedia(html, profileUrl, candidateName);

    return [compactAdultMetadataObject({
      id: profileUrl,
      provider: "thelordofporn",
      source: "The Lord of Porn",
      confidence: candidateName.toLowerCase() === cleaned.toLowerCase() ? 0.91 : 0.72,
      name: candidateName,
      title: candidateName,
      description: biography,
      biography,
      birthday: normalizeDate(birthday || ""),
      birthDate: normalizeDate(birthday || ""),
      birthPlace: birthplace,
      placeOfBirth: birthplace,
      careerStart,
      url: profileUrl,
      sourceUrl: profileUrl,
      poster,
      image: poster,
      artwork: poster ? [poster] : [],
      photos: media.photos,
      videos: media.videos,
      scenes: media.videos,
      body,
      bodyDetails: body,
      height: body.height,
      weight: body.weight,
      measurements: body.measurementsRaw,
      measurementsRaw: body.measurementsRaw,
      bust: body.bust,
      waist: body.waist,
      hips: body.hips,
      braSize: body.braSize,
      pantySize: body.pantySize,
      shoeSize: body.shoeSize,
      dressSize: body.dressSize,
      clothingSize: body.clothingSize,
      hairColor: body.hairColor,
      eyeColor: body.eyeColor,
      tattoos: body.tattoos,
      piercings: body.piercings,
      socials: links.socials,
      providerIds: { thelordofporn: profileUrl },
      externalIds: { thelordofporn: profileUrl },
      providerLinks: links.providerLinks,
      externalLinks: links.externalLinks,
      raw: {
        sourceUrl: profileUrl,
        careerStart,
        photos: media.photos,
        videos: media.videos,
      },
    })];
  } catch (error) {
    console.warn("The Lord of Porn metadata lookup failed:", error.message);
    return [];
  }
}

async function fetchPublicAdultProfileCandidate(query, provider, url) {
  try {
    const html = await fetchText(url);
    const structured = extractAdultStructuredPerson(html, query);
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || query);
    const candidateName = structured.name || title.replace(/\s*[-|].*$/, "") || query;
    const providerKey = String(provider || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const lowerUrl = String(url || "").toLowerCase();

    if (isJunkAdultMetadataCandidate({ provider: providerKey, source: provider, name: candidateName, title, url })) {
      return null;
    }

    if (providerKey === "iafd" && (/perfid=invalid\b/.test(lowerUrl) || /\/invalid\.htm\b/.test(lowerUrl))) {
      return null;
    }

    const parsedBody = buildAdultBodyDetailsFromHtml(html, provider, url);
    const body = compactAdultMetadataObject({ ...parsedBody, height: firstAdultMetadataValue(structured.height, parsedBody.height), weight: firstAdultMetadataValue(structured.weight, parsedBody.weight) });
    const birthday = firstAdultMetadataValue(structured.birthday, parseLabelFromHtml(html, ["Birth Date", "Birthday", "Born", "Date of Birth"]));
    const birthplace = firstAdultMetadataValue(structured.birthPlace, parseLabelFromHtml(html, ["Birthplace", "Place of Birth", "Born in"]));
    const aliases = [...new Set([...normalizeAdultTextList(structured.aliases), ...normalizeAdultTextList(parseLabelFromHtml(html, ["Aliases", "Alias", "Also known as", "Stage names"]))])];
    const biographyCandidate = firstAdultMetadataValue(structured.biography, extractAdultMetaTag(html, "description"), extractAdultMetaTag(html, "og:description"));
    const biography = isMeaningfulAdultBiography(biographyCandidate, query) ? stripHtml(biographyCandidate).slice(0, 5000) : "";
    const socials = extractAdultSocials(html, structured.sameAs || []);
    const structuredWebsite = String(structured.officialWebsite || "").replace(/\/$/, ""); const sourcePage = String(url || "").replace(/\/$/, "");
    const officialWebsite = firstAdultMetadataValue(structuredWebsite && structuredWebsite !== sourcePage ? structuredWebsite : "", parseLabelFromHtml(html, ["Official Website", "Website"]));
    const poster = firstAdultMetadataValue(structured.poster, extractAdultMetaTag(html, "og:image"), extractAdultMetaTag(html, "twitter:image"));
    const candidate = compactAdultMetadataObject({
      id: url,
      provider: providerKey,
      source: provider,
      confidence: 0.42,
      name: candidateName,
      title: candidateName,
      birthday: normalizeDate(birthday || ""),
      birthDate: normalizeDate(birthday || ""),
      birthName: firstAdultMetadataValue(structured.birthName, parseLabelFromHtml(html, ["Birth Name", "Real Name", "Full Name"])),
      aliases, alsoKnownAs: aliases,
      birthPlace: birthplace,
      placeOfBirth: birthplace,
      nationality: firstAdultMetadataValue(structured.nationality, parseLabelFromHtml(html, ["Nationality", "Country"])), ethnicity: parseLabelFromHtml(html, ["Ethnicity"]),
      gender: firstAdultMetadataValue(structured.gender, parseLabelFromHtml(html, ["Gender", "Sex"])), occupation: firstAdultMetadataValue(structured.occupation, parseLabelFromHtml(html, ["Occupation", "Profession"])),
      careerStart: parseLabelFromHtml(html, ["Career Start", "Career started", "Debut", "Years Active"]), biography, description: biography,
      officialWebsite, socials, socialLinks: socials, poster, image: poster, url, sourceUrl: url,
      body,
      bodyDetails: body,
      height: body.height,
      weight: body.weight,
      measurements: body.measurementsRaw,
      measurementsRaw: body.measurementsRaw,
      bust: body.bust,
      waist: body.waist,
      hips: body.hips,
      braSize: body.braSize,
      braBand: body.braBand,
      cupSize: body.cupSize,
      pantySize: body.pantySize,
      shoeSize: body.shoeSize,
      dressSize: body.dressSize,
      clothingSize: body.clothingSize,
      hairColor: body.hairColor,
      eyeColor: body.eyeColor,
      tattoos: body.tattoos,
      piercings: body.piercings,
      providerLinks: { [providerKey]: url, ...socials }, externalLinks: { [providerKey]: url, ...socials },
      metadataCapability: "detail", fetchStatus: "complete",
    });
    const meaningfulFields = ["birthday", "birthName", "aliases", "birthPlace", "nationality", "ethnicity", "biography", "height", "weight", "measurementsRaw", "braSize", "pantySize", "shoeSize", "dressSize", "hairColor", "eyeColor", "tattoos", "piercings", "officialWebsite", "socials"].filter((key) => { const value = candidate[key]; return Array.isArray(value) ? value.length : value && (typeof value !== "object" || Object.keys(value).length); });
    return { ...candidate, fetchStatus: meaningfulFields.length >= 2 ? "complete" : "limited", meaningfulFieldCount: meaningfulFields.length };
  } catch {
    return null;
  }
}

function findAdultProfileLinkFromSearch(html = "", query = "", searchUrl = "", hostnamePattern = null) {
  const wanted = cleanQuery(query).toLowerCase(); const slug = slugifyAdultSource(query); const candidates = []; const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let match;
  while ((match = pattern.exec(html))) { const href = resolveAdultMetadataUrl(match[1], searchUrl); if (!href || href === searchUrl || (hostnamePattern && !hostnamePattern.test(href))) continue; const text = cleanQuery(stripHtml(match[2])).toLowerCase(); const lowerHref = href.toLowerCase(); if (/\/search(?:[/?#]|$)|[?&](?:q|query|search)=/i.test(lowerHref)) continue; let score = 0; if (text === wanted) score += 100; else if (text.includes(wanted) || wanted.includes(text)) score += 55; if (slug && lowerHref.replace(/[^a-z0-9]+/g, "-").includes(slug)) score += 45; if (/profile|person|pornstar|performer|model|star/i.test(lowerHref)) score += 18; if (/category|tag|page\/\d+|login|signup|privacy|terms/i.test(lowerHref)) score -= 60; if (score > 20) candidates.push({ href, score }); }
  candidates.sort((left, right) => right.score - left.score); return candidates[0]?.href || "";
}

async function searchAdultProfileDetailPage(query, provider, searchUrl, hostnamePattern) {
  try { const searchHtml = await fetchText(searchUrl); const profileUrl = findAdultProfileLinkFromSearch(searchHtml, query, searchUrl, hostnamePattern); return profileUrl ? fetchPublicAdultProfileCandidate(query, provider, profileUrl) : null; } catch { return null; }
}

function buildExternalOnlyAdultSource(query, provider, source, url) {
  return compactAdultMetadataObject({ id: `${provider}-${slugifyAdultSource(query)}`, provider, source, confidence: 0.2, name: cleanQuery(query), title: cleanQuery(query), url, sourceUrl: url, externalOnly: true, metadataCapability: "search-only", fetchStatus: "external-only" });
}

function normalizeCustomMetadataSources(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return { name: "Custom source", url: entry, enabled: true };
      return { ...(entry || {}), enabled: entry?.enabled !== false };
    })
    .filter((entry) => entry.enabled !== false && entry.url);
}

const ADULT_BROWSE_ONLY_METADATA_DOMAINS = new Set([
  "dirtypornpics.com",
  "freepussypics.net",
  "hotnudegirls.net",
  "hotblondesporn.com",
  "luxuretv.com",
  "euroxxx.net",
  "theporndude.com",
  "rule34.xxx",
]);

function isBrowseOnlyAdultMetadataUrl(value = "") {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
    return ADULT_BROWSE_ONLY_METADATA_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

async function searchCustomAdultMetadataUrls(query, sources = []) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const customSources = normalizeCustomMetadataSources(sources)
    .filter((source) => !isBrowseOnlyAdultMetadataUrl(source.url))
    .filter((source) => source.metadataEnabled !== false)
    .slice(0, 16);
  const fetched = await Promise.all(customSources.map(async (source, index) => {
    const template = String(source.url || "");
    const url = template
      .replaceAll("{query}", strictEncode(cleaned))
      .replaceAll("{queryPlus}", strictEncode(cleaned).replace(/%20/g, "+"))
      .replaceAll("{querySlug}", slugifyAdultSource(cleaned));
    const provider = source.name || source.id || `Custom source ${index + 1}`;
    const candidate = await fetchPublicAdultProfileCandidate(cleaned, provider, url);
    if (candidate) {
      return {
        ...candidate,
        provider: "custom-url",
        source: provider,
        confidence: Number(source.confidence || 0.38),
        sourceUrl: url,
        customSourceId: source.id || source.name || url,
      };
    }
    return { ...buildExternalOnlyAdultSource(cleaned, "custom-url", provider, url), confidence: Number(source.confidence || 0.2), customSourceId: source.id || source.name || url };
  }));

  return fetched.filter(Boolean);
}

async function searchPublicAdultReferenceMetadata(query, libraryType = "") {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const slug = slugifyAdultSource(cleaned);
  const underscored = underscoreAdultSourceName(cleaned);
  const detailRuns = [];
  const candidates = [];

  if (libraryType !== "celebrities") {
    const defineBabeSearch = `https://www.definebabe.com/search/${strictEncode(cleaned)}/`; const freeOnesSearch = `https://www.freeones.com/search?q=${strictEncode(cleaned)}`; const iafdSearch = `https://www.iafd.com/results.asp?searchtype=comprehensive&searchstring=${strictEncode(cleaned)}`;
    detailRuns.push(
      searchAdultProfileDetailPage(cleaned, "DefineBabe", defineBabeSearch, /definebabe\.com/i).then((candidate) => candidate || buildExternalOnlyAdultSource(cleaned, "definebabe-search", "DefineBabe search", defineBabeSearch)),
      searchAdultProfileDetailPage(cleaned, "FreeOnes", freeOnesSearch, /freeones\.com/i).then((candidate) => candidate || buildExternalOnlyAdultSource(cleaned, "freeones-search", "FreeOnes search", freeOnesSearch)),
      searchAdultProfileDetailPage(cleaned, "IAFD", iafdSearch, /iafd\.com\/person\.rme/i).then((candidate) => candidate || buildExternalOnlyAdultSource(cleaned, "iafd-search", "IAFD search", iafdSearch))
    );
  }

  if (libraryType === "celebrities") {
    detailRuns.push(fetchPublicAdultProfileCandidate(cleaned, "Fashion Model Directory", `https://www.fashionmodeldirectory.com/models/${underscored}/summary/`));
  }

  detailRuns.push(fetchPublicAdultProfileCandidate(cleaned, "Boobpedia", `https://www.boobpedia.com/boobs/${underscored}`));
  const fetched = await Promise.all(detailRuns);
  for (const candidate of fetched) {
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

const ADULT_LINKED_DETAIL_PROVIDERS = { xxxbios: "XXXBios", xxxbiosFemale: "XXXBios", xxxbiosTrans: "XXXBios", iafd: "IAFD", iafdFemale: "IAFD", iafdMale: "IAFD", adultFilmDatabase: "Adult Film Database", babesdirectory: "BabesDirectory" };
async function fetchLinkedAdultMetadataCandidates(query, candidates = []) {
  const links = []; const seen = new Set();
  for (const candidate of candidates) for (const [key, url] of Object.entries({ ...(candidate?.providerLinks || {}), ...(candidate?.externalLinks || {}) })) { const provider = ADULT_LINKED_DETAIL_PROVIDERS[key]; if (!provider || !/^https?:\/\//i.test(String(url || ""))) continue; const dedupeKey = String(url).replace(/\/$/, "").toLowerCase(); if (seen.has(dedupeKey)) continue; seen.add(dedupeKey); links.push({ provider, url: String(url) }); }
  const settled = await Promise.allSettled(links.slice(0, 8).map(({ provider, url }) => fetchPublicAdultProfileCandidate(query, provider, url)));
  return settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

function scoreAdultMetadataCandidate(query = "", candidate = {}, providerRank = 99) {
  const cleaned = cleanQuery(query).toLowerCase();
  const name = cleanQuery(candidate.name || candidate.title || "").toLowerCase();
  const exactBoost = cleaned && name === cleaned ? 70 : 0;
  const containsBoost = cleaned && name.includes(cleaned) ? 24 : 0;
  const confidence = typeof candidate.confidence === "number" ? candidate.confidence * 100 : 0;
  const providerBoost = Math.max(0, 45 - providerRank * 5);
  const imageBoost = candidate.image || candidate.poster ? 5 : 0;
  const idBoost = candidate.wikidataId || candidate.imdbId || candidate.providerIds ? 5 : 0;
  return confidence + exactBoost + containsBoost + providerBoost + imageBoost + idBoost;
}

function isJunkAdultMetadataCandidate(candidate = {}) {
  const name = cleanQuery(candidate.name || "").toLowerCase();
  const title = cleanQuery(candidate.title || "").toLowerCase();
  const source = String(candidate.source || candidate.provider || "").toLowerCase();
  const url = String(candidate.url || candidate.sourceUrl || "").toLowerCase();
  const text = cleanQuery([candidate.name, candidate.title, candidate.description, candidate.url].filter(Boolean).join(" ")).toLowerCase();
  if (!text) return true;

  const exactJunkValues = new Set([
    "invalid",
    "model not found",
    "not found",
    "page not found",
    "404 not found",
    "access denied",
    "just a moment",
  ]);

  if (exactJunkValues.has(name) || exactJunkValues.has(title)) return true;

  if (
    (source.includes("iafd") || url.includes("iafd.com")) &&
    (
      name === "invalid" ||
      title === "invalid" ||
      /perfid=invalid\b/.test(url) ||
      /\/invalid\.htm\b/.test(url)
    )
  ) {
    return true;
  }

  const junkPatterns = [
    /^invalid$/,
    /^model not found$/,
    /^not found$/,
    /^page not found$/,
    /model not found/,
    /404 not found/,
    /page not found/,
    /access denied/,
    /just a moment/,
  ];

  return junkPatterns.some((pattern) => pattern.test(text));
}

function hasUsefulAdultMetadataAnchor(candidate = {}) {
  return Boolean(
    candidate.wikidataId ||
    candidate.tmdbId ||
    candidate.imdbId ||
    candidate.providerIds ||
    candidate.externalIds ||
    candidate.url ||
    candidate.sourceUrl ||
    candidate.profileImage ||
    candidate.image ||
    candidate.poster
  );
}

function isLowConfidenceAdultFallback(candidate = {}) {
  const provider = String(candidate.provider || candidate.source || "").toLowerCase();
  const confidence = Number(candidate.confidence || 0);
  const lowConfidenceProviders = new Set([
    "boobpedia",
    "iafd",
    "definebabe-search",
    "freeones-search",
    "celebrity-body-details",
    "fashion-model-directory",
    "models-com",
  ]);

  return lowConfidenceProviders.has(provider) && confidence > 0 && confidence < 0.5;
}

function dedupeAdultMetadataCandidates(query = "", candidates = [], profile = ADULT_METADATA_SOURCE_PROFILES.personal) {
  const byKey = new Map();

  for (const candidate of candidates.filter(Boolean)) {
    if (isJunkAdultMetadataCandidate(candidate)) continue;
    if (!hasUsefulAdultMetadataAnchor(candidate) && Number(candidate.confidence || 0) < 0.55) continue;

    const provider = candidate.provider || "provider";
    const sourceText = `${provider} ${candidate.source || ""}`.toLowerCase();
    const candidateUrl = String(candidate.url || candidate.sourceUrl || "");
    const iafdId = candidate.providerIds?.iafd || candidate.externalIds?.iafd || candidateUrl.match(/[?&]perfid=([^&#]+)/i)?.[1] || "";
    const canonicalUrl = candidateUrl.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
    const key = /iafd/.test(sourceText)
      ? `iafd-${decodeURIComponent(iafdId || cleanQuery(candidate.name || candidate.title || query)).toLowerCase()}`
      : `${provider}-${candidate.id || canonicalUrl || candidate.name || candidate.title}`.toLowerCase();
    if (byKey.has(key)) continue;
    const providerRank = getAdultProviderRank(provider, profile);
    const matchScore = scoreAdultMetadataCandidate(query, candidate, providerRank);
    byKey.set(key, {
      ...candidate,
      sourceProfile: profile.id,
      sourcePriority: providerRank,
      matchScore,
      lowConfidenceFallback: isLowConfidenceAdultFallback(candidate),
    });
  }

  return [...byKey.values()].sort((a, b) => {
    const rankA = Number.isFinite(Number(a.sourcePriority)) ? Number(a.sourcePriority) : 99;
    const rankB = Number.isFinite(Number(b.sourcePriority)) ? Number(b.sourcePriority) : 99;
    const scoreDiff = (b.matchScore || 0) - (a.matchScore || 0);
    if (Math.abs(scoreDiff) > 8) return scoreDiff;
    if (rankA !== rankB) return rankA - rankB;
    return scoreDiff;
  });
}

const KNOWN_ADULT_SOURCE_MATCHES = {
  "riley reid": [
    {
      id: "nubiles-1566-riley-reid",
      provider: "nubiles",
      source: "Nubiles",
      confidence: 0.82,
      name: "Riley Reid",
      title: "Riley Reid",
      url: "https://nubiles.net/model/profile/1566/riley-reid?coupon=63402&c=current-gallery-player-ad",
      description: "Known direct Nubiles profile mapping saved in Homestead.",
    },
  ],
  "presley dawson": [
    {
      id: "nubiles-2240-presley-dawson",
      provider: "nubiles",
      source: "Nubiles",
      confidence: 0.82,
      name: "Presley Dawson",
      title: "Presley Dawson",
      url: "https://nubiles.net/model/profile/2240/presley-dawson?coupon=63402&c=current-gallery-player-ad",
      description: "Known direct Nubiles profile mapping saved in Homestead.",
    },
    {
      id: "picsx-362037-presley-dawson",
      provider: "pics-x",
      source: "Pics-X",
      confidence: 0.78,
      name: "Presley Dawson",
      title: "Presley Dawson",
      url: "https://www.pics-x.com/gallery/362037/pretty-pussy-nubiles#image-61",
      description: "Known Pics-X gallery mapping saved in Homestead.",
    },
  ],
  "persley dawson": [
    {
      id: "nubiles-2240-presley-dawson",
      provider: "nubiles",
      source: "Nubiles",
      confidence: 0.76,
      name: "Presley Dawson",
      title: "Presley Dawson",
      url: "https://nubiles.net/model/profile/2240/presley-dawson?coupon=63402&c=current-gallery-player-ad",
      description: "Known direct Nubiles profile mapping saved in Homestead.",
    },
    {
      id: "picsx-362037-presley-dawson",
      provider: "pics-x",
      source: "Pics-X",
      confidence: 0.74,
      name: "Presley Dawson",
      title: "Presley Dawson",
      url: "https://www.pics-x.com/gallery/362037/pretty-pussy-nubiles#image-61",
      description: "Known Pics-X gallery mapping saved in Homestead.",
    },
  ],
};

function getKnownAdultSourceMatches(query = "") {
  const cleaned = cleanQuery(query).toLowerCase();
  return (KNOWN_ADULT_SOURCE_MATCHES[cleaned] || []).map((candidate) => ({ ...candidate }));
}

function normalizeAdultCandidateForMetadata(candidate = {}, existingMetadata = {}) {
  const candidateBody = candidate.body || candidate.bodyDetails || candidate.physicalDetails || {};
  const parsedMeasurements = parseAdultMeasurements(firstAdultMetadataValue(candidate.measurements, candidate.measurementsRaw, candidateBody.measurementsRaw, candidateBody.measurements));
  const sourceName = firstAdultMetadataValue(candidate.source, candidate.provider, candidateBody.sourceName, existingMetadata.metadataSource);
  const sourceUrl = firstAdultMetadataValue(candidate.url, candidate.sourceUrl, candidateBody.sourceUrl, existingMetadata.sourceUrl);
  const externalOnly = candidate.externalOnly === true || candidate.metadataCapability === "search-only";
  const candidateBiography = firstAdultMetadataValue(candidate.biography, externalOnly ? "" : candidate.description);
  const candidateSocials = normalizeAdultSocialBlock(candidate.socials || candidate.socialLinks);
  const metadata = {
    ...existingMetadata,
    name: candidate.name || candidate.title || existingMetadata.name || "",
    birthday: candidate.birthday || candidate.birthDate || existingMetadata.birthday || "",
    birthDate: candidate.birthDate || candidate.birthday || existingMetadata.birthDate || "",
    birthName: candidate.birthName || candidate.realName || existingMetadata.birthName || existingMetadata.realName || "",
    biography: candidateBiography || existingMetadata.biography || existingMetadata.description || "",
    description: candidateBiography || existingMetadata.description || "",
    nationality: candidate.nationality || existingMetadata.nationality || "",
    ethnicity: candidate.ethnicity || existingMetadata.ethnicity || "",
    countryOfCitizenship: candidate.countryOfCitizenship || candidate.nationality || existingMetadata.countryOfCitizenship || "",
    gender: candidate.gender || candidate.sexOrGender || existingMetadata.gender || existingMetadata.sexOrGender || "",
    sexOrGender: candidate.sexOrGender || candidate.gender || existingMetadata.sexOrGender || existingMetadata.gender || "",
    birthPlace: candidate.birthPlace || candidate.placeOfBirth || existingMetadata.birthPlace || existingMetadata.placeOfBirth || "",
    placeOfBirth: candidate.placeOfBirth || candidate.birthPlace || existingMetadata.placeOfBirth || existingMetadata.birthPlace || "",
    sexualOrientation: candidate.sexualOrientation || candidate.orientation || existingMetadata.sexualOrientation || existingMetadata.orientation || "",
    orientation: candidate.orientation || candidate.sexualOrientation || existingMetadata.orientation || existingMetadata.sexualOrientation || "",
    industries: candidate.industries || existingMetadata.industries || [],
    industry: candidate.industry || (Array.isArray(candidate.industries) ? candidate.industries.join(", ") : "") || existingMetadata.industry || "",
    genres: candidate.genres || existingMetadata.genres || [],
    genre: candidate.genre || (Array.isArray(candidate.genres) ? candidate.genres.join(", ") : "") || existingMetadata.genre || "",
    occupations: candidate.occupations || existingMetadata.occupations || [],
    agencies: candidate.agencies || existingMetadata.agencies || [], clients: candidate.clients || existingMetadata.clients || [],
    work: candidate.work || existingMetadata.work || [], relatedPeople: candidate.relatedPeople || existingMetadata.relatedPeople || [],
    occupation: candidate.occupation || (Array.isArray(candidate.occupations) ? candidate.occupations.join(", ") : "") || existingMetadata.occupation || "",
    careerStart: candidate.careerStart || candidate.debut || existingMetadata.careerStart || existingMetadata.debut || "",
    careerEnd: candidate.careerEnd || existingMetadata.careerEnd || "", yearsActive: candidate.yearsActive || existingMetadata.yearsActive || "",
    studios: candidate.studios || existingMetadata.studios || [], awards: candidate.awards || existingMetadata.awards || [],
    careerMilestones: candidate.careerMilestones || existingMetadata.careerMilestones || [], relationships: candidate.relationships || existingMetadata.relationships || [],
    imdbId: candidate.imdbId || existingMetadata.imdbId || "",
    wikidataId: candidate.wikidataId || existingMetadata.wikidataId || "",
    wikipediaTitle: candidate.wikipediaTitle || existingMetadata.wikipediaTitle || "",
    officialWebsite: candidate.officialWebsite || existingMetadata.officialWebsite || "",
    aliases: candidate.aliases || candidate.alsoKnownAs || existingMetadata.aliases || existingMetadata.alsoKnownAs || [],
    alsoKnownAs: candidate.alsoKnownAs || candidate.aliases || existingMetadata.alsoKnownAs || existingMetadata.aliases || [],
    height: validatedAdultHeight(candidate.height || candidateBody.height || existingMetadata.height || ""),
    weight: candidate.weight || candidateBody.weight || existingMetadata.weight || "",
    measurements: candidate.measurements || candidate.measurementsRaw || candidateBody.measurementsRaw || parsedMeasurements.measurementsRaw || existingMetadata.measurements || "",
    measurementsRaw: candidate.measurementsRaw || candidate.measurements || candidateBody.measurementsRaw || parsedMeasurements.measurementsRaw || existingMetadata.measurementsRaw || "",
    bust: candidate.bust || candidateBody.bust || parsedMeasurements.bust || existingMetadata.bust || "",
    waist: candidate.waist || candidateBody.waist || parsedMeasurements.waist || existingMetadata.waist || "",
    hips: candidate.hips || candidateBody.hips || parsedMeasurements.hips || existingMetadata.hips || "",
    braSize: candidate.braSize || candidate.cupSize || candidateBody.braSize || candidateBody.cupSize || parsedMeasurements.braSize || existingMetadata.braSize || existingMetadata.cupSize || "",
    braBand: candidate.braBand || candidate.bandSize || candidateBody.braBand || candidateBody.bandSize || parsedMeasurements.braBand || existingMetadata.braBand || existingMetadata.bandSize || "",
    cupSize: candidate.cupSize || candidateBody.cupSize || parsedMeasurements.cupSize || existingMetadata.cupSize || "",
    pantySize: candidate.pantySize || candidate.underwearSize || candidateBody.pantySize || candidateBody.underwearSize || existingMetadata.pantySize || existingMetadata.underwearSize || "",
    shoeSize: candidate.shoeSize || candidateBody.shoeSize || existingMetadata.shoeSize || "",
    dressSize: candidate.dressSize || candidateBody.dressSize || existingMetadata.dressSize || "",
    clothingSize: candidate.clothingSize || candidateBody.clothingSize || existingMetadata.clothingSize || "",
    bodyType: candidate.bodyType || candidateBody.bodyType || existingMetadata.bodyType || "",
    breastDetails: candidate.breastDetails || candidateBody.breastDetails || existingMetadata.breastDetails || "",
    hairColor: candidate.hairColor || candidate.hair || candidateBody.hairColor || candidateBody.hair || existingMetadata.hairColor || existingMetadata.hair || "",
    eyeColor: candidate.eyeColor || candidate.eyes || candidateBody.eyeColor || candidateBody.eyes || existingMetadata.eyeColor || existingMetadata.eyes || "",
    tattoos: Array.isArray(candidate.tattoos) ? candidate.tattoos : (Array.isArray(candidateBody.tattoos) ? candidateBody.tattoos : (existingMetadata.tattoos || [])),
    piercings: Array.isArray(candidate.piercings) ? candidate.piercings : (Array.isArray(candidateBody.piercings) ? candidateBody.piercings : (existingMetadata.piercings || [])),
    socials: { ...normalizeAdultSocialBlock(existingMetadata.socials), ...candidateSocials }, socialLinks: { ...normalizeAdultSocialBlock(existingMetadata.socialLinks), ...candidateSocials },
    photos: candidate.photos || existingMetadata.photos || [], videos: candidate.videos || existingMetadata.videos || [], scenes: candidate.scenes || existingMetadata.scenes || [], artwork: candidate.artwork || existingMetadata.artwork || [],
    clothingSizes: compactAdultMetadataObject({
      ...(existingMetadata.clothingSizes || {}),
      bra: candidate.braSize || candidate.cupSize || candidateBody.braSize || existingMetadata.clothingSizes?.bra || existingMetadata.braSize || "",
      panty: candidate.pantySize || candidateBody.pantySize || existingMetadata.clothingSizes?.panty || existingMetadata.pantySize || "",
      shoe: candidate.shoeSize || candidateBody.shoeSize || existingMetadata.clothingSizes?.shoe || existingMetadata.shoeSize || "",
      dress: candidate.dressSize || candidateBody.dressSize || existingMetadata.clothingSizes?.dress || existingMetadata.dressSize || "",
      size: candidate.clothingSize || candidateBody.clothingSize || existingMetadata.clothingSizes?.size || existingMetadata.clothingSize || "",
      source: sourceName,
      confidence: candidate.bodyConfidence || candidateBody.confidence || "low",
    }),
    body: compactAdultMetadataObject({ ...(existingMetadata.body || {}), ...candidateBody, sourceName, sourceUrl, confidence: candidate.bodyConfidence || candidateBody.confidence || candidate.confidence || "low" }),
    bodyDetails: compactAdultMetadataObject({ ...(existingMetadata.bodyDetails || {}), ...candidateBody, sourceName, sourceUrl, confidence: candidate.bodyConfidence || candidateBody.confidence || candidate.confidence || "low" }),
    providerIds: { ...(existingMetadata.providerIds || {}), ...(candidate.providerIds || candidate.externalIds || {}) },
    providerLinks: { ...(existingMetadata.providerLinks || {}), ...(candidate.providerLinks || candidate.externalLinks || {}) },
    externalIds: { ...(existingMetadata.externalIds || {}), ...(candidate.providerIds || candidate.externalIds || {}) },
    externalLinks: { ...(existingMetadata.externalLinks || {}), ...(candidate.providerLinks || candidate.externalLinks || {}) },
    sourceUrl: sourceUrl || "",
    externalOnly, metadataCapability: candidate.metadataCapability || (externalOnly ? "search-only" : "detail"), fetchStatus: candidate.fetchStatus || (externalOnly ? "external-only" : "complete"),
    metadataSource: sourceName || "adult-auto-fetch",
    metadataFetchedAt: new Date().toISOString(),
    metadataMatch: candidate.provider
      ? {
          provider: candidate.provider || "manual",
          providerId: candidate.id || candidate.wikidataId || candidate.whisparrId || candidate.url || "",
          matchedName: candidate.name || candidate.title || existingMetadata.name || "",
          source: candidate.source || candidate.provider || "",
          url: candidate.url || "",
          confidence: candidate.confidence || null,
          matchedAt: new Date().toISOString(),
          providerIds: candidate.providerIds || candidate.externalIds || {},
          providerLinks: candidate.providerLinks || candidate.externalLinks || {},
        }
      : existingMetadata.metadataMatch,
  };

  if (candidate.provider === "models-com" || candidate.enrichmentOnly) {
    for (const [field, value] of Object.entries(existingMetadata)) {
      if (value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)) metadata[field] = value;
    }
    for (const field of existingMetadata.manualMetadataFields || []) metadata[field] = existingMetadata[field];
    for (const [field, locked] of Object.entries(existingMetadata.metadataLocks || {})) if (locked) metadata[field] = existingMetadata[field];
    metadata.providerLinks = { ...(candidate.providerLinks || {}), ...(existingMetadata.providerLinks || {}) };
  }
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== "";
  }));
}

async function searchAdultMetadata(query, options = {}) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const libraryType = normalizeAdultLibraryType(options.libraryType || options.library || "personal");
  const profile = getAdultMetadataSourceProfile(libraryType);
  const limit = Number(options.limit || 12);
  const providerRuns = [];

  if (libraryType === "celebrities") {
    providerRuns.push(searchTmdbPersonMetadata(cleaned));
    providerRuns.push(searchWikidataPerson(cleaned, { limit: options.wikidataLimit || options.limit || 5 }));
    providerRuns.push(searchWikipediaPerson(cleaned, { limit: options.wikipediaLimit || 4 }));
    providerRuns.push(searchPublicAdultReferenceMetadata(cleaned, libraryType));
    providerRuns.push(searchCustomAdultMetadataUrls(cleaned, options.customSourceUrls || options.customSources || []));
    if (options.teenIdolsEnabled !== false) providerRuns.push(searchTeenIdolsMetadata(cleaned));
  } else if (libraryType === "performers") {
    providerRuns.push(searchWikidataPerson(cleaned, { limit: options.wikidataLimit || options.limit || 5 }));
    providerRuns.push(searchWikipediaPerson(cleaned, { limit: options.wikipediaLimit || 4 }));
    providerRuns.push(Promise.resolve(getKnownAdultSourceMatches(cleaned)));
    providerRuns.push(searchWhisparrMetadata(cleaned, options.whisparr || {}));
    providerRuns.push(searchStashBoxMetadata(cleaned));
    providerRuns.push(searchTheLordOfPornMetadata(cleaned));
    providerRuns.push(searchPublicAdultReferenceMetadata(cleaned, libraryType));
    if (options.theNudeEnabled !== false) providerRuns.push(searchTheNudeMetadata(cleaned));
    providerRuns.push(searchCustomAdultMetadataUrls(cleaned, options.customSourceUrls || options.customSources || []));
  } else {
    providerRuns.push(searchWikidataPerson(cleaned, { limit: options.wikidataLimit || options.limit || 5 }));
    providerRuns.push(searchWikipediaPerson(cleaned, { limit: options.wikipediaLimit || 4 }));
    providerRuns.push(Promise.resolve(getKnownAdultSourceMatches(cleaned)));
    providerRuns.push(searchCustomAdultMetadataUrls(cleaned, options.customSourceUrls || options.customSources || []));
    providerRuns.push(searchWhisparrMetadata(cleaned, options.whisparr || {}));
    providerRuns.push(searchTheLordOfPornMetadata(cleaned));
    providerRuns.push(searchPublicAdultReferenceMetadata(cleaned, libraryType));
  }

  const settled = await Promise.allSettled(providerRuns);
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (libraryType === "celebrities" && options.celebrityTallEnabled !== false) {
    try { candidates.push(...await searchCelebrityTallMetadata(cleaned)); }
    catch (error) { console.warn("CelebrityTall fallback failed; other metadata retained:", error.message); }
  }
  if (libraryType === "celebrities" && options.celebrityInsideEnabled !== false) {
    try { candidates.push(...await searchCelebrityInsideMetadata(cleaned)); }
    catch (error) { console.warn("CelebrityInside fallback failed; other metadata retained:", error.message); }
  }
  const linkedCandidates = libraryType === "performers" ? await fetchLinkedAdultMetadataCandidates(cleaned, candidates) : [];
  const modelsAnchors = candidates.filter((candidate) => ["wikidata", "wikipedia", "tmdb"].includes(candidate.provider) && Number(candidate.confidence || 0) >= 0.6);
  if (modelsAnchors.length && options.modelsEnabled !== false) {
    try { const model = await lookupModelsProfile(cleaned, modelsAnchors); if (model) linkedCandidates.push(model); }
    catch (error) { console.warn("Models.com enrichment unavailable; other metadata retained:", error.message); }
  }

  return dedupeAdultMetadataCandidates(cleaned, [...candidates, ...linkedCandidates], profile).slice(0, limit);
}

module.exports = {
  cleanQuery,
  normalizeAdultCandidateForMetadata,
  getKnownAdultSourceMatches,
  searchAdultMetadata,
  searchWhisparrMetadata,
  searchWikidataPerson,
  searchWikipediaPerson,
  searchStashBoxMetadata,
  searchTmdbPersonMetadata,
  searchMusicBrainzPersonMetadata,
  searchPublicAdultReferenceMetadata,
  searchTheLordOfPornMetadata,
  searchCustomAdultMetadataUrls,
  searchTeenIdolsMetadata,
  searchCelebrityTallMetadata,
  searchCelebrityInsideMetadata,
  searchTheNudeMetadata,
  parseTheNudeProfileHtml,
  validatedAdultHeight,
  isBrowseOnlyAdultMetadataUrl,
  buildAdultBodyDetailsFromHtml,
  extractAdultStructuredPerson,
  fetchLinkedAdultMetadataCandidates,
  getAdultMetadataSourceProfile,
  normalizeAdultLibraryType,
};
