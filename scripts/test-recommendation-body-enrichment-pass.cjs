const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const { normalizeCandidate, evaluateCandidate } = require(path.join(root, "src", "server", "adult-recommendations.cjs"));

const normalized = normalizeCandidate({
  id: "sample",
  name: "Sample Performer",
  profileType: "performer",
  gender: "female",
  age: 25,
  height: "5 ft 2 in",
  weight: "105 lb",
  measurements: "32-23-33",
  braBand: 32,
  cupSize: "B",
  pantySize: "XS",
  pantySizeInferred: true,
  bodyType: "petite",
  breastType: "natural",
  imageUrl: "https://example.test/poster.jpg",
  bodyMetadataSources: ["TheNude", "IAFD"],
  bodyMetadataEnriched: true,
  bodyMetadataStatus: "available",
}, { id: "test", name: "Test provider", profileType: "performer" });

assert.equal(normalized.measurements, "32-23-33");
assert.equal(normalized.braBand, 32);
assert.equal(normalized.cupSize, "B");
assert.equal(normalized.pantySize, "XS");
assert.equal(normalized.pantySizeInferred, true);
assert.deepEqual(normalized.bodyMetadataSources, ["TheNude", "IAFD"]);
assert.equal(normalized.bodyMetadataStatus, "available");

const unknownBodyScore = evaluateCandidate({
  name: "Identity Only",
  profileType: "performer",
  gender: "female",
  age: 25,
  bodyTypes: ["petite"],
  imageUrl: "https://example.test/poster.jpg",
}, {
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
  matchMode: "compatible",
});
assert.equal(unknownBodyScore.matchScore, 33, "unknown body fields must not inflate the match percentage");

assert(server.includes('/api/discovery/adult/recommendations/enrich-bodies'));
assert(server.includes("enrichAdultRecommendationBodyCandidate"));
assert(server.includes("searchTheNudeMetadata(name)"));
assert(server.includes("fetchLinkedAdultMetadataCandidates(name, [linkedAnchor])"));
assert(app.includes("adultRecommendationBodyFacts"));
assert(app.includes("Loading body metadata…"));
assert(app.includes("Body metadata unavailable from enabled sources"));
assert(css.includes(".adult-recommendation-body.available"));

console.log("Recommendation body enrichment, display, and honest scoring checks passed.");
