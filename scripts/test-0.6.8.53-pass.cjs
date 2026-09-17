"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const pkg = require(path.join(root, "package.json"));
const { parsePersonalScheduleText } = require(path.join(root, "src", "server", "schedule-recognition.cjs"));

assert.equal(pkg.version, "0.6.8.64");

assert.match(server, /\/api\/v3\/series/);
assert.match(server, /sonarrSeriesById/);
assert.match(server, /item\.seriesId/);
assert.match(app, /Unable to refresh Sonarr titles/);

assert.match(app, /Multi-week rotation/);
assert.match(app, /Mark blank days Off/);
assert.match(app, /Weeks in rotation/);
assert.match(server, /frequency === "rotating"/);
assert.match(server, /rotationWeeks/);
assert.match(server, /rotationState/);
assert.match(css, /\.calendar-rotation-week button\.off/);

assert.match(app, /Off days are saved in the calendar's all-day row/);
assert.match(server, /kind === "off"/);
assert.match(server, /allDay: true/);
const recognized = parsePersonalScheduleText("My schedule\nFri\n11\nToday\nOpen shifts are available\nSat\n12\n9:30 AM-8:30 PM [11.00]", { firstDate: "2026-09-06", personName: "Dan" });
assert.deepEqual(recognized.offDays.map((day) => day.date), ["2026-09-11"]);
assert.equal(recognized.offDays[0].dayType, "off");

assert.match(server, /async function createPantyBackgroundCutout/);
assert.match(server, /command: "rembg"/);
assert.match(server, /"-m", "rembg"/);
assert.match(server, /metadata\.hasAlpha/);

assert.match(server, /let bulkMediaScanRunning = false/);
assert.match(server, /SCAN_ALREADY_RUNNING/);
assert.match(server, /Full-library scan lock acquired/);
assert.match(server, /Full-library scan lock released/);
assert.match(server, /scanErr\.code === "SCAN_ALREADY_RUNNING" \? 409 : 500/);

console.log("Homestead 0.6.8.55 Sonarr lookup, rotating schedules, off days, rembg, and retained scan-lock checks passed.");
