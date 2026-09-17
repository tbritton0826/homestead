const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  normalizeCandidate,
  thePornDbExternalReferences,
} = require("../src/server/adult-recommendations.cjs");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "src", "components", "adult", "AddAdultProfileModal.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

for (const expected of [
  "function AdultPhotoSearchLauncher",
  "function openAdultProfileCandidate",
  "onOpenCandidate={openAdultProfileCandidate}",
  'className="media-person-overlay"',
  'searchMode !== "browse"',
  "initialPhotoResults={selectedAdvancedAdultSearch.photoResults || []}",
]) assert(app.includes(expected), `missing unified overlay behavior: ${expected}`);

assert(!app.includes("if (selectedAdultPersonMatch)"), "legacy full-page match/create route must not remain active");

for (const expected of [
  "initialCandidate = null",
  "candidateMediaEntries",
  "Open Existing Profile",
  "trailerId",
  "Import this item",
  "Combined",
]) assert(modal.includes(expected), `missing prefilled Add Profile behavior: ${expected}`);

for (const expected of [
  'trailer: ""',
  '["scene", "video", "trailer"]',
  "mergeAdultRecommendationCandidates",
  "adultRecommendationIdentityTokens",
]) assert(server.includes(expected), `missing server support: ${expected}`);

const references = thePornDbExternalReferences({ links: {
  wikidata: "https://www.wikidata.org/wiki/Q1234",
  iafd: "https://www.iafd.com/person.rme/perfid=sample-id",
  afdb: "https://www.adultfilmdatabase.com/actor/sample-actor",
} });
assert.equal(references.providerIds.wikidata, "Q1234");
assert.equal(references.providerIds.iafd, "sample-id");
assert.equal(references.providerIds.adultfilmdatabase, "sample-actor");

const normalized = normalizeCandidate({ name: "Example", providerIds: references.providerIds, providerLinks: references.providerLinks }, { id: "test", name: "Test" });
assert.equal(normalized.externalIds.wikidata, "Q1234");
assert.equal(normalized.providerIds.iafd, "sample-id");

console.log("Unified person overlays and prefilled profile creation regression checks: PASSED");
