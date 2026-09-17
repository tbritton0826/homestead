"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const mirroredNextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");

assert.match(app, /All events in this series/);
assert.match(app, /scope: editingEvent \? editScope/);
assert.match(app, /type="color" value=\{draft\.color\}/);
assert.match(app, /id: "online-schedules", label: "Online Schedules"/);
assert.match(app, /function CalendarSourcesModal/);
assert.match(app, /calendarSourceVisibility/);
assert.match(app, /event\.readOnly \|\| event\.sourceId/);
assert.match(css, /\.calendar-source-list/);
assert.match(server, /const CALENDAR_ARR_SERVICES = new Set/);
assert.match(server, /function parseIcalendarEvents/);
assert.match(server, /function fetchNflCalendarEvents/);
assert.match(server, /function fetchArrCalendarEvents/);
assert.match(server, /app\.post\("\/api\/calendar\/sources"/);
assert.match(server, /req\.body\?\.scope === "series"/);
assert.match(server, /updatedCount: updatedEvents\.length/);
assert.match(nextVersion, /calendarSourceVisibility/);
assert.match(mirroredNextVersion, /calendarSourceVisibility/);

const helperStart = server.indexOf("function calendarSourceUrl");
const helperEnd = server.indexOf("function decodeScheduleDataUrl", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Calendar source helpers are missing.");
const context = {
  AbortSignal,
  Date,
  URL,
  crypto,
  CALENDAR_ARR_SERVICES: new Set(["radarr", "sonarr", "lidarr", "readarr"]),
  NFL_TEAMS: { buf: "Buffalo Bills" },
  NFL_TEAM_SLUGS: { buf: "buffalo-bills" },
  calendarColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback; },
  calendarText(value = "", maximum = 300) { return String(value || "").replace(/\0/g, "").trim().slice(0, maximum); },
  readSetupConfig() { return { integrationSettings: { sonarr: { url: "http://sonarr.local", apiKey: "test-key" } } }; },
  fetch: async () => { throw new Error("Unexpected fetch"); },
};
const helpers = vm.runInNewContext(`(() => { ${server.slice(helperStart, helperEnd)}; return { calendarSourceUrl, calendarExternalEvent, parseIcalendarEvents, fetchNflCalendarEvents, fetchArrCalendarEvents }; })()`, context);

assert.equal(helpers.calendarSourceUrl("webcal://calendar.example/team.ics"), "https://calendar.example/team.ics");
const source = { id: "calendar-source-test", type: "ical", name: "Test calendar", color: "#123456" };
const parsed = helpers.parseIcalendarEvents("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:game-1\r\nDTSTART:20260920T170000Z\r\nDTEND:20260920T200000Z\r\nSUMMARY:Bills vs Jets\r\nLOCATION:Highmark Stadium\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:day-1\r\nDTSTART;VALUE=DATE:20261225\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nEND:VCALENDAR", source);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].title, "Bills vs Jets");
assert.equal(parsed[0].location, "Highmark Stadium");
assert.equal(parsed[0].readOnly, true);
assert.equal(parsed[0].sourceId, source.id);
assert.equal(parsed[1].allDay, true);

(async () => {
  let requestedUrl = "";
  context.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, text: async () => '<a data-analytics="{&quot;contentLocation&quot;:&quot;1&quot;,&quot;gameId&quot;:&quot;401&quot;,&quot;linkName&quot;:&quot;Bills at Jets, Sunday, September 20th, 1:00 PM, CBS&quot;}" href="/games/bills-at-jets-2026-reg-2">Game</a>' };
  };
  const nflEvents = await helpers.fetchNflCalendarEvents({ id: "calendar-source-nfl", type: "nfl", name: "Bills", team: "buf", color: "#355dff" });
  assert.match(requestedUrl, /nfl\.com\/schedules\/\d{4}\/by-team\/buffalo-bills/);
  assert.equal(nflEvents[0].title, "Bills at Jets");

  context.fetch = async (url, options) => {
    requestedUrl = String(url);
    assert.equal(options.headers["X-Api-Key"], "test-key");
    return { ok: true, json: async () => [{ id: 22, series: { title: "Example Show" }, seasonNumber: 2, episodeNumber: 4, title: "The Episode", airDateUtc: "2026-10-01T01:00:00Z" }] };
  };
  const arrEvents = await helpers.fetchArrCalendarEvents({ id: "calendar-source-arr", type: "arr", name: "Sonarr", service: "sonarr", color: "#8b63d9" });
  assert.match(requestedUrl, /\/api\/v3\/calendar\?/);
  assert.match(arrEvents[0].title, /Example Show · S02E04 · The Episode/);
  if (process.env.HOMESTEAD_LIVE_NFL_TEST === "1") {
    context.fetch = fetch;
    const liveEvents = await helpers.fetchNflCalendarEvents({ id: "calendar-source-live", type: "nfl", name: "Bills", team: "buf", color: "#355dff" });
    assert.ok(liveEvents.length >= 1, "The official NFL schedule page returned no upcoming timed games.");
  }
  console.log("Calendar sources, iCalendar parsing, NFL, and *arr regression checks passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
