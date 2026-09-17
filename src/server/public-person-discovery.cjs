const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizePreferences, normalizeCandidate, evaluateCandidate } = require("./adult-recommendations.cjs");
const nameKey = (value) => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const lane = (value) => /^celeb/i.test(String(value)) ? "celebrity" : "performer";
const firstClaim = (entity, property) => (entity.claims?.[property] || []).filter((claim) => claim.rank !== "deprecated").sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"))[0]?.mainsnak?.datavalue?.value;
function quantity(value, kind) {
  if (!value || !Number.isFinite(Number(value.amount))) return null;
  const unit = String(value.unit || "").split("/").pop();
  const factors = kind === "length"
    ? { Q174728: 1, Q11573: 100, Q174789: 0.1, Q218593: 2.54, Q3710: 30.48 }
    : { Q11570: 1, Q100995: 0.45359237, Q41803: 0.001 };
  const factor = factors[unit];
  return Number.isFinite(factor) ? Number(value.amount) * factor : null;
}
function entityCandidate(entity, profileType) {
  const birth = firstClaim(entity, "P569");
  // Wikidata precision 11 is a known day. Never invent a day for an age check.
  const birthDate = birth?.precision >= 11 ? String(birth.time || "").replace(/^\+/, "").slice(0, 10) : "";
  const image = firstClaim(entity, "P18");
  const genderId = firstClaim(entity, "P21")?.id;
  const heightCm = quantity(firstClaim(entity, "P2048"), "length");
  const weightKg = quantity(firstClaim(entity, "P2067"), "mass");
  const providerIds = Object.fromEntries([
    ["wikidata", entity.id],
    ["iafdUuid", firstClaim(entity, "P12776")],
    ["iafdFemale", firstClaim(entity, "P3869")],
    ["iafdMale", firstClaim(entity, "P4505")],
    ["adultFilmDatabase", firstClaim(entity, "P3351")],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim()));
  return normalizeCandidate({
    id: entity.id, name: entity.labels?.en?.value || "", aliases: (entity.aliases?.en || []).map((entry) => entry.value), profileType,
    gender: genderId === "Q6581072" ? "female" : genderId === "Q6581097" ? "male" : "",
    birthDate, heightCm, weight: weightKg ? `${weightKg} kg` : "",
    imageUrl: image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}?width=320` : "",
    url: `https://www.wikidata.org/wiki/${entity.id}`,
    providerIds,
    providerLinks: { wikidata: `https://www.wikidata.org/wiki/${entity.id}` },
  }, { id: "wikidata-discovery", name: "Wikidata discovery", profileType });
}
function buildQuery(occupation, preferences, now = new Date()) {
  const earliest = now.getUTCFullYear() - preferences.maxAge - 1;
  const latest = now.getUTCFullYear() - preferences.minAge + 1;
  const gender = { female: "Q6581072", male: "Q6581097" }[preferences.gender];
  // Small occupation-specific queries, indexed date ranges, no global sort,
  // optional measurement joins, YEAR() scan, or label-service cross product.
  return `SELECT DISTINCT ?person WHERE {
    ?person wdt:P106 wd:${occupation}; wdt:P569 ?birthDate; wdt:P31 wd:Q5.
    FILTER(?birthDate >= "${earliest}-01-01T00:00:00Z"^^xsd:dateTime && ?birthDate < "${latest}-01-01T00:00:00Z"^^xsd:dateTime)
    ${gender ? `?person wdt:P21 wd:${gender}.` : ""}
    ${preferences.requirePoster ? "?person wdt:P18 ?image." : ""}
  } LIMIT 64`;
}
function createPublicPersonDiscovery({ fetchImpl = fetch, cacheDir = "", timeoutMs = 6500, now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  const cachePath = (key) => cacheDir && path.join(cacheDir, `${crypto.createHash("sha256").update(key).digest("hex")}.json`);
  function readCache(key) {
    if (cache.has(key)) return cache.get(key);
    try { const value = JSON.parse(fs.readFileSync(cachePath(key), "utf8")); if (Array.isArray(value.items)) { cache.set(key, value); return value; } } catch {}
    return null;
  }
  function saveCache(key, value) {
    cache.set(key, value);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    if (!cacheDir) return;
    try { fs.mkdirSync(cacheDir, { recursive: true }); const target = cachePath(key), temporary = `${target}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, target); } catch { /* Cache failure never breaks discovery. */ }
  }
  async function fetchJson(url) {
    const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "Homestead/0.6.8 (public person discovery)" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.error) throw new Error("Public data service returned an error");
    return result;
  }
  async function refresh(key, type, preferences) {
    const occupations = type === "performer" ? ["Q488111"] : ["Q33999", "Q10800557", "Q4610556"];
    const settled = await Promise.allSettled(occupations.map(async (occupation) => {
      const result = await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(buildQuery(occupation, preferences, new Date(now())))}`);
      return (result.results?.bindings || []).map((row) => String(row.person?.value || "").split("/").pop()).filter((id) => /^Q\d+$/.test(id));
    }));
    const ids = [...new Set(settled.flatMap((result) => result.status === "fulfilled" ? result.value : []))].slice(0, 150);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const entities = await Promise.allSettled(chunks.map((chunk) => fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join("|")}&props=labels|aliases|claims&languages=en&format=json`)));
    const items = entities.flatMap((result) => result.status === "fulfilled" ? Object.values(result.value.entities || {}).map((entity) => entityCandidate(entity, type)) : []).filter((candidate) => candidate.name && Number.isFinite(candidate.age) && candidate.age >= 18);
    const failed = settled.filter((result) => result.status === "rejected").length + entities.filter((result) => result.status === "rejected").length;
    const previous = readCache(key);
    if (items.length || !failed) {
      const merged = failed && previous ? [...new Map([...previous.items, ...items].map((item) => [item.id, item])).values()] : items;
      const value = { items: merged, cachedAt: now(), partial: failed > 0 };
      saveCache(key, value); return value;
    }
    if (previous && now() - previous.cachedAt < 7 * 86400000) return { ...previous, stale: true, partial: true };
    return { items: [], cachedAt: now(), unavailable: true };
  }
  return async function discover({ profileType = "performer", preferences = {}, existingNames = [] } = {}) {
    const type = lane(profileType);
    // Retain the built-in source's compatible mode: public sources do not have
    // every sizing field. Missing fields remain explicitly visible on each card.
    const normalized = normalizePreferences({ ...preferences, matchMode: "compatible" });
    const key = JSON.stringify([type, normalized.gender, normalized.minAge, normalized.maxAge, normalized.requirePoster, new Date(now()).getUTCFullYear()]);
    let value = readCache(key);
    if (!value || now() - value.cachedAt > (value.partial ? 5 * 60000 : 12 * 3600000)) {
      if (!pending.has(key)) pending.set(key, refresh(key, type, normalized).finally(() => pending.delete(key)));
      value = await pending.get(key);
    }
    const existing = new Set((Array.isArray(existingNames) ? existingNames : []).map(nameKey));
    const items = value.items.filter((candidate) => !existing.has(nameKey(candidate.name)) && !candidate.aliases.some((alias) => existing.has(nameKey(alias))))
      .map((candidate) => evaluateCandidate(candidate, normalized)).filter((result) => result.compatible && result.candidate.age >= 18)
      .sort((a, b) => b.matchScore - a.matchScore || b.matchedFields.length - a.matchedFields.length).slice(0, 18)
      .map((result) => ({ ...result.candidate, matchScore: result.matchScore, matchedFields: result.matchedFields, missingFields: result.missingFields, reason: `Compatible on ${result.matchedFields.length} supplied fields`, stale: Boolean(value.stale) }));
    return { ok: true, profileType: type, preferences: normalized, items, diagnostics: [{ providerId: "wikidata-discovery", providerName: "Built-in public discovery", ok: !value.unavailable, received: value.items.length, stale: Boolean(value.stale), partial: Boolean(value.partial), message: value.unavailable ? "Public discovery is temporarily unavailable. Other providers are unaffected; try again shortly." : value.stale ? "Showing cached profiles while the public source is unavailable." : value.partial ? "Some public lookups were slow; successful profiles are included." : "" }] };
  };
}
module.exports = { createPublicPersonDiscovery, buildQuery, entityCandidate, quantity };
