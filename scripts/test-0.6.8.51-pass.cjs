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

assert.match(app, /calendar: \[\s*"Add Event",\s*"Upload Schedule",(?:\s*"Add Bill",)?\s*"Online Schedules",\s*\]/);
assert.match(app, /normalizedOption\.includes\("online"\) \? "online-schedules"/);
assert.match(app, /event\.detail\.action === "online-schedules"/);
assert.match(app, /All shifts in this import/);
assert.match(app, /every shift keeps its original date and times/);
assert.match(app, /editingImportedBatch && editScope === "series"/);
assert.match(app, /result\.scope === "import"/);

assert.match(server, /current\.source === "schedule-import" && current\.importId/);
assert.match(server, /updateScope === "import" \? String\(event\.start \|\| ""\)\.slice\(11, 16\)/);
assert.match(server, /updateScope === "import" \? String\(event\.end \|\| ""\)\.slice\(11, 16\)/);
assert.match(server, /importId: event\.importId/);
assert.match(server, /scope: updateScope/);

console.log("Homestead 0.6.8.51 calendar Add wiring and imported-schedule group editing checks passed.");
