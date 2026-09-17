const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { registerNextVersionRoutes } = require("../src/server/next-version.cjs");

const routes = [];
const app = {};
app.use = () => {};
for (const method of ["get", "post", "put", "patch", "delete"]) {
  app[method] = (route, ...handlers) => routes.push({ method: method.toUpperCase(), route, handlers });
}
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-next-test-"));
const accessApi = registerNextVersionRoutes({
  app,
  express: {
    raw: () => (_req, _res, next) => next(),
    json: () => (_req, _res, next) => next(),
  },
  dataDir,
  readSetupConfig: () => ({ adminAccount: { username: "owner", displayName: "Owner" }, enabledLibraries: { movies: true } }),
  writeSetupConfig: () => {},
});

function matchRoute(pattern, actual) {
  const names = [];
  const source = String(pattern).replace(/:[^/]+/g, (token) => { names.push(token.slice(1)); return "([^/]+)"; });
  const match = actual.match(new RegExp(`^${source}$`));
  return match ? Object.fromEntries(names.map((name, index) => [name, match[index + 1]])) : null;
}

async function request(method, url, { body = {}, headers = {} } = {}) {
  const [pathname, queryText = ""] = url.split("?");
  const candidate = routes.map((route) => ({ route, params: route.method === method ? matchRoute(route.route, pathname) : null })).find((item) => item.params);
  assert(candidate, `Missing route: ${method} ${pathname}`);
  const req = { body, headers, query: Object.fromEntries(new URLSearchParams(queryText)), params: candidate.params, ip: "127.0.0.1", get(name) { return headers[String(name).toLowerCase()] || ""; } };
  const result = { status: 200, headers: {} };
  const res = { status(code) { result.status = code; return this; }, setHeader(name, value) { result.headers[name] = value; }, json(value) { result.body = value; return this; }, download(file) { result.download = file; return this; } };
  let index = 0;
  const next = async () => { const handler = candidate.route.handlers[index++]; if (handler) await handler(req, res, next); };
  await next();
  return result;
}

(async () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
  assert(appSource.includes("function buildAdultProfileRecommendations"));
  assert(appSource.includes("function AdultRecommendationPosterGrid"));
  assert(!appSource.includes("homesteadAdultRecommendationPosterSize"));
  assert(appSource.includes("/api/discovery/adult/recommendations"));
  assert(appSource.includes("function getRecentlyUpdatedAdultProfiles"));
  assert(appSource.includes("homesteadAdultProfileActivity:"));
  assert(appSource.includes("homesteadAdultMediaActivity:"));
  assert(appSource.includes("homestead-adult-media-activity"));
  assert(appSource.includes("+ Add profile"));
  assert(appSource.includes("View source"));
  assert(appSource.includes("getHomesteadMetadataMatchFromIndex"));
  assert(appSource.includes("const shouldBuildSharedCollections = true;"));
  assert(appSource.includes('ensureGroup(seed.name, "smart", seed.description, seed.id)'));
  assert(appSource.includes("Filename Auto Match V1"));
  assert(appSource.includes("sidebarBackgroundImage"));
  assert(appSource.includes("detailPosterOpacity"));
  assert(appSource.includes("function TVFixMatchModal"));
  assert(appSource.includes('const shouldBuildTvSharedCollections = tvView === "collections"'));
  assert(appSource.includes("episodeVersionPicker"));
  assert(appSource.includes("headerRibbonOpacity"));
  assert(appSource.includes("alphaRailOpacity"));
  assert(appSource.includes('season === "00" ? "Specials"'));
  assert(appSource.includes("group.versions.some"));
  assert(appSource.includes('fetch("/api/tv/upgrade-requests"'));
  assert(appSource.includes("canManageTvMetadata"));
  assert(appSource.includes("DEFAULT_ADULT_RECOMMENDATION_PREFERENCES"));
  assert(appSource.includes("Browse Files"));
  assert(appSource.includes("adultEmptyStates"));
  assert(appSource.includes("function AdultRecommendationProviderSettings"));
  assert(appSource.includes("Undo / revert"));
  assert(appSource.includes("Create timeline event from these changes?"));
  assert(appSource.includes("ADULT_PERSON_FULL_FETCH_CLIENT_TIMEOUT_MS"));
  assert(appSource.includes("new AbortController()"));
  assert(appSource.includes("signal: requestController.signal"));
  assert(appSource.includes("window.clearTimeout(requestTimeoutHandle)"));
  assert(appSource.includes("function compactHomesteadMetadataMatches"));
  assert(appSource.includes("function persistHomesteadMetadataMatches"));
  assert(appSource.includes("server-persisted matches remain authoritative"));
  assert(!appSource.includes("Similarity-based celebrity recommendations will appear here"));
  const serverSource = fs.readFileSync(path.join(__dirname, "../server.cjs"), "utf8");
  assert(serverSource.includes("async function discoverExternalAdultProfileRecommendations"));
  assert(serverSource.includes("discoverStructuredRecommendations"));
  assert(serverSource.includes("applyAdultMetadataUpdate"));
  assert(serverSource.includes('app.post("/api/metadata/adult/revert"'));
  assert(serverSource.includes('app.get("/api/discovery/adult/providers"'));
  assert(serverSource.includes('app.post("/api/discovery/adult/recommendations"'));
  assert(serverSource.includes('app.post("/api/appearance/background"'));
  assert(serverSource.includes("async function runMovieAutoMatch"));
  assert(serverSource.includes('app.post("/api/movies/auto-match/run"'));
  assert(serverSource.includes("async function runTvAutoMatch"));
  assert(serverSource.includes('app.post("/api/tv/auto-match/run"'));
  assert(serverSource.includes("function syncTvLibraryWatchers"));
  assert(serverSource.includes('app.post("/api/tv/upgrade-requests"'));
  assert(serverSource.includes('app.patch("/api/tv/upgrade-requests/:requestId"'));
  assert(serverSource.includes("function compactMetadataMatches"));
  assert(serverSource.includes("compactMetadataMatchRecord"));
  assert(serverSource.includes("...existing,\n          ...metadata,"));
  assert(serverSource.includes("ADULT_PERSON_FULL_FETCH_TIMEOUT_MS"));
  assert(serverSource.includes("runWithTimeout(() => searchAdultMetadata"));
  assert(serverSource.includes("metadataSearchTimedOut"));
  assert(serverSource.includes("The selected result remains available"));
  const profileBuilderStart = serverSource.indexOf("function buildAdultProfileMetadataDocument");
  const profileBuilderEnd = serverSource.indexOf("\nfunction ", profileBuilderStart + 1);
  const profileBuilderSource = serverSource.slice(profileBuilderStart, profileBuilderEnd);
  assert(profileBuilderSource.includes("manualMetadataFields,"));
  assert(!profileBuilderSource.includes("manualMetadataFieldSet"));
  const metadataUpdateStart = serverSource.indexOf("function applyAdultMetadataUpdate");
  const metadataUpdateEnd = serverSource.indexOf('app.post("/api/metadata/adult/edit"', metadataUpdateStart);
  const metadataUpdateSource = serverSource.slice(metadataUpdateStart, metadataUpdateEnd);
  assert(metadataUpdateSource.includes("const manualMetadataFieldSet"));
  assert(metadataUpdateSource.includes("manualMetadataFields: Array.from(manualMetadataFieldSet)"));
  assert(!metadataUpdateSource.includes("\n      manualMetadataFields,\n"));

  const platform = await request("GET", "/api/platform");
  assert.equal(platform.body.platform.version, require("../package.json").version);
  const accounts = await request("GET", "/api/accounts");
  assert.equal(accounts.body.users[0].role, "owner");
  const savedPreferences = await request("PATCH", "/api/account/preferences", { body: { preferences: { adultRecommendations: { gender: "female", bodyTypes: ["petite"], maxWeight: 125, minAge: 18, maxAge: 35 }, adultEmptyStates: { photos: "No photos with {name}.", videos: "No videos with {name}." } } } });
  assert.equal(savedPreferences.status, 200);
  assert.equal(savedPreferences.body.preferences.adultRecommendations.maxWeight, 125);
  assert.equal(savedPreferences.body.preferences.adultEmptyStates.photos, "No photos with {name}.");
  const displaySaved = await request("PATCH", "/api/account/preferences", { body: { preferences: { displayPreferences: { dateFormat: "D_MMM_YYYY", heightFormat: "CM", weightFormat: "KG", measurementFormat: "CM", unknown: "ignored" } } } });
  assert.deepEqual(displaySaved.body.preferences.displayPreferences, { dateFormat: "D_MMM_YYYY", heightFormat: "CM", weightFormat: "KG", measurementFormat: "CM" });
  assert.equal(displaySaved.body.preferences.adultRecommendations.maxWeight, 125);
  assert.equal(displaySaved.body.preferences.adultEmptyStates.photos, "No photos with {name}.");
  assert.equal((await request("GET", "/api/account/preferences")).body.preferences.displayPreferences.heightFormat, "CM");
  const created = await request("POST", "/api/accounts", { body: { username: "friend", displayName: "Trusted Friend", password: "friend-pass", role: "member", allowedLibraries: ["movies", "adult"], linkedAdultProfileId: "personal-jane", linkedAdultProfileConfirmed18Plus: true, fullAdultAccess: false, aiAccess: false } });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.role, "member");
  assert.deepEqual(created.body.user.allowedLibraries, ["movies"]);
  assert.equal(created.body.user.fullAdultAccess, false);
  assert.equal(created.body.user.linkedAdultProfileId, "personal-jane");
  const login = await request("POST", "/api/auth/login", { body: { username: "friend", password: "friend-pass" } });
  const sessionCookie = String(login.headers["Set-Cookie"] || "").split(";")[0];
  const friendPreferences = await request("GET", "/api/account/preferences", { headers: { cookie: sessionCookie } });
  assert.deepEqual(friendPreferences.body.preferences.displayPreferences, {}, "a second account must not inherit owner preferences");
  const filtered = accessApi.filterMediaIndex({ headers: { cookie: sessionCookie } }, {
    movies: [{ id: "movie-1" }],
    tv: [{ id: "show-1" }],
    books: [{ id: "book-1" }],
    youtube: [{ id: "video-1" }],
    youtubeCreators: [{ id: "creator-1" }],
    libraries: {
      movies: { "movie-1": { id: "movie-1" } },
      tv: { "show-1": { id: "show-1" } },
      books: { "book-1": { id: "book-1" } },
      youtube: { "video-1": { id: "video-1" } },
      personal: { "personal-jane": { id: "personal-jane", name: "Jane", privateNotes: "owner only", height: "5 ft 4 in", metadata: { timeline: [{ title: "Private event" }], pantySize: "M", profileNotes: [{ title: "Private" }] } }, other: { id: "other" } },
      performers: { performer: { id: "performer" } },
    },
  });
  assert.equal(filtered.movies.length, 1);
  assert.deepEqual(filtered.tv, []);
  assert.deepEqual(filtered.books, []);
  assert.deepEqual(filtered.youtube, []);
  assert.deepEqual(filtered.youtubeCreators, []);
  assert.deepEqual(filtered.libraries.youtube, {});
  assert.deepEqual(Object.keys(filtered.libraries.personal), ["personal-jane"]);
  assert.equal(filtered.libraries.personal["personal-jane"].privateNotes, undefined);
  assert.equal(filtered.libraries.personal["personal-jane"].height, undefined);
  assert.equal(filtered.libraries.personal["personal-jane"].metadata.timeline, undefined);
  assert.equal(filtered.libraries.personal["personal-jane"].metadata.pantySize, undefined);
  const promoted = await request("PATCH", `/api/accounts/${created.body.user.id}`, { body: { role: "member", allowedLibraries: ["movies"], fullAdultAccess: true, linkedAdultProfileId: "personal-jane", linkedAdultProfileConfirmed18Plus: true } });
  assert.equal(promoted.body.user.role, "member");
  assert.equal(promoted.body.user.fullAdultAccess, true);
  assert(promoted.body.user.allowedLibraries.includes("adult"));
  assert.equal(promoted.body.user.linkedAdultProfileId, "");
  const removed = await request("DELETE", `/api/accounts/${created.body.user.id}`);
  assert.equal(removed.status, 200);
  await request("POST", "/api/cloud/folders", { body: { path: "", name: "Photos" } });
  const files = await request("GET", "/api/cloud/files?path=");
  assert.equal(files.body.files[0].name, "Photos");
  const rule = await request("POST", "/api/automation/rules", { body: { name: "Approve requests", serviceId: "jellyseerr" } });
  assert.equal(rule.status, 201);
  assert.equal(rule.body.rule.requireApproval, true);
  const weakOwnerSetup = await request("POST", "/api/accounts/complete-owner-setup", { body: { username: "owner", password: "short" } });
  assert.equal(weakOwnerSetup.status, 400);
  const ownerSetup = await request("POST", "/api/accounts/complete-owner-setup", { body: { username: "owner", displayName: "Owner", password: "preview-pass" } });
  assert.equal(ownerSetup.status, 200);
  assert.equal(ownerSetup.body.authEnabled, true);
  assert.match(String(ownerSetup.headers["Set-Cookie"] || ""), /^homestead_session=/);
  assert.equal((await request("GET", "/api/platform")).body.platform.authEnabled, true);
  console.log("Homestead current-version metadata, recommendations, privacy, Movies, and TV regression checks passed.");
})().finally(() => fs.rmSync(dataDir, { recursive: true, force: true }));
