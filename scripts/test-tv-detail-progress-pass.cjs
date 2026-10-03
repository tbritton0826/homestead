const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const scanner = fs.readFileSync(path.join(root, "scripts/scanners/scan-media.cjs"), "utf8");

[
  "function MediaPersonDetailPage",
  "homestead-person-open",
  "homestead-media-open",
  "tvDownloadSeasons",
  "View season progress",
  "Open Celebrity Profile",
  "+ Create Celebrity Profile",
].forEach((marker) => assert.ok(app.includes(marker), marker));

assert.ok(server.includes('/api/integrations/seerr/person/:tmdbId'), "Seerr person route");
assert.ok(scanner.includes('libraryId === "tv" && identityYear'), "year-qualified TV identity");
assert.ok(css.includes(".tv-download-progress-modal"), "download overlay styles");
assert.ok(css.includes("grid-auto-columns: minmax(118px, 138px)"), "compact ribbons");
console.log("Homestead 0.5.6 TV detail and progress regression checks: PASSED");
