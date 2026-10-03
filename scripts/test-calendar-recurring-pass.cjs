const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert.match(app, /calendarRepeatDays/);
assert.match(app, /Monday–Friday/);
assert.match(app, /Except on/);
assert.match(app, /Add exception/);
assert.match(app, /calendarSeriesPreview/);
assert.match(app, /id: "upload-schedule", label: "Upload Schedule"/);
assert.match(app, /backAction: "back-family-home"/);
assert.doesNotMatch(app.slice(app.indexOf("function CalendarPage"), app.indexOf("function parseEpisodeName")), /calendar-import-card/);
assert.match(css, /\.calendar-repeat-panel/);
assert.match(css, /\.calendar-series-preview/);
assert.match(server, /function normalizeCalendarRecurrence/);
assert.match(server, /function buildCalendarSeriesEvents/);
assert.match(server, /app\.delete\("\/api\/calendar\/events\/:eventId"/);
assert.match(server, /Every occurrence already exists on this calendar/);
assert.match(server, /series: \(calendar\.series \|\| \[\]\)\.slice\(-2000\)/);

console.log("Calendar recurring and layout pass checks passed.");
