const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert.match(app, /matchLocked:\s*true/, "TV manual matches must be locked");
assert.match(app, /activeLibrary === "tv"/, "TV Add actions must have a dedicated route");
assert.match(app, /setRequestedMediaToolPage\("metadata"\)/, "TV Fix Match must open metadata tools");
assert.match(app, /setLibraryImportOpen\(true\)/, "TV scan and manual add must use the TV importer");
assert.match(app, /collectionItems\.slice\(0, 2000\)/, "Collection resolver must be bounded");
assert.match(app, /item\.unavailable/, "Unavailable collection items must not recurse through matching");
assert.match(server, /match\.matchLocked === true/, "Auto match must preserve locked matches");
assert.match(server, /pointedRecord\?\.localId/, "Manual match writes must reject cross-record aliases");
assert.match(server, /libraryType === "tv" && req\.body\?\.manualOverride !== false/, "TV aliases must be scoped to stable identities");
assert.match(server, /missing:\s*true/, "Missing profile metadata must return a quiet result");
assert.match(server, /Failed to build web manifest/, "Web manifest must have a safe fallback");

console.log("Homestead 0.5.5 TV first-pass regression checks: PASSED");
