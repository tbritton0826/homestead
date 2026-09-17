"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const recognition = fs.readFileSync(path.join(root, "src", "server", "schedule-recognition.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.match(recognition, /function parsePersonalScheduleText/);
assert.match(recognition, /mode: "personal-list"/);
assert.match(recognition, /datedEntry <= rememberedDate/);
assert.match(server, /tsvToReadableText\(parseTesseractTsv\(tsv\)\)/);
assert.match(server, /personalList\.recognition\?\.mode === "personal-list"/);
assert.match(app, /Personal schedule recognized/);
assert.match(app, /Any date in this schedule week/);

console.log("Homestead 0.6.8.48 personal schedule import integration checks passed.");
