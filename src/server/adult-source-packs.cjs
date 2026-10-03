const SOURCE_PACKS = Object.freeze([
  {
    id: "public-people",
    name: "Public People Sources",
    category: "identity",
    providers: ["wikidata", "wikipedia", "tmdb", "imdb", "models-com"],
  },
  {
    id: "adult-performer-metadata",
    name: "Adult Performer Metadata",
    category: "metadata",
    providers: ["iafd", "xxxbios", "babewiki", "definebabe", "freeones", "thenude", "thelordofporn", "stashdb", "theporndb"],
  },
  {
    id: "adult-content-sources",
    name: "Adult Content Sources",
    category: "content",
    providers: ["pornhub", "tiny4k", "exxxtrasmall", "eporner", "youporn", "redtube", "tube8", "xhamster", "brazzers", "teamskeet", "iknowthatgirl", "justteensporn"],
  },
]);

const BUILTIN_PROVIDER_DESCRIPTORS = Object.freeze({
  modelscom: { id: "models-com", name: "Models.com", role: "both", profileTypes: ["performer", "celebrity"], capabilities: ["identity", "biography", "measurements", "agencies", "clients", "work", "socialLinks"], conditional: true, fillMissingOnly: true },
  tiny4k: {
    id: "tiny4k",
    name: "Tiny4K",
    role: "performer",
    profileTypes: ["performer"],
    capabilities: ["identity", "photos", "videos", "scenes", "studios", "externalLinks"],
  },
  exxxtrasmall: {
    id: "exxxtrasmall",
    name: "ExxxtraSmall",
    role: "performer",
    profileTypes: ["performer"],
    capabilities: ["identity", "photos", "videos", "scenes", "studios", "externalLinks"],
  },
  pornhub: {
    id: "pornhub",
    name: "Pornhub",
    role: "performer",
    profileTypes: ["performer"],
    capabilities: ["identity", "photos", "videos", "scenes", "providerStats", "externalLinks"],
  },
});

function providerKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeName(value = "") {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function profileLane(candidate = {}) {
  const raw = String(candidate.profileType || candidate.libraryType || candidate.resultGroup || "performer").toLowerCase();
  if (raw.includes("celebr")) return "celebrity";
  if (raw.includes("personal")) return "personal";
  return "performer";
}

function packForProvider(id = "") {
  const normalized = providerKey(id);
  return SOURCE_PACKS.find((pack) => pack.providers.some((provider) => providerKey(provider) === normalized)) || null;
}

function buildSourceRegistry(configuredSources = [], structuredProviders = []) {
  const descriptors = new Map();
  const add = (source = {}, fallback = {}) => {
    const id = providerKey(source.id || source.providerIdKey || source.name || fallback.id);
    if (!id) return;
    const builtin = BUILTIN_PROVIDER_DESCRIPTORS[id] || {};
    const pack = packForProvider(id);
    const supports = source.supports || source.capabilities || builtin.capabilities || [];
    descriptors.set(id, {
      ...builtin,
      ...fallback,
      ...source,
      id,
      name: source.name || builtin.name || fallback.name || id,
      packId: pack?.id || "custom-sources",
      packName: pack?.name || "Custom Sources",
      profileTypes: source.profileTypes || builtin.profileTypes || (source.role === "both" ? ["performer", "celebrity"] : [source.role || "performer"]),
      capabilities: [...new Set((Array.isArray(supports) ? supports : [supports]).map((value) => String(value || "").trim()).filter(Boolean))],
      enabled: source.enabled !== false,
      health: source.enabled === false ? "disabled" : "ready",
    });
  };

  configuredSources.forEach((source) => add(source));
  structuredProviders.forEach((source) => add(source, { capabilities: ["identity", "metadata", "measurements", "artwork"] }));
  Object.values(BUILTIN_PROVIDER_DESCRIPTORS).forEach((source) => {
    if (!descriptors.has(providerKey(source.id))) add(source, { enabled: true });
  });

  return Array.from(descriptors.values()).sort((a, b) => a.packName.localeCompare(b.packName) || a.name.localeCompare(b.name));
}

function sourceForCandidate(candidate = {}, registry = []) {
  const raw = candidate.provider || candidate.sourceId || candidate.source || candidate.sourceLabel || "external";
  const id = providerKey(raw);
  const registered = registry.find((source) => source.id === id || providerKey(source.name) === id);
  const pack = packForProvider(id);
  const capabilities = candidate.capabilities || candidate.supports || registered?.capabilities || [];
  return {
    id: registered?.id || id || "external",
    name: candidate.sourceLabel || candidate.sourceName || registered?.name || candidate.source || candidate.provider || "External source",
    packId: registered?.packId || pack?.id || "custom-sources",
    packName: registered?.packName || pack?.name || "Custom Sources",
    url: candidate.externalUrl || candidate.sourceUrl || candidate.url || "",
    providerId: candidate.sourceCandidateId || candidate.providerId || candidate.id || "",
    confidence: Number(candidate.confidence || 0),
    capabilities: [...new Set((Array.isArray(capabilities) ? capabilities : [capabilities]).filter(Boolean))],
    status: "complete",
  };
}

function aggregatePersonCandidates(query = "", candidates = [], registry = []) {
  const groups = new Map();
  for (const candidate of candidates || []) {
    const name = String(candidate.name || candidate.title || query || "").trim();
    if (!name) continue;
    const lane = profileLane(candidate);
    const key = `${lane}:${normalizeName(name)}`;
    const current = groups.get(key) || { lane, name, candidates: [], sources: [] };
    current.candidates.push(candidate);
    const source = sourceForCandidate(candidate, registry);
    if (!current.sources.some((item) => item.id === source.id && item.providerId === source.providerId)) current.sources.push(source);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const sorted = group.candidates.slice().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(a.sourcePriority ?? 99) - Number(b.sourcePriority ?? 99));
    const best = sorted[0] || {};
    const capabilities = [...new Set(group.sources.flatMap((source) => source.capabilities || []))];
    const sourceNames = [...new Set(group.sources.map((source) => source.name).filter(Boolean))];
    const typeLabel = group.lane === "celebrity" ? "Celebrity" : group.lane === "personal" ? "Personal" : "Performer";
    return {
      ...best,
      id: `person-${group.lane}-${normalizeName(group.name).replace(/\s+/g, "-")}`,
      name: group.name,
      title: group.name,
      profileType: group.lane,
      libraryType: group.lane === "celebrity" ? "celebrities" : group.lane === "personal" ? "personal" : "performers",
      resultGroup: group.lane,
      sourceCount: group.sources.length,
      sourceNames,
      sources: group.sources,
      sourceCandidates: sorted,
      capabilities,
      subtitle: `${typeLabel} · ${group.sources.length} source${group.sources.length === 1 ? "" : "s"}`,
      aggregatedIdentity: true,
      confidence: Math.max(...sorted.map((candidate) => Number(candidate.confidence || 0)), 0),
    };
  }).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || Number(b.sourceCount || 0) - Number(a.sourceCount || 0) || a.name.localeCompare(b.name));
}

module.exports = {
  SOURCE_PACKS,
  BUILTIN_PROVIDER_DESCRIPTORS,
  providerKey,
  buildSourceRegistry,
  sourceForCandidate,
  aggregatePersonCandidates,
};
