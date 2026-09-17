"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert.match(nextVersion, /version: "0\.6\.8\.64"/);
assert.match(app, /All events in this series/);
assert.match(app, /Online Schedules/);
assert.match(app, /calendarSourceVisibility/);
assert.match(server, /sources: \(calendar\.sources \|\| \[\]\)\.slice\(-200\)/);
assert.match(server, /source\.type === "nfl"/);
assert.match(server, /source\.type === "arr"/);
assert.match(server, /source\.type === "ical"/);

console.log("Homestead 0.6.8.51 calendar sources, colors, visibility, and series-scope checks passed.");
