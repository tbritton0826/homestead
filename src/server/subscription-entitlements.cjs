const crypto = require("crypto");

const TIER_ORDER = Object.freeze(["free", "family", "plus", "pro"]);

const TIER_DEFINITIONS = Object.freeze({
  free: {
    name: "Homestead Free",
    features: ["coreMedia", "photos", "adult"],
    limits: { users: 1, concurrentStreams: 1 },
  },
  family: {
    name: "Homestead Family",
    features: ["coreMedia", "multiUser", "librarySharing", "photos", "familyLibrary", "households", "familyProfiles", "familyTree", "calendar", "recipes", "pets", "adult"],
    limits: { users: null, concurrentStreams: null },
  },
  plus: {
    name: "Homestead Plus",
    features: ["coreMedia", "multiUser", "librarySharing", "photos", "familyLibrary", "households", "familyProfiles", "familyTree", "calendar", "recipes", "pets", "inventory", "cloud", "appearance", "adult"],
    limits: { users: null, concurrentStreams: null },
  },
  pro: {
    name: "Homestead Pro",
    features: ["coreMedia", "multiUser", "librarySharing", "photos", "familyLibrary", "households", "familyProfiles", "familyTree", "calendar", "recipes", "pets", "inventory", "cloud", "appearance", "liveTV", "adult", "ai", "externalIntegrations", "automation", "plugins"],
    limits: { users: null, concurrentStreams: null },
  },
});

const LIBRARY_FEATURES = Object.freeze({
  photos: "photos",
  family: "familyLibrary",
  "family-home": "familyLibrary",
  familyarchive: "familyLibrary",
  "family-profiles": "familyProfiles",
  familyprofiles: "familyProfiles",
  "family-tree": "familyTree",
  familytree: "familyTree",
  households: "households",
  calendar: "calendar",
  recipes: "recipes",
  pets: "pets",
  inventory: "inventory",
  electronics: "inventory",
  tools: "inventory",
  collectibles: "inventory",
  tcg: "inventory",
  outdoor: "inventory",
  filecabinet: "inventory",
  "file-cabinet": "inventory",
  cloud: "cloud",
  appearance: "appearance",
  livetv: "liveTV",
  adult: "adult",
  girls: "adult",
  personal: "adult",
  performers: "adult",
  celebrities: "adult",
  adultphotos: "adult",
  adultvideos: "adult",
  adulttv: "adult",
  ai: "ai",
  plugins: "plugins",
  automation: "automation",
});

const normalizeTier = (value) => TIER_ORDER.includes(String(value || "").trim().toLowerCase())
  ? String(value).trim().toLowerCase()
  : "free";

const decodeBase64Url = (value) => Buffer.from(String(value || ""), "base64url");

function verifyLicenseToken(token, publicKey, nowMs = Date.now()) {
  try {
    const parts = String(token || "").trim().split(".");
    if (parts.length !== 2 || parts.some(part => !/^[\w-]+$/.test(part))) return null;
    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart || !publicKey) return null;
    const verified = crypto.verify(null, Buffer.from(payloadPart), publicKey, decodeBase64Url(signaturePart));
    if (!verified) return null;
    const payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8"));
    const tier = normalizeTier(payload.tier);
    if (tier !== payload.tier) return null;
    if (payload.notBefore !== undefined && (!Number.isFinite(payload.notBefore) || payload.notBefore * 1000 > nowMs)) return null;
    if (payload.expiresAt !== undefined && (!Number.isFinite(payload.expiresAt) || payload.expiresAt * 1000 <= nowMs)) return null;
    return { ...payload, tier };
  } catch {
    return null;
  }
}

function createSubscriptionService({ env = process.env, now = () => Date.now(), linkedLicense = () => null } = {}) {
  const developmentPreview = String(env.NODE_ENV || "development").toLowerCase() !== "production";
  const developmentTier = developmentPreview ? normalizeTier(env.HOMESTEAD_SUBSCRIPTION_TIER || "pro") : "free";
  let cached, cacheKey, cacheUntil=0;
  function resolve() {
    const nowMs=now();
    const linked = linkedLicense();
    const key = [linked?.token, linked?.publicKey, env.HOMESTEAD_LICENSE_TOKEN, env.HOMESTEAD_LICENSE_PUBLIC_KEY].join('|');
    if (key === cacheKey && nowMs<cacheUntil) return cached;
    const verifiedLinked = linked?.token ? verifyLicenseToken(linked.token, linked.publicKey, nowMs) : null;
    const manualLicense = verifyLicenseToken(env.HOMESTEAD_LICENSE_TOKEN, env.HOMESTEAD_LICENSE_PUBLIC_KEY, nowMs);
    // Bound grants must pass the local installation check; they are not portable manual keys.
    const verifiedLicense = verifiedLinked || (manualLicense?.audience ? null : manualLicense);
    const tier = verifiedLicense?.tier || developmentTier;
    const definition = TIER_DEFINITIONS[tier];
    cacheKey = key;
    cacheUntil=Math.min(Math.floor(nowMs/1000+1)*1000,verifiedLicense?.expiresAt*1000 || Infinity);
    return cached = {verifiedLicense,tier,definition,
      source:verifiedLinked?'linked-account':verifiedLicense?'signed-license':developmentPreview?'development-preview':'free-default',
      features:Object.fromEntries(TIER_DEFINITIONS.pro.features.map(feature => [feature, definition.features.includes(feature)]))};
  }
  const activeStreams = new Map();

  const status = () => {
    const {tier,definition,source,features,verifiedLicense} = resolve();
    return ({
    tier,
    name: definition.name,
    source,
    developmentPreview,
    features: { ...features },
    limits: { ...definition.limits },
    libraryAccess: Object.fromEntries(["movies", "tvshows", "music", "books", "youtube", ...Object.keys(LIBRARY_FEATURES)].map((libraryId) => [libraryId, allowsLibrary(libraryId)])),
    customerId: verifiedLicense?.customerId || null,
    subscriptionId: verifiedLicense?.subscriptionId || null,
    expiresAt: verifiedLicense?.expiresAt ? new Date(Number(verifiedLicense.expiresAt) * 1000).toISOString() : null,
    });
  };

  const has = (feature) => resolve().features[String(feature || "")] === true;
  const allowsLibrary = (libraryId) => {
    const feature = LIBRARY_FEATURES[String(libraryId || "").trim().toLowerCase()];
    return !feature || has(feature);
  };
  const requireFeature = (feature) => (req, res, next) => {
    if (has(feature)) return next();
    return res.status(402).json({
      ok: false,
      code: "SUBSCRIPTION_REQUIRED",
      feature,
      currentTier: resolve().tier,
      message: `${TIER_DEFINITIONS[TIER_ORDER[Math.min(TIER_ORDER.length - 1, TIER_ORDER.findIndex((candidate) => TIER_DEFINITIONS[candidate].features.includes(feature)))]]?.name || "A paid Homestead plan"} is required for this feature.`,
    });
  };

  const claimStream = ({ clientId, mediaKey }) => {
    const limit = resolve().definition.limits.concurrentStreams;
    if (!Number.isFinite(limit)) return { allowed: true };
    const cutoff = now() - 120000;
    for (const [key, stream] of activeStreams.entries()) if (stream.lastSeen < cutoff) activeStreams.delete(key);
    const existing = activeStreams.get(clientId);
    if (existing || activeStreams.size < limit) {
      activeStreams.set(clientId, { mediaKey, lastSeen: now() });
      return { allowed: true };
    }
    return { allowed: false, code: "STREAM_LIMIT_REACHED", limit };
  };

  const releaseStream = (clientId) => activeStreams.delete(String(clientId || ""));

  return { status, has, allowsLibrary, requireFeature, claimStream, releaseStream };
}

module.exports = { TIER_DEFINITIONS, LIBRARY_FEATURES, normalizeTier, verifyLicenseToken, createSubscriptionService };
