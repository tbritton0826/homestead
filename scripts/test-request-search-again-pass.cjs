"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const rows = fs.readFileSync(path.join(root, "src", "components", "RequestRows.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");

assert(server.includes('app.post("/api/requests/search-again", homesteadAccess.requireSession'), "Search Again route must require a signed-in session.");
assert(server.includes("homesteadAccess.canAccessLibrary(req, library)"), "Search Again must enforce library access.");
assert(server.includes("Only the requester can search again for this item."), "Search Again must enforce request ownership.");
assert(server.includes("removeFromClient=true&blocklist=true&skipRedownload=true"), "The failed queue item must be removed and blocklisted without launching a duplicate automatic search.");
assert(server.includes('{ name: "SeriesSearch", seriesId: Number(record.id) }'), "Sonarr must receive a new series search command.");
assert(server.includes('{ name: "MoviesSearch", movieIds: [Number(record.id)] }'), "Radarr must receive a new movie search command.");
assert(server.includes("No previous ${integration.label} release could be safely identified and excluded. Nothing was restarted."), "Unsafe retries must stop instead of risking the same file.");
assert(server.indexOf("blocklist=true") < server.indexOf('requestSearchAgainArrFetch(integration, "command"'), "The old release must be excluded before the replacement search starts.");
assert(server.includes("providerServiceId: mediaInfo.externalServiceId"), "Jellyseerr's ARR service identity must be retained for exact matching.");
assert(server.includes("attemptedRelease:"), "The failed release title must be retained for exact queue matching.");

assert(rows.includes("function canSearchAgain"), "Request cards must decide when Search Again is safe to offer.");
assert(rows.includes("['movies', 'tv'].includes(row.library)"), "Search Again must be limited to the supported Movie and TV providers.");
assert(rows.includes("['needs-attention', 'failed'].includes"), "Search Again must only appear for failed/problem requests.");
assert(rows.includes("request-search-again-button"), "Request cards must render the Search Again action.");
assert(app.includes('fetch("/api/requests/search-again"'), "The Requests page must call the Search Again route.");
assert(app.includes('window.dispatchEvent(new Event("homestead-request-updated"))'), "A successful retry must refresh request status.");
assert(css.includes(".request-search-again-button"), "Search Again button styling is missing.");

const helperStart = server.indexOf("function requestSearchAgainRows");
const helperEnd = server.indexOf('app.post("/api/requests/search-again"', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "Search Again helper block is missing.");
const helpers = vm.runInNewContext(`
  function normalizeAcquisitionText(value = "") {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\\s+/g, " ").trim();
  }
  ${server.slice(helperStart, helperEnd)}
  ({ requestSearchAgainRows, requestSearchAgainMatchesArrRecord, requestSearchAgainQueueMatches, requestSearchAgainQueueNeedsExclusion });
`);

assert.deepEqual(Array.from(helpers.requestSearchAgainRows({ records: [{ id: 1 }] }), (row) => ({ ...row })), [{ id: 1 }]);
assert.equal(helpers.requestSearchAgainMatchesArrRecord({ id: 22, title: "Movie" }, { providerServiceId: 22 }, "movies"), true);
assert.equal(helpers.requestSearchAgainMatchesArrRecord({ id: 22, tmdbId: 44, title: "Movie" }, { tmdbId: 44 }, "movies"), true);
assert.equal(helpers.requestSearchAgainMatchesArrRecord({ id: 22, title: "Show", year: 2020 }, { title: "Show", year: 2021 }, "tv"), false);
assert.equal(helpers.requestSearchAgainQueueMatches({ movieId: 22 }, 22, "movies"), true);
assert.equal(helpers.requestSearchAgainQueueMatches({ series: { id: 33 } }, 33, "tv"), true);
assert.equal(helpers.requestSearchAgainQueueNeedsExclusion({ title: "Example.1080p-GROUP" }, "Example 1080p GROUP"), true);
assert.equal(helpers.requestSearchAgainQueueNeedsExclusion({ trackedDownloadStatus: "warning" }, ""), true);
assert.equal(helpers.requestSearchAgainQueueNeedsExclusion({ status: "downloading" }, ""), false);

async function runRouteChecks() {
  const routeStart = server.indexOf("function requestSearchAgainIntegration");
  const routeEnd = server.indexOf('app.get("/api/integrations/seerr/media/:mediaType/:tmdbId/status"', routeStart);
  assert(routeStart >= 0 && routeEnd > routeStart, "Search Again route block is missing.");
  let handler;
  let scenario = "failed-queue";
  const calls = [];
  const jsonResponse = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => data == null ? "" : JSON.stringify(data) });
  const context = {
    app: { post(route, _guard, routeHandler) { assert.equal(route, "/api/requests/search-again"); handler = routeHandler; } },
    homesteadAccess: {
      requireSession() {},
      canAccessLibrary: () => true,
      accessContext: () => ({ user: { id: "owner", role: "owner" } }),
      recordAudit() {},
    },
    readSetupConfig: () => ({ integrationSettings: { radarr: { url: "http://radarr", apiKey: "secret" } } }),
    readRequests: () => ({ movies: [], tv: [] }),
    normalizeAcquisitionText: (value = "") => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
    AbortSignal,
    fetch: async (url, options = {}) => {
      if (url.endsWith("/movie")) return jsonResponse([{ id: 7, tmdbId: 99, title: "Example" }]);
      if (url.includes("/queue?")) return jsonResponse({ records: scenario === "failed-queue" ? [{ id: 55, movieId: 7, status: "warning", title: "Bad.Release" }] : [] });
      if (url.includes("/blocklist?")) return jsonResponse({ records: [] });
      if (url.includes("/queue/55?")) { calls.push({ action: "delete", url, options }); return jsonResponse(null); }
      if (url.endsWith("/command")) { calls.push({ action: "command", url, options }); return jsonResponse({ id: 1 }); }
      throw new Error(`Unexpected URL: ${url}`);
    },
  };
  vm.runInNewContext(server.slice(routeStart, routeEnd), context);
  const request = { body: { request: { id: "movies:tmdb:99", library: "movies", tmdbId: 99, title: "Example", status: "needs-attention", attemptedRelease: "Bad Release" } } };
  let status = 200;
  let payload;
  const response = { status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
  await handler(request, response);
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(calls.map((call) => call.action), ["delete", "command"], "The failed release must be blocked before the new search.");
  assert(calls[0].url.includes("blocklist=true"));
  assert.equal(JSON.parse(calls[1].options.body).name, "MoviesSearch");

  scenario = "unidentified";
  calls.length = 0;
  status = 200;
  payload = null;
  await handler(request, response);
  assert.equal(status, 409);
  assert.equal(payload.ok, false);
  assert.equal(calls.length, 0, "An unidentified prior release must not start a replacement search.");
}

runRouteChecks().then(() => console.log("Request Search Again alternative-release checks passed.")).catch((error) => { console.error(error); process.exitCode = 1; });
