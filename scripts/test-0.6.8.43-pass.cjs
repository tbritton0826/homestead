"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");
assert.match(css, /body \.main\.public-media-custom-appearance\.plugin-host-custom-appearance::before,\s*body \.main\.public-media-custom-appearance\.plugin-host-custom-appearance::after\s*\{\s*position:\s*absolute !important;\s*inset:\s*0 !important;/);
assert.match(css, /body \.main\.public-media-custom-appearance\.plugin-host-custom-appearance::before\s*\{[^}]*transform:\s*none !important;[^}]*background-size:\s*var\(--library-background-fit, cover\) !important;/s);

console.log("0.6.8.43 plugin Cover background boundary checks passed.");
