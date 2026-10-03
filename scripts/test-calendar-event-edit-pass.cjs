"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");

assert.match(app, /const editingEvent = Boolean\(initial\.id\)/);
assert.match(app, /method: editingEvent \? "PATCH" : "POST"/);
assert.match(app, /eventClick=\{\(info\) => editCalendarEvent\(info\.event\.id\)\}/);
assert.match(app, /setEventModalOpen\(event\)/);
assert.match(app, /Calendar event updated\./);
assert.match(app, /Only the selected occurrence will change\./);
assert.match(app, /All shifts in this import/);
assert.match(app, /every shift keeps its original date and times/);
assert.match(server, /const editsEventForm = formFields\.some/);
assert.match(server, /calendarEventFromInput\(\{/);
assert.match(server, /calendar\.events\.filter\(\(event\) => event\.id !== current\.id\)/);
assert.match(server, /updated: true/);
assert.match(server, /scope: updateScope/);
assert.match(css, /\.calendar-board \.fc-event \{ cursor: pointer; touch-action: manipulation; \}/);

console.log("Calendar click-to-edit regression checks passed.");
