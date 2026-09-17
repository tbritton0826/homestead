"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const access = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");

assert.match(app, /"family-home": "familyArchive"/);
assert.match(app, /familySettingForPage/);
assert.match(app, /Family Archive.*is disabled in Settings/);
assert.match(access, /configuredLibraryEnabled\("family-home"\)/);
assert.match(access, /Family Archive is disabled/);

assert.match(app, /homesteadAdultProfileSort:\$\{activeLibrary\}/);
assert.match(app, /adult-profile-sort-popover/);
assert.match(app, /filterSortActive: sortMode !== "alphabetical"/);
assert.match(css, /\.adult-profile-sort-popover/);
assert.doesNotMatch(app, /className="adult-profile-sort-row panel"/);

assert.match(app, /refresh-missing-metadata/);
assert.match(app, /\/api\/metadata\/adult\/bulk-fetch/);
assert.match(app, /homestead-open-activity-center/);

assert.match(app, /onTouchStart=\{handleBookTouchStart\}/);
assert.match(app, /Math\.abs\(deltaX\) > 55/);

console.log("0.6.8.40 Family, profile header, metadata refresh, and touch checks passed.");
