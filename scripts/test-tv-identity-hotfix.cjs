const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert.ok(app.includes("function getTvStableMetadataMatchKeys"), "stable TV client keys");
assert.ok(app.includes('libraryType === "tv"'), "TV-specific lookup");
assert.ok(!app.includes("{show.year && <p>{show.year}</p>}"), "TV grid keeps year labels hidden");
assert.ok(server.includes("function buildStableTvMatchAliases"), "stable TV server aliases");
assert.ok(server.includes("? buildStableTvMatchAliases"), "stable TV stored-match lookup");
assert.ok(!/function cleanTvMatchQuery[\s\S]{0,900}replace\(\/\\b\(\?:19\|20\)\\d\{2\}/.test(app), "Fix Match keeps year");
console.log("Homestead 0.5.6.1 TV identity regression checks: PASSED");
