"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert.match(app, /\["owner", "admin"\]\.includes\(sessionUser\?\.role\)/);
assert.match(app, /\[runtimePlugins, sessionUser\?\.role\]/);
assert.match(app, /plugin\.navigation\?\.hideStandalone !== true/);

console.log("Plugin runtime compatibility checks passed.");
