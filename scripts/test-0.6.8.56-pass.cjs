"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const metadataSource = fs.readFileSync(path.join(root, "scripts", "metadata", "fetch-adult-metadata.cjs"), "utf8");
const pkg = require(path.join(root, "package.json"));

assert.equal(pkg.version, "0.6.8.64");

// Person details paint from the search result immediately. Slow, optional
// credit providers complete independently through a bounded cached endpoint.
assert.match(app, /useState\(\(\) => \(\{ person: seed \|\| \{\}, appearances: seed\?\.knownFor \|\| seed\?\.known_for \|\| \[\] \}\)\)/);
assert.match(app, /fetch\(`\$\{personUrl\}\/appearances`\)/);
assert.match(server, /const seerrPersonSummaryCache = new Map\(\)/);
assert.match(server, /const seerrPersonCreditsCache = new Map\(\)/);
assert.match(server, /app\.get\("\/api\/integrations\/seerr\/person\/:tmdbId\/appearances"/);
assert.match(server, /AbortSignal\.timeout\(2800\)/);

// CelebrityTall is a field-by-field, review-only fallback and supports the
// site's real height-weight-age URLs and HTML table layout.
assert.match(metadataSource, /\$\{slug\}-height-weight-age\//);
assert.match(metadataSource, /function celebrityTallPlainTextBody/);
assert.match(metadataSource, /const tableValue = \(labels = \[\]\) =>/);
assert.match(metadataSource, /libraryType === "celebrities" && options\.celebrityTallEnabled !== false/);
assert.doesNotMatch(metadataSource, /candidates\.some\(hasAdultBodyNumbers\)/);
assert.match(metadataSource, /lowConfidenceFallback: true/);
assert.match(metadataSource, /requiresReview: true/);

// Local public artwork paths remain browser URLs. Home books and music resolve
// scanner-known images before placeholders, while music provider results are
// cached so Back navigation is not what hydrates the grid.
assert(app.includes('/^\\/(?:media|assets|images|placeholder'), "Browser-served artwork paths must not be wrapped by the file API.");
assert.match(app, /function getDashboardBookPoster/);
assert.match(app, /filePoster\?\.publicPath/);
assert.match(app, /const getDashboardMusicPoster =/);
assert.match(app, /homesteadHomeMusicArtwork/);
assert.match(app, /homesteadMusicLibraryArtwork/);
assert.match(app, /Paint scanner-known and session-cached artwork before waiting for Lidarr/);

// Lidarr lists are shared across requests, album matching is indexed, and
// artwork fallback lookup begins concurrently with the fast local attempt.
assert.match(server, /const lidarrLibraryListCache =/);
assert.match(server, /getCachedLidarrLibraryList\("albums"\)/);
assert.match(server, /const albumsByArtistId = new Map\(\)/);
assert.match(server, /const fallbackUrlsPromise =/);
assert.match(server, /candidate\.kind === "lidarr-api-cache" \? 2500 : 4000/);

// Collection work is deferred until the collection surface is actually open,
// and the hot membership/reference paths use indexes rather than repeated scans.
assert.match(app, /const shouldBuildSharedCollections = movieView === "collections"/);
assert.doesNotMatch(app, /const shouldBuildSharedCollections = true/);
assert.match(app, /const allItemsBySource = new Map\(\)/);
assert.match(app, /itemKeys: new Set\(\)/);

const originalFetch = global.fetch;
global.fetch = async () => ({
  ok: true,
  text: async () => `<html><h1>Amber Heard Height Weight Age</h1><table>
    <tr><td>Height in Feet Inches</td><td>5 ft 7 in</td></tr>
    <tr><td>Weight in Pounds</td><td>121 lbs</td></tr>
    <tr><td>Body Measurements</td><td>34-27-34 in</td></tr>
    <tr><td>Bra Size</td><td>32B</td></tr>
    <tr><td>Feet/Shoe Size</td><td>8 (US)</td></tr>
    <tr><td>Dress Size</td><td>10 (US)</td></tr>
    <tr><td>Hair Color</td><td>Blonde</td></tr>
    <tr><td>Eye Color</td><td>Blue</td></tr>
  </table></html>`,
});

const { searchCelebrityTallMetadata } = require(path.join(root, "scripts", "metadata", "fetch-adult-metadata.cjs"));

(async () => {
  const [candidate] = await searchCelebrityTallMetadata("Amber Heard");
  assert(candidate, "CelebrityTall table candidate was not parsed.");
  assert.equal(candidate.height, "5 ft 7 in");
  assert.equal(candidate.weight, "121 lbs");
  assert.equal(candidate.measurementsRaw, "34-27-34");
  assert.equal(candidate.braSize, "32B");
  assert.equal(candidate.shoeSize, "US 8");
  assert.equal(candidate.dressSize, "US 10");
  assert.equal(candidate.requiresReview, true);
  global.fetch = originalFetch;
  console.log("Homestead 0.6.8.57 Adult and Media v1 stabilization checks passed.");
})().catch((error) => {
  global.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
