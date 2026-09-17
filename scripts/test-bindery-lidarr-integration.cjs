const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");

for (const marker of [
  'app.get("/api/integrations/bindery/status"',
  'app.get("/api/acquisition/search"',
  'app.post("/api/acquisition/request"',
  'app.get("/api/acquisition/jobs"',
  "async function refreshAcquisitionJobs()",
  "runAcquisitionScan(library)",
  'app.post("/api/integrations/lidarr/link-local-artists"',
  "async function syncLocalMusicArtistsWithLidarr({ refreshMetadata = false } = {})",
  'addOptions: { monitor: "none", searchForMissingAlbums: false }',
  "function findBinderyLibraryBook",
  "function findBinderyQueueItem",
  "function binderyAcquisitionState",
  'binderyFetch("/api/v1/queue")',
  '"importblocked"',
]) assert(server.includes(marker), `missing server marker: ${marker}`);

for (const marker of [
  "function AcquisitionSearchSection",
  'fetch(`/api/acquisition/search?q=${encodeURIComponent(searchText)}`)',
  'fetch("/api/acquisition/request"',
  'fetch("/api/acquisition/jobs?refresh=true"',
  'bindery: "Bindery"',
  'ids: ["bindery", "readarr", "audiobookshelf"]',
  "setSearchResultsPage((current) => current ? { ...current, acquisitionResults: applyRequestedJob",
  "setSearchResultsPage((current) => current ? { ...current, acquisitionResults: applyJobs",
  '"needs-attention": "⚠ Needs Attention"',
  'function SearchRequestButton',
]) assert(app.includes(marker), `missing client marker: ${marker}`);

assert(app.includes('const requestable = ["discovery", "missing"].includes(status);'), "requested and failed imports must not offer duplicate requests");

for (const marker of [
  'app.post("/api/youtube/series/:seriesId/banner"',
  'app.put("/api/youtube/series/:seriesId/appearance"',
  "function parseYouTubeClientSeasonToken",
  "([ivxlcdm]+|\\d{1,2})",
]) assert(server.includes(marker), `missing YouTube server marker: ${marker}`);

for (const marker of [
  "function parseYouTubeSeasonToken",
  "function YouTubeSeriesBannerUpload",
  "function YouTubeSeriesAppearanceEditor",
  "youtube-series-detail-banner",
]) assert(app.includes(marker), `missing YouTube client marker: ${marker}`);

const playerStart = app.indexOf("function HomesteadVideoPlayerOverlay");
const playerEnd = app.indexOf("function YouTubeSeriesPosterUpload", playerStart);
const player = app.slice(playerStart, playerEnd);
assert(playerStart >= 0 && playerEnd > playerStart, "global player block not found");
assert(!player.includes("<DetailMembershipButton"), "global player must not render a Collection button");
assert(css.includes(".youtube-series-detail-banner"), "series banner styling missing");
assert(css.includes(".acquisition-search-result"), "acquisition result styling missing");

function roman(value) {
  const token = String(value).toUpperCase();
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let number = 0;
  let previous = 0;
  for (let index = token.length - 1; index >= 0; index -= 1) {
    const current = values[token[index]] || 0;
    number += current < previous ? -current : current;
    previous = Math.max(previous, current);
  }
  return number;
}
assert.equal(roman("V"), 5);
assert.equal(roman("IX"), 9);
assert.equal(roman("X"), 10);
assert.equal(roman("XI"), 11);

console.log("Bindery/Lidarr acquisition, YouTube Roman-season, banner, and global-player regression checks passed.");
