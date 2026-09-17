"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");
assert.match(app, /Poster size \(\{layoutMode === "tablet"/);
assert.match(app, /max="3\.5"/);
assert.match(css, /height:\s*720px;\s*min-height:\s*720px;\s*max-height:\s*720px/);

console.log("0.6.8.42 larger profile-poster range checks passed.");
