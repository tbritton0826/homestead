"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert.match(app, /eventClick=\{\(info\) => editCalendarEvent\(info\.event\.id\)\}/);
assert.match(app, /editingEvent \? `\/api\/calendar\/events\/\$\{encodeURIComponent\(initial\.id\)\}`/);
assert.match(server, /res\.json\(\{ ok: true, event: calendar\.events\[index\], updated: true, updatedCount: 1, scope: "only" \}\)/);

console.log("Homestead 0.6.8.49 calendar event editing integration checks passed.");
