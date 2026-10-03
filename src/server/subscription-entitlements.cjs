const crypto = require("crypto");

const TIER_ORDER = Object.freeze(["free", "family", "plus", "pro"]);

const TIER_DEFINITIONS = Object.freeze({
  free: {
    name: "Homestead Free",
    features: ["coreMedia"],
    limits: { users: 1, concurrentStreams: 1 },
  },
  family: {
    name: "Homestead Family",
    features: ["coreMedia", "multiUser", "librarySharing", "photos", "familyLibrary", "households", "familyProfiles", "familyTree", "calendar", "recipes", "pets"],
    limits: { users: null, concurrentStreams: null },
  },
  plus: {
    name: "Homestead Plus",
    features: ["coreMedia", "multiUser", "librarySharing", "photos", "familyLibrary", "households", "familyProfiles", "familyTree", "calendar", "recipes", "pets", "inventory", "cloud", "appearance"],
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
    const [payloadPart, signaturePart] = String(token || "").trim().split(".");
    if (!payloadPart || !signaturePart || !publicKey) return null;
    const verified = crypto.verify(null, Buffer.from(payloadPart), publicKey, decodeBase64Url(signaturePart));
    if (!verified) return null;
    const payload = JSON.parse(decodeBase64Url(payloadPart).toString("utf8"));
    const tier = normalizeTier(payload.tier);
    if (tier !== payload.tier) return null;
    if (payload.notBefore && Number(payload.notBefore) * 1000 > nowMs) return null;
    if (payload.expiresAt && Number(payload.expiresAt) * 1000 <= nowMs) return null;
    return { ...payload, tier };
  } catch {
    return null;
  }
}

function createSubscriptionService({ env = process.env, now = () => Date.now() } = {}) {
  const developmentPreview = String(env.NODE_ENV || "development").toLowerCase() !== "production";
  const verifiedLicense = verifyLicenseToken(env.HOMESTEAD_LICENSE_TOKEN, env.HOMESTEAD_LICENSE_PUBLIC_KEY, now());
  const developmentTier = developmentPreview ? normalizeTier(env.HOMESTEAD_SUBSCRIPTION_TIER || "pro") : "free";
  const tier = verifiedLicense?.tier || developmentTier;
  const source = verifiedLicense ? "signed-license" : developmentPreview ? "development-preview" : "free-default";
  const definition = TIER_DEFINITIONS[tier];
  const features = Object.freeze(Object.fromEntries(TIER_DEFINITIONS.pro.features.map((feature) => [feature, definition.features.includes(feature)])));
  const activeStreams = new Map();

  const status = () => ({
    tier,
    name: definition.name,
    source,
    developmentPreview,
    features: { ...features },
    limits: { ...definition.limits },
    customerId: verifiedLicense?.customerId || null,
    subscriptionId: verifiedLicense?.subscriptionId || null,
    expiresAt: verifiedLicense?.expiresAt ? new Date(Number(verifiedLicense.expiresAt) * 1000).toISOString() : null,
  });

  const has = (feature) => features[String(feature || "")] === true;
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
      currentTier: tier,
      message: `${TIER_DEFINITIONS[TIER_ORDER[Math.min(TIER_ORDER.length - 1, TIER_ORDER.findIndex((candidate) => TIER_DEFINITIONS[candidate].features.includes(feature)))]]?.name || "A paid Homestead plan"} is required for this feature.`,
    });
  };

  const claimStream = ({ clientId, mediaKey }) => {
    const limit = definition.limits.concurrentStreams;
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
