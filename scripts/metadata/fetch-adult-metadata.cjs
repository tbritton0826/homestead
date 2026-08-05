const DEFAULT_USER_AGENT = "Homestead/1.0 (adult-metadata)";

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
      "models-com": 4,
      "fashion-model-directory": 5,
      custom: 6,
      "custom-url": 6,
      "celebrity-body-details": 7,
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
      "definebabe-search": 2,
      "tpdb-stashbox": 3,
      whisparr: 4,
      iafd: 5,
      "custom-url": 6,
      custom: 6,
      "freeones-search": 7,
      boobpedia: 8,
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
  if (String(value.unit || "").endsWith("/Q11573")) return `${amount} m`;
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
      new RegExp(`${escaped}\\s*<\\/[^>]+>\\s*<[^>]+>([^<]{1,160})`, "i"),
      new RegExp(`${escaped}\\s*[:：]\\s*<[^>]*>?([^<\\n]{1,160})`, "i"),
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
  const match = raw.match(/(\d{2,3}(?:\.\d+)?)\s*[-–]\s*(\d{2,3}(?:\.\d+)?)\s*[-–]\s*(\d{2,3}(?:\.\d+)?)/);
  if (!match) return { measurementsRaw: raw };
  return {
    measurementsRaw: `${match[1]}-${match[2]}-${match[3]}`,
    bust: match[1],
    waist: match[2],
    hips: match[3],
  };
}

function parseAdultMarkRecords(raw = "", source = "public profile") {
  const text = stripHtml(raw);
  if (!text || /^no(ne)?$/i.test(text)) return [];
  return text
    .split(/[,;•]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((entry) => ({ description: entry, source, confidence: "low" }));
}

function buildAdultBodyDetailsFromHtml(html = "", sourceName = "", sourceUrl = "") {
  const measurementText = firstAdultMetadataValue(
    parseLabelFromHtml(html, ["Measurements", "Bust/Waist/Hips", "Bust - Waist - Hips", "Stats"]),
    ""
  );
  const measurements = parseAdultMeasurements(measurementText);
  const tattooRaw = parseLabelFromHtml(html, ["Tattoos", "Tattoo"]);
  const piercingRaw = parseLabelFromHtml(html, ["Piercings", "Piercing"]);

  return compactAdultMetadataObject({
    height: parseLabelFromHtml(html, ["Height"]),
    weight: parseLabelFromHtml(html, ["Weight"]),
    ...measurements,
    braSize: parseLabelFromHtml(html, ["Bra/cup size", "Bra Size", "Bra", "Cup Size", "Cup"]),
    pantySize: parseLabelFromHtml(html, ["Panty Size", "Underwear Size"]),
    shoeSize: parseLabelFromHtml(html, ["Shoe Size", "Shoes", "Shoe"]),
    dressSize: parseLabelFromHtml(html, ["Dress Size", "Dress"]),
    clothingSize: parseLabelFromHtml(html, ["Clothing Size", "Size"]),
    hairColor: parseLabelFromHtml(html, ["Hair", "Hair Color", "Hair colour"]),
    eyeColor: parseLabelFromHtml(html, ["Eyes", "Eye Color", "Eye colour"]),
    tattoos: parseAdultMarkRecords(tattooRaw, sourceName),
    piercings: parseAdultMarkRecords(piercingRaw, sourceName),
    sourceName,
    sourceUrl,
    confidence: "low",
  });
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

function extractTheLordOfPornMedia(html = "", pageUrl = "") {
  const photos = [];
  const videos = [];
  const seenPhotos = new Set();
  const seenVideos = new Set();

  const imagePattern = /<img\b[^>]*(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imagePattern.exec(html)) && photos.length < 40) {
    const url = resolveAdultMetadataUrl(match[1], pageUrl);
    if (!url || seenPhotos.has(url)) continue;
    if (!/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) continue;
    if (/logo|icon|avatar|sprite|flag/i.test(url)) continue;
    seenPhotos.add(url);
    photos.push(url);
  }

  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = linkPattern.exec(html)) && videos.length < 30) {
    const url = resolveAdultMetadataUrl(match[1], pageUrl);
    const text = stripHtml(match[2]).replace(/\s+/g, " ").trim();
    if (!url || seenVideos.has(url)) continue;
    if (!/video|watch|scene|review/i.test(`${url} ${text}`)) continue;
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
    const media = extractTheLordOfPornMedia(html, profileUrl);

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
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || query);
    const candidateName = title.replace(/\s*[-|].*$/, "") || query;
    const providerKey = String(provider || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const lowerUrl = String(url || "").toLowerCase();

    if (isJunkAdultMetadataCandidate({ provider: providerKey, source: provider, name: candidateName, title, url })) {
      return null;
    }

    if (providerKey === "iafd" && (/perfid=invalid\b/.test(lowerUrl) || /\/invalid\.htm\b/.test(lowerUrl))) {
      return null;
    }

    const body = buildAdultBodyDetailsFromHtml(html, provider, url);
    const birthday = parseLabelFromHtml(html, ["Birth Date", "Birthday", "Born", "Date of Birth"]);
    const birthplace = parseLabelFromHtml(html, ["Birthplace", "Place of Birth", "Born in"]);
    return compactAdultMetadataObject({
      id: url,
      provider: providerKey,
      source: provider,
      confidence: 0.42,
      name: candidateName,
      title: candidateName,
      birthday: normalizeDate(birthday || ""),
      birthDate: normalizeDate(birthday || ""),
      birthPlace: birthplace,
      placeOfBirth: birthplace,
      url,
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
    });
  } catch {
    return null;
  }
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
    .slice(0, 8);
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
    return compactAdultMetadataObject({
      id: url,
      provider: "custom-url",
      source: provider,
      confidence: Number(source.confidence || 0.25),
      name: cleaned,
      title: cleaned,
      description: "Custom metadata source URL configured by the user.",
      url,
      sourceUrl: url,
      customSourceId: source.id || source.name || url,
    });
  }));

  return fetched.filter(Boolean);
}

async function searchPublicAdultReferenceMetadata(query, libraryType = "") {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const slug = slugifyAdultSource(cleaned);
  const underscored = underscoreAdultSourceName(cleaned);
  const urls = [];
  const candidates = [];

  if (libraryType !== "celebrities") {
    candidates.push({
      id: `definebabe-search-${slug}`,
      provider: "definebabe-search",
      source: "DefineBabe search",
      confidence: 0.35,
      name: cleaned,
      title: cleaned,
      description: "Open source search for aliases, birthday, birthplace, height, weight, measurements, and social links.",
      url: `https://www.definebabe.com/search/${strictEncode(cleaned)}/`,
    });
    candidates.push({
      id: `freeones-search-${slug}`,
      provider: "freeones-search",
      source: "FreeOnes search",
      confidence: 0.34,
      name: cleaned,
      title: cleaned,
      description: "Open source search for public body details, tattoos, piercings, and aliases.",
      url: `https://www.freeones.com/search?q=${strictEncode(cleaned)}`,
    });
  }

  if (libraryType === "celebrities") {
    urls.push(["Models.com", `https://models.com/models/${slug}`]);
    urls.push(["Fashion Model Directory", `https://www.fashionmodeldirectory.com/models/${underscored}/summary/`]);
  }

  urls.push(["Boobpedia", `https://www.boobpedia.com/boobs/${underscored}`]);
  urls.push(["IAFD", `https://www.iafd.com/person.rme/perfid=${slug}/gender=f/${slug}.htm`]);

  const fetched = await Promise.all(urls.map(([provider, url]) => fetchPublicAdultProfileCandidate(cleaned, provider, url)));
  for (const candidate of fetched) {
    if (candidate) candidates.push(candidate);
  }
  return candidates;
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
    const key = `${provider}-${candidate.id || candidate.name || candidate.title || candidate.url}`.toLowerCase();
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
  const metadata = {
    ...existingMetadata,
    name: candidate.name || candidate.title || existingMetadata.name || "",
    birthday: candidate.birthday || candidate.birthDate || existingMetadata.birthday || "",
    birthDate: candidate.birthDate || candidate.birthday || existingMetadata.birthDate || "",
    biography: candidate.description || existingMetadata.biography || existingMetadata.description || "",
    description: candidate.description || existingMetadata.description || "",
    nationality: candidate.nationality || existingMetadata.nationality || "",
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
    imdbId: candidate.imdbId || existingMetadata.imdbId || "",
    wikidataId: candidate.wikidataId || existingMetadata.wikidataId || "",
    wikipediaTitle: candidate.wikipediaTitle || existingMetadata.wikipediaTitle || "",
    officialWebsite: candidate.officialWebsite || existingMetadata.officialWebsite || "",
    aliases: candidate.aliases || candidate.alsoKnownAs || existingMetadata.aliases || existingMetadata.alsoKnownAs || [],
    alsoKnownAs: candidate.alsoKnownAs || candidate.aliases || existingMetadata.alsoKnownAs || existingMetadata.aliases || [],
    height: candidate.height || candidateBody.height || existingMetadata.height || "",
    weight: candidate.weight || candidateBody.weight || existingMetadata.weight || "",
    measurements: candidate.measurements || candidate.measurementsRaw || candidateBody.measurementsRaw || parsedMeasurements.measurementsRaw || existingMetadata.measurements || "",
    measurementsRaw: candidate.measurementsRaw || candidate.measurements || candidateBody.measurementsRaw || parsedMeasurements.measurementsRaw || existingMetadata.measurementsRaw || "",
    bust: candidate.bust || candidateBody.bust || parsedMeasurements.bust || existingMetadata.bust || "",
    waist: candidate.waist || candidateBody.waist || parsedMeasurements.waist || existingMetadata.waist || "",
    hips: candidate.hips || candidateBody.hips || parsedMeasurements.hips || existingMetadata.hips || "",
    braSize: candidate.braSize || candidate.cupSize || candidateBody.braSize || candidateBody.cupSize || existingMetadata.braSize || existingMetadata.cupSize || "",
    pantySize: candidate.pantySize || candidate.underwearSize || candidateBody.pantySize || candidateBody.underwearSize || existingMetadata.pantySize || existingMetadata.underwearSize || "",
    shoeSize: candidate.shoeSize || candidateBody.shoeSize || existingMetadata.shoeSize || "",
    dressSize: candidate.dressSize || candidateBody.dressSize || existingMetadata.dressSize || "",
    clothingSize: candidate.clothingSize || candidateBody.clothingSize || existingMetadata.clothingSize || "",
    hairColor: candidate.hairColor || candidate.hair || candidateBody.hairColor || candidateBody.hair || existingMetadata.hairColor || existingMetadata.hair || "",
    eyeColor: candidate.eyeColor || candidate.eyes || candidateBody.eyeColor || candidateBody.eyes || existingMetadata.eyeColor || existingMetadata.eyes || "",
    tattoos: Array.isArray(candidate.tattoos) ? candidate.tattoos : (Array.isArray(candidateBody.tattoos) ? candidateBody.tattoos : (existingMetadata.tattoos || [])),
    piercings: Array.isArray(candidate.piercings) ? candidate.piercings : (Array.isArray(candidateBody.piercings) ? candidateBody.piercings : (existingMetadata.piercings || [])),
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
  } else if (libraryType === "performers") {
    providerRuns.push(searchWikidataPerson(cleaned, { limit: options.wikidataLimit || options.limit || 5 }));
    providerRuns.push(searchWikipediaPerson(cleaned, { limit: options.wikipediaLimit || 4 }));
    providerRuns.push(Promise.resolve(getKnownAdultSourceMatches(cleaned)));
    providerRuns.push(searchWhisparrMetadata(cleaned, options.whisparr || {}));
    providerRuns.push(searchStashBoxMetadata(cleaned));
    providerRuns.push(searchTheLordOfPornMetadata(cleaned));
    providerRuns.push(searchPublicAdultReferenceMetadata(cleaned, libraryType));
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

  return dedupeAdultMetadataCandidates(cleaned, candidates, profile).slice(0, limit);
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
  isBrowseOnlyAdultMetadataUrl,
  getAdultMetadataSourceProfile,
  normalizeAdultLibraryType,
};
