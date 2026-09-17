const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const lock = require(path.join(root, "package-lock.json"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const scanner = fs.readFileSync(path.join(root, "scripts", "scanners", "scan-youtube.js"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const mirroredNextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.61-pass.cjs"));
assert.match(nextVersion, /version: "0\.6\.8\.64"/);
assert.match(mirroredNextVersion, /version: "0\.6\.8\.64"/);

assert(scanner.includes("const folders = parts.slice(0, -1)"));
assert(scanner.includes("folderSeason"));
assert(scanner.includes("episodeNumber: parseEpisodeNumber(title)"));
assert(app.includes("getYouTubeEpisodeNumber"));
assert(app.includes("cleanYouTubeEpisodeTitle(video, seriesName)"));
assert(app.includes("parseYouTubeSeasonToken(folderMatch?.[1])"));

assert(app.includes("CalendarFilterViewPanel"));
assert(app.includes("calendarHiddenSonarrShows"));
assert(app.includes("Sonarr shows"));
assert(app.includes("filterSortCount"));
assert(nextVersion.includes("calendarKindVisibility"));
assert(nextVersion.includes("calendarPersonFilter"));
assert(css.includes("calendar-filter-view-modal"));

assert(server.includes("syncFamilyScheduleSidecars"));
assert(server.includes('path.join(familyScheduleMetadataRoot, "people", key, "schedule.json")'));
assert(server.includes('path.join(familyScheduleMetadataRoot, "online", category, "metadata.json")'));

assert(app.includes("ProfileFamilyPanel"));
assert(app.includes('relationshipType="') === false);
assert(server.includes('/api/adult/profiles/relationships'));
assert(server.includes("Family profiles linked with reciprocal relationships."));

assert(server.includes("private, no-cache, max-age=0, must-revalidate"));
assert(server.includes("artworkVersion: Date.parse(now)"));
assert(app.includes("detail.action === \"poster\" ? assignedArtwork"));

console.log("Homestead 0.6.8.61 calendar Filter & View, folder-first YouTube parsing, schedule sidecars, reciprocal family links, and artwork refresh checks passed.");
