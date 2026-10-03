const crypto = require("crypto");

const DEFAULT_PREFERENCES = Object.freeze({
  enabled: true,
  gender: "female",
  bodyTypes: ["petite"],
  breastShapes: ["perky"],
  heightCategories: ["short", "medium"],
  maxWeight: 125,
  pantySizeMax: "M",
  braBandMax: 36,
  cupSizeMax: "B",
  minAge: 18,
  maxAge: 35,
  requirePoster: true,
  matchMode: "strict",
});

const CUP_ORDER = ["AA", "A", "B", "C", "D", "DD", "E", "F", "FF", "G", "GG", "H", "HH", "I", "J", "K"];
const PANTY_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];

function cleanList(value, limit = 12) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizePreferences(value = {}) {
  const minAge = Math.max(18, Math.min(100, Number(value.minAge ?? DEFAULT_PREFERENCES.minAge) || DEFAULT_PREFERENCES.minAge));
  return {
    ...DEFAULT_PREFERENCES,
    ...value,
    enabled: value.enabled !== false,
    gender: String(value.gender || DEFAULT_PREFERENCES.gender).trim().toLowerCase(),
    bodyTypes: cleanList(value.bodyTypes ?? DEFAULT_PREFERENCES.bodyTypes, 8),
    breastShapes: cleanList(value.breastShapes ?? DEFAULT_PREFERENCES.breastShapes, 8),
    heightCategories: cleanList(value.heightCategories ?? DEFAULT_PREFERENCES.heightCategories, 3).filter((entry) => ["short", "medium", "tall"].includes(entry)),
    maxWeight: Math.max(0, Math.min(1000, Number(value.maxWeight ?? DEFAULT_PREFERENCES.maxWeight) || 0)),
    pantySizeMax: String(value.pantySizeMax ?? DEFAULT_PREFERENCES.pantySizeMax).trim().toUpperCase(),
    braBandMax: Math.max(0, Math.min(80, Number(value.braBandMax ?? DEFAULT_PREFERENCES.braBandMax) || 0)),
    cupSizeMax: String(value.cupSizeMax ?? DEFAULT_PREFERENCES.cupSizeMax).trim().toUpperCase(),
    minAge,
    maxAge: Math.max(minAge, Math.min(100, Number(value.maxAge ?? DEFAULT_PREFERENCES.maxAge) || DEFAULT_PREFERENCES.maxAge)),
    requirePoster: value.requirePoster !== false,
    matchMode: value.matchMode === "compatible" ? "compatible" : "strict",
  };
}

function normalizeName(value = "") {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function ageFromBirthDate(value = "", now = new Date()) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function normalizeHeightCm(candidate = {}) {
  const cm = parseNumber(candidate.heightCm ?? candidate.height_cm);
  if (cm) return cm;
  const inches = parseNumber(candidate.heightIn ?? candidate.height_in);
  if (inches) return inches * 2.54;
  const raw = String(candidate.height || "").toLowerCase();
  const feet = raw.match(/(\d+)\s*(?:ft|')\s*(\d+)?/);
  if (feet) return (Number(feet[1]) * 12 + Number(feet[2] || 0)) * 2.54;
  const numeric = parseNumber(raw);
  if (!numeric) return null;
  return /cm/.test(raw) || numeric > 100 ? numeric : numeric * 2.54;
}

function heightCategory(heightCm) {
  if (!heightCm) return "";
  const inches = heightCm / 2.54;
  if (inches < 63) return "short";
  if (inches <= 67) return "medium";
  return "tall";
}

function normalizeWeightLb(candidate = {}) {
  const explicitLb = parseNumber(candidate.weightLb ?? candidate.weight_lbs);
  if (explicitLb) return explicitLb;
  const raw = String(candidate.weight ?? "").toLowerCase();
  const numeric = parseNumber(raw);
  if (!numeric) return null;
  return /kg/.test(raw) ? numeric * 2.2046226218 : numeric;
}

function normalizeImages(candidate = {}) {
  const values = [candidate.imageUrl, candidate.image, candidate.poster, candidate.thumbnail, candidate.images].flat().filter(Boolean);
  return values.map((entry) => typeof entry === "string" ? entry : entry.url || entry.image || "").filter(Boolean);
}

function normalizeTextEntries(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((entry) => typeof entry === "string" ? entry : [entry.location, entry.description].filter(Boolean).join(": "))
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeCandidate(candidate = {}, provider = {}) {
  const aliases = cleanList(candidate.aliases || candidate.alsoKnownAs);
  const birthDate = String(candidate.birthDate || candidate.birth_date || candidate.birthday || "").slice(0, 10);
  const heightCm = normalizeHeightCm(candidate);
  const images = normalizeImages(candidate);
  const urls = (Array.isArray(candidate.urls) ? candidate.urls : []).map((entry) => typeof entry === "string" ? entry : entry.url || "").filter(Boolean);
  const tattoos = normalizeTextEntries(candidate.tattoos);
  const piercings = normalizeTextEntries(candidate.piercings);
  const breastType = String(candidate.breastType || candidate.breast_type || "").trim().toLowerCase();
  const explicitBreastShapes = cleanList(candidate.breastShapes || candidate.breastShape);
  const breastShapes = explicitBreastShapes.length ? explicitBreastShapes : breastType === "natural" ? ["natural"] : ["fake", "augmented"].includes(breastType) ? ["augmented"] : [];
  const weightLb = normalizeWeightLb(candidate);
  const suppliedBodyTypes = cleanList(candidate.bodyTypes || candidate.bodyType);
  const inferredBodyTypes = !suppliedBodyTypes.length && heightCm && heightCm <= 165 && (!weightLb || weightLb <= 125) ? ["petite"] : [];
  const providerIds = { ...(candidate.providerIds || {}), ...(candidate.externalIds || {}) };
  const providerLinks = { ...(candidate.providerLinks || {}), ...(candidate.externalLinks || {}) };
  return {
    id: String(candidate.id || crypto.createHash("sha1").update(`${provider.id || provider.name}:${candidate.name || candidate.title}`).digest("hex").slice(0, 18)),
    name: String(candidate.name || candidate.title || "").trim(),
    title: String(candidate.name || candidate.title || "").trim(),
    aliases,
    profileType: String(candidate.profileType || provider.profileType || "performer").toLowerCase(),
    gender: String(candidate.gender || candidate.sex || "").trim().toLowerCase().replace("female", "female"),
    birthDate,
    age: parseNumber(candidate.age) ?? ageFromBirthDate(birthDate),
    heightCm,
    height: String(candidate.height || "").trim(),
    heightCategory: String(candidate.heightCategory || heightCategory(heightCm)).toLowerCase(),
    weightLb,
    weight: String(candidate.weight || "").trim(),
    measurements: String(candidate.measurements || candidate.measurementsRaw || candidate.bodyMeasurements || "").trim(),
    bust: parseNumber(candidate.bust || candidate.bust_size),
    bodyTypes: suppliedBodyTypes.length ? suppliedBodyTypes : inferredBodyTypes,
    breastShapes,
    braBand: parseNumber(candidate.braBand ?? candidate.bandSize ?? candidate.band_size),
    cupSize: String(candidate.cupSize || candidate.cup_size || "").trim().toUpperCase(),
    pantySize: String(candidate.pantySize || candidate.panty_size || "").trim().toUpperCase(),
    pantySizeInferred: candidate.pantySizeInferred === true,
    breastType,
    waist: parseNumber(candidate.waist || candidate.waist_size),
    hips: parseNumber(candidate.hips || candidate.hip_size),
    hairColor: String(candidate.hairColor || candidate.hair_color || "").trim(),
    eyeColor: String(candidate.eyeColor || candidate.eye_color || "").trim(),
    ethnicity: String(candidate.ethnicity || candidate.race || "").trim(),
    nationality: String(candidate.nationality || "").trim(),
    birthplace: String(candidate.birthplace || "").trim(),
    biography: String(candidate.biography || candidate.bio || "").trim(),
    careerStartYear: parseNumber(candidate.careerStartYear ?? candidate.career_start_year),
    careerEndYear: parseNumber(candidate.careerEndYear ?? candidate.career_end_year),
    tattoos,
    piercings,
    imageUrl: images[0] || "",
    images,
    url: String(candidate.url || candidate.profileUrl || urls[0] || "").trim(),
    sourceUrl: String(candidate.url || candidate.profileUrl || urls[0] || provider.endpoint || "").trim(),
    sourceId: String(provider.id || candidate.sourceId || "structured"),
    sourceName: String(provider.name || candidate.sourceName || "Structured provider"),
    providerIds,
    externalIds: { ...providerIds },
    providerLinks,
    externalLinks: { ...providerLinks },
    sourceCandidates: Array.isArray(candidate.sourceCandidates) ? candidate.sourceCandidates : [],
    bodyMetadataSources: normalizeTextEntries(candidate.bodyMetadataSources || candidate.bodySources).slice(0, 16),
    bodyMetadataEnriched: candidate.bodyMetadataEnriched === true,
    bodyMetadataStatus: String(candidate.bodyMetadataStatus || "").trim(),
  };
}

function ordinalAtOrBelow(value, maximum, order) {
  if (!maximum) return true;
  if (!value) return null;
  const normalized = String(value).toUpperCase().split(/[\/,(]/)[0].replace(/\bUS\b/g, "").replace(/\s+/g, "");
  const valueIndex = order.indexOf(normalized);
  const maximumIndex = order.indexOf(String(maximum).toUpperCase().replace(/\s+/g, ""));
  if (valueIndex < 0 || maximumIndex < 0) return null;
  return valueIndex <= maximumIndex;
}

function evaluateCandidate(candidateInput = {}, preferencesInput = {}) {
  const candidate = normalizeCandidate(candidateInput, { id: candidateInput.sourceId, name: candidateInput.sourceName, profileType: candidateInput.profileType });
  const preferences = normalizePreferences(preferencesInput);
  const checks = [];
  const add = (field, selected, known, passed, summary) => {
    if (!selected) return;
    checks.push({ field, known: Boolean(known), passed: known ? Boolean(passed) : null, summary });
  };
  add("gender", preferences.gender !== "any", candidate.gender, candidate.gender === preferences.gender, candidate.gender || "unknown");
  add("bodyType", preferences.bodyTypes.length, candidate.bodyTypes.length, candidate.bodyTypes.some((value) => preferences.bodyTypes.includes(value)), candidate.bodyTypes.join(", ") || "unknown");
  add("breastShape", preferences.breastShapes.length, candidate.breastShapes.length, candidate.breastShapes.some((value) => preferences.breastShapes.includes(value)), candidate.breastShapes.join(", ") || "unknown");
  add("height", preferences.heightCategories.length, candidate.heightCategory, preferences.heightCategories.includes(candidate.heightCategory), candidate.heightCategory || "unknown");
  add("weight", preferences.maxWeight > 0, candidate.weightLb !== null, candidate.weightLb <= preferences.maxWeight, candidate.weightLb === null ? "unknown" : `${Math.round(candidate.weightLb)} lb`);
  add("pantySize", preferences.pantySizeMax, candidate.pantySize, ordinalAtOrBelow(candidate.pantySize, preferences.pantySizeMax, PANTY_ORDER), candidate.pantySize || "unknown");
  add("braBand", preferences.braBandMax > 0, candidate.braBand !== null, candidate.braBand <= preferences.braBandMax, candidate.braBand === null ? "unknown" : String(candidate.braBand));
  add("cupSize", preferences.cupSizeMax, candidate.cupSize, ordinalAtOrBelow(candidate.cupSize, preferences.cupSizeMax, CUP_ORDER), candidate.cupSize || "unknown");
  add("age", preferences.minAge || preferences.maxAge, candidate.age !== null, candidate.age >= preferences.minAge && candidate.age <= preferences.maxAge, candidate.age === null ? "unknown" : String(candidate.age));
  add("poster", preferences.requirePoster, true, Boolean(candidate.imageUrl), candidate.imageUrl ? "present" : "missing");
  const failedFields = checks.filter((check) => check.known && check.passed === false).map((check) => check.field);
  const missingFields = checks.filter((check) => !check.known).map((check) => check.field);
  const matchedFields = checks.filter((check) => check.passed === true).map((check) => check.field);
  const exact = !failedFields.length && !missingFields.length;
  const compatible = !failedFields.length && matchedFields.length > 0;
  const accepted = preferences.matchMode === "compatible" ? compatible : exact;
  const scoredChecks = checks.filter((check) => check.field !== "poster");
  // Unknown body fields are not evidence of a match. Recommendations may still
  // appear in compatible mode, but their percentage reflects verified values only.
  const earned = scoredChecks.reduce((total, check) => total + (check.passed === true ? 1 : 0), 0);
  const matchScore = Math.round((earned / Math.max(1, scoredChecks.length)) * 100);
  return { candidate, accepted, exact, compatible, matchScore, matchedFields, missingFields, failedFields, checks };
}

function mapStashBoxPerformer(item = {}, provider = {}) {
  return normalizeCandidate({
    ...item,
    profileType: "performer",
    imageUrl: item.images?.[0]?.url || "",
    url: item.urls?.[0]?.url || "",
  }, provider);
}

const STASH_BOX_PERFORMER_QUERY = `
query HomesteadPerformers($input: PerformerQueryInput!) {
  queryPerformers(input: $input) {
    count
    performers {
      id name aliases gender birth_date age height cup_size band_size
      waist_size hip_size breast_type hair_color career_start_year career_end_year
      tattoos { location description }
      piercings { location description }
      images { id url }
      urls { url }
    }
  }
}`;

function stashBoxQueryInput(preferences = {}, page = 1, perPage = 100) {
  const normalized = normalizePreferences(preferences);
  const genderMap = { female: "FEMALE", male: "MALE", nonbinary: "NON_BINARY" };
  const input = { page, per_page: perPage, sort: "POPULARITY", direction: "DESC" };
  if (genderMap[normalized.gender]) input.gender = genderMap[normalized.gender];
  if (normalized.maxAge) input.age = { value: normalized.maxAge + 1, modifier: "LESS_THAN" };
  if (normalized.heightCategories.length && !normalized.heightCategories.includes("tall")) {
    input.height = { value: normalized.heightCategories.includes("medium") ? 171 : 160, modifier: "LESS_THAN" };
  }
  if (normalized.braBandMax) input.band_size = { value: normalized.braBandMax + 1, modifier: "LESS_THAN" };
  if (normalized.breastShapes.length === 1 && normalized.breastShapes[0] === "natural") input.breast_type = { value: "NATURAL", modifier: "EQUALS" };
  if (normalized.breastShapes.length === 1 && normalized.breastShapes[0] === "augmented") input.breast_type = { value: "FAKE", modifier: "EQUALS" };
  return input;
}

async function fetchStashBox(provider = {}, preferences = {}, fetchImpl = fetch) {
  const perPage = Math.min(100, Math.max(25, Number(provider.perPage || 100)));
  const pageCount = Math.min(8, Math.max(1, Number(provider.pages || 3)));
  const results = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const response = await fetchImpl(provider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ApiKey: provider.apiKey },
      body: JSON.stringify({ query: STASH_BOX_PERFORMER_QUERY, variables: { input: stashBoxQueryInput(preferences, page, perPage) } }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || `Provider returned HTTP ${response.status}`);
    const performers = payload.data?.queryPerformers?.performers || [];
    results.push(...performers.map((item) => mapStashBoxPerformer(item, provider)));
    if (performers.length < perPage) break;
  }
  return results;
}

function thePornDbBearerToken(value = "") {
  return String(value || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function thePornDbPerformersUrl(provider = {}, preferences = {}, page = 1, perPage = 100) {
  const endpoint = String(provider.endpoint || "https://api.theporndb.net").trim().replace(/\/+$/, "");
  const url = new URL(/\/performers$/i.test(endpoint) ? endpoint : `${endpoint}/performers`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  // ThePornDB's published schema makes orderBy optional, while the live API can
  // reject documented enum values for an unfiltered connection test. Let the
  // service apply its default order so both tests and searches remain valid.
  // Gender is deliberately filtered by evaluateCandidate after the response.
  // The live REST service currently rejects its documented gender values even
  // though the same records return gender metadata that Homestead can filter.
  return url;
}

function parseThePornDbBraSize(extras = {}) {
  const value = String(extras.cupsize || extras.measurements || "").trim();
  const match = value.match(/(?:^|\s)(\d{2,3})\s*([A-Za-z]{1,3})(?:\b|-)/);
  return match ? { braBand: Number(match[1]), cupSize: match[2].toUpperCase() } : { braBand: null, cupSize: "" };
}

function thePornDbExternalReferences(extras = {}) {
  const providerIds = {};
  const providerLinks = {};
  for (const [label, rawValue] of Object.entries(extras.links || {})) {
    const url = typeof rawValue === "string" ? rawValue : rawValue?.url || "";
    if (!/^https?:\/\//i.test(url)) continue;
    const key = String(label || "link").toLowerCase().replace(/[^a-z0-9]+/g, "");
    providerLinks[key] = url;
    const patterns = [
      ["wikidata", /wikidata\.org\/wiki\/(Q\d+)/i],
      ["iafd", /iafd\.com\/(?:person\.rme\/perfid=|person\.rme\/id=|person\/)([^/?#]+)/i],
      ["adultfilmdatabase", /adultfilmdatabase\.com\/(?:actor|performer)\/([^/?#]+)/i],
    ];
    for (const [providerId, pattern] of patterns) {
      const match = url.match(pattern);
      if (match?.[1] && !providerIds[providerId]) providerIds[providerId] = decodeURIComponent(match[1]);
    }
  }
  return { providerIds, providerLinks };
}

function mapThePornDbPerformer(item = {}, provider = {}) {
  const extras = item.extras || item.extra || {};
  const bra = parseThePornDbBraSize(extras);
  const posterImages = (Array.isArray(item.posters) ? item.posters : []).map((entry) => typeof entry === "string" ? entry : entry?.url).filter(Boolean);
  const images = [item.image, item.thumbnail, item.face, ...posterImages].filter(Boolean);
  const links = Object.values(extras.links || {}).filter((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  const sourceIdentifier = item.slug || item.id || item._id || "";
  const sourceUrl = sourceIdentifier ? `https://theporndb.net/performers/${encodeURIComponent(String(sourceIdentifier))}` : "https://theporndb.net";
  const breastType = extras.fake_boobs === true ? "augmented" : extras.fake_boobs === false ? "natural" : "";
  const references = thePornDbExternalReferences(extras);
  return normalizeCandidate({
    id: item.id || item._id,
    name: item.name || item.full_name,
    aliases: item.aliases,
    profileType: "performer",
    gender: extras.gender,
    birthDate: extras.birthday,
    height: extras.height,
    weight: extras.weight,
    braBand: bra.braBand,
    cupSize: bra.cupSize,
    waist: extras.waist,
    hips: extras.hips,
    breastType,
    hairColor: extras.hair_colour,
    eyeColor: extras.eye_colour,
    ethnicity: extras.ethnicity,
    nationality: extras.nationality,
    birthplace: extras.birthplace,
    biography: item.bio,
    careerStartYear: extras.career_start_year,
    careerEndYear: extras.career_end_year,
    tattoos: extras.tattoos,
    piercings: extras.piercings,
    imageUrl: item.image || posterImages[0] || item.thumbnail || item.face || "",
    images,
    urls: [sourceUrl, ...links],
    url: sourceUrl,
    providerIds: { theporndb: String(item.id || item._id || sourceIdentifier || ""), ...references.providerIds },
    providerLinks: { theporndb: sourceUrl, ...references.providerLinks },
  }, provider);
}

function thePornDbErrorMessage(status, payload = {}) {
  if (status === 401 || status === 403) return "ThePornDB rejected this API token. Create or replace it in your ThePornDB API Tokens page.";
  if (status === 429) return "ThePornDB rate limit reached. Wait a few minutes and try again.";
  const detail = typeof payload?.message === "string" ? payload.message.trim() : "";
  return detail || `ThePornDB returned HTTP ${status}`;
}

async function fetchThePornDb(provider = {}, preferences = {}, fetchImpl = fetch) {
  const token = thePornDbBearerToken(provider.apiKey);
  if (!token) throw new Error("ThePornDB API token is not configured.");
  const perPage = Math.min(100, Math.max(10, Number(provider.perPage || 100)));
  const pageCount = Math.min(8, Math.max(1, Number(provider.pages || 3)));
  const results = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const response = await fetchImpl(thePornDbPerformersUrl(provider, preferences, page, perPage), {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(thePornDbErrorMessage(response.status, payload));
    const performers = Array.isArray(payload?.data) ? payload.data : [];
    results.push(...performers.map((item) => mapThePornDbPerformer(item, provider)));
    const lastPage = Number(payload?.meta?.last || 0);
    if (performers.length < perPage || (lastPage && page >= lastPage)) break;
  }
  return results;
}

async function fetchCustomJson(provider = {}, profileType = "performer", preferences = {}, fetchImpl = fetch) {
  const response = await fetchImpl(provider.endpoint, {
    method: provider.method === "GET" ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
    body: provider.method === "GET" ? undefined : JSON.stringify({ profileType, preferences: normalizePreferences(preferences), limit: Math.min(500, Math.max(25, Number(provider.limit || 250))) }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Provider returned HTTP ${response.status}`);
  const items = Array.isArray(payload) ? payload : payload.items || payload.results || [];
  return items.map((item) => normalizeCandidate(item, provider));
}

function fetchStructuredProvider(provider = {}, profileType = "performer", preferences = {}, fetchImpl = fetch) {
  if (provider.type === "stash-box") return fetchStashBox(provider, preferences, fetchImpl);
  if (provider.type === "theporndb-rest") return fetchThePornDb(provider, preferences, fetchImpl);
  return fetchCustomJson(provider, profileType, preferences, fetchImpl);
}

async function discoverStructuredRecommendations({ providers = [], profileType = "performer", preferences = {}, existingNames = [], fetchImpl = fetch } = {}) {
  const normalizedPreferences = normalizePreferences(preferences);
  const wantedType = /^celeb/i.test(String(profileType)) ? "celebrity" : "performer";
  const existing = new Set(existingNames.map(normalizeName).filter(Boolean));
  const diagnostics = [];
  const collected = [];
  await Promise.all(providers.filter((item) => item.enabled && item.endpoint).map(async (provider) => {
    const providerTypes = cleanList(provider.profileTypes || provider.profileType || (provider.type === "stash-box" ? ["performer"] : ["performer", "celebrity"]));
    if (!providerTypes.includes(wantedType)) return;
    const controller = new AbortController();
    const timeoutMs = Math.max(100, Math.min(10000, Number(provider.timeoutMs || 8000)));
    let timer;
    const timedFetch = (url, options = {}) => fetchImpl(url, { ...options, signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) });
    try {
      if (!provider.apiKey && provider.requiresApiKey !== false) throw new Error("API key is not configured");
      const operation = fetchStructuredProvider(provider, wantedType, normalizedPreferences, timedFetch);
      const items = await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("This source took too long. Successful results from other sources are still included.")); }, timeoutMs); })]);
      diagnostics.push({ providerId: provider.id, providerName: provider.name, ok: true, received: items.length });
      collected.push(...items);
    } catch (error) {
      diagnostics.push({ providerId: provider.id, providerName: provider.name, ok: false, message: /abort|timeout/i.test(error.message || "") ? "This source took too long. Other sources are unaffected." : error.message || "Provider request failed" });
    } finally { clearTimeout(timer); }
  }));
  const seen = new Set();
  const items = collected.map((candidate) => evaluateCandidate(candidate, normalizedPreferences))
    .filter((result) => result.accepted)
    .filter((result) => {
      const identity = normalizeName(result.candidate.name);
      const aliases = result.candidate.aliases.map(normalizeName);
      if (!identity || existing.has(identity) || aliases.some((alias) => existing.has(alias))) return false;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.matchedFields.length - a.matchedFields.length || a.candidate.name.localeCompare(b.candidate.name))
    .slice(0, 24)
    .map((result) => ({
      ...result.candidate,
      exactMatch: result.exact,
      matchScore: result.matchScore,
      matchedFields: result.matchedFields,
      missingFields: result.missingFields,
      reason: result.exact ? "Matches every selected preference" : `Compatible on ${result.matchedFields.length} field${result.matchedFields.length === 1 ? "" : "s"}; missing ${result.missingFields.join(", ")}`,
    }));
  return { ok: true, profileType: wantedType, preferences: normalizedPreferences, items, diagnostics };
}

module.exports = {
  DEFAULT_PREFERENCES,
  STASH_BOX_PERFORMER_QUERY,
  stashBoxQueryInput,
  normalizePreferences,
  normalizeCandidate,
  evaluateCandidate,
  discoverStructuredRecommendations,
  fetchStructuredProvider,
  fetchThePornDb,
  mapThePornDbPerformer,
  parseThePornDbBraSize,
  thePornDbExternalReferences,
  thePornDbBearerToken,
  thePornDbPerformersUrl,
  heightCategory,
  ageFromBirthDate,
};
