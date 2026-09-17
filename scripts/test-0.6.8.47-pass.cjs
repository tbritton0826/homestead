"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.match(app, /stats: \[\{ label: "Items", value: records\.length \}\]/);
assert.match(app, /\{formatGlobalHeaderStat\(stat\)\}<\/span>/);

const helperStart = app.indexOf("function formatGlobalHeaderStat(stat)");
const helperEnd = app.indexOf("function LibrarySidebar", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Global header statistic formatter is missing.");
const formatGlobalHeaderStat = vm.runInNewContext(`(() => { ${app.slice(helperStart, helperEnd)}; return formatGlobalHeaderStat; })()`);
assert.equal(formatGlobalHeaderStat("15 Items"), "15 Items");
assert.equal(formatGlobalHeaderStat({ label: "Items", value: 15 }), "15 Items");
assert.equal(formatGlobalHeaderStat({ name: "Favorites", count: 3 }), "3 Favorites");
assert.equal(formatGlobalHeaderStat(null), "");

console.log("Homestead 0.6.8.47 structured global-header statistic checks passed.");
