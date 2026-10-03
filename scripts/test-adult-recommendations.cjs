const assert = require("assert");
const {
  normalizeCandidate,
  evaluateCandidate,
  discoverStructuredRecommendations,
  heightCategory,
  stashBoxQueryInput,
  STASH_BOX_PERFORMER_QUERY,
} = require("../src/server/adult-recommendations.cjs");

const preferences = {
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
};

const exact = normalizeCandidate({
  id: "candidate-1", name: "Exact Example", gender: "female", birthDate: "2000-01-01",
  bodyTypes: ["petite"], breastShapes: ["perky"], heightCm: 160, weightLb: 118,
  pantySize: "M", braBand: 34, cupSize: "B", imageUrl: "https://example.test/poster.jpg",
}, { id: "test", name: "Test Directory", profileType: "performer" });

assert.equal(heightCategory(160), "short");
assert(!STASH_BOX_PERFORMER_QUERY.includes("height_cm"));
assert.equal(stashBoxQueryInput(preferences).gender, "FEMALE");
assert.deepEqual(stashBoxQueryInput(preferences).age, { value: 36, modifier: "LESS_THAN" });
assert.deepEqual(stashBoxQueryInput(preferences).band_size, { value: 37, modifier: "LESS_THAN" });
assert.equal(evaluateCandidate(exact, preferences).accepted, true, "a complete exact match must pass");
assert.deepEqual(evaluateCandidate({ ...exact, weightLb: 140 }, preferences).failedFields, ["weight"]);
assert.equal(evaluateCandidate({ ...exact, weightLb: null }, preferences).accepted, false, "strict mode must reject missing selected fields");
assert.equal(evaluateCandidate({ ...exact, weightLb: null }, { ...preferences, matchMode: "compatible" }).accepted, true, "compatible mode may label missing fields");
assert.equal(evaluateCandidate({ ...exact, imageUrl: "", images: [] }, { ...preferences, matchMode: "compatible" }).accepted, false, "a required poster is a hard filter");
assert.deepEqual(normalizeCandidate({ name: "Natural Example", breast_type: "NATURAL" }).breastShapes, ["natural"]);

async function run() {
  const response = await discoverStructuredRecommendations({
    providers: [{ id: "custom", name: "Custom", type: "json", endpoint: "https://example.test/api", enabled: true, requiresApiKey: false, profileTypes: ["performer"] }],
    profileType: "performer",
    preferences,
    existingNames: ["Already Stored"],
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ items: [exact, { ...exact, id: "candidate-2", name: "Already Stored" }] }) }),
  });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].name, "Exact Example");
  assert.equal(response.items[0].exactMatch, true);
  assert.equal(response.diagnostics[0].ok, true);
  console.log("Adult structured recommendation tests: PASSED");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
