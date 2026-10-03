const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scanner = require(path.join(root, "scripts", "scanners", "scan-media.cjs"));
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

assert.equal(scanner.normalizeLibraryItemKey("tv", "Charmed (1998)"), "charmed-1998");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Charmed (2018)"), "charmed-2018");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Avatar - The Last Airbender (2005)"), "avatar-the-last-airbender-2005");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Avatar - The Last Airbender (2024)"), "avatar-the-last-airbender-2024");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Being Human UK (2009)"), "being-human-uk-2009");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Being Human US (2011)"), "being-human-us-2011");
assert.equal(scanner.normalizeLibraryItemKey("tv", "Charmed 2018"), "charmed-2018");
assert.notEqual(scanner.normalizeLibraryItemKey("tv", "Charmed (1998)"), scanner.normalizeLibraryItemKey("tv", "Charmed (2018)"));
assert.equal(scanner.stripLibraryIdentityYear("Charmed (2018)"), "Charmed");

assert.match(server, /function migrateLegacyTvMetadataMatches/, "legacy title aliases must be split by exact title and year");
assert.match(server, /expectedIds\.includes\(String\(match\.localId/, "server lookup must verify exact local TV identity");
assert.match(server, /return candidateYear === identity\.year/, "automatic TV matching must require the folder year");
assert.match(server, /TV_IDENTITY_V2_MIGRATION_MARKER/, "the repair must run once after upgrade");
assert.match(server, /setTimeout\(runTvIdentityV2StartupRepair, 5000\)/, "startup must schedule the identity repair");
assert.doesNotMatch(
  server.slice(server.indexOf("function buildStableTvMatchAliases"), server.indexOf("function writeMetadataMatches")),
  /tmdb:/,
  "provider IDs must not be used as local TV aliases"
);

assert.match(app, /function getTvLibraryDisplayTitle/, "TV cards need a year-free display-title helper");
assert.match(app, /expectedIds\.includes\(String\(match\.localId/, "browser lookup must verify exact local TV identity");
assert.match(app, /libraryType === "tv"\s*\? getTvStableMetadataMatchKeys\(itemOrLocalId\)/, "TV unmatch must not delete sibling title aliases");
assert.match(app, /key=\{show\.localId \|\| show\.id\}/, "TV cards must use the stable local identity as their React key");
assert.doesNotMatch(app, /\{show\.year && <p>\{show\.year\}<\/p>\}/, "TV poster cards must keep years hidden");

assert.match(app, /draggable key=\{row\.editorId/, "exact episode ordering must remain draggable");
assert.match(app, /manualOrder: true/, "saved imported orders must remain manual after editing");
assert.match(app, /--collection-background-image/, "per-collection backgrounds must remain enabled");

console.log("Homestead 0.5.9 duplicate-title and collection regression checks: PASSED");
