const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const scanner = require("./scanners/scan-media.cjs");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.cjs"), "utf8");

assert.equal(scanner.cleanYouTubeArchiveTitle("[abc123] S01E02 - An_Episode.mp4"), "An Episode");
const normalized = scanner.normalizeYouTubeVideo({ filename: "S01E04 - Clean_Title.mp4", metadata: { publishedAt: "2026-08-01T12:00:00Z", thumbnailUrl: "https://example.invalid/thumb.jpg" } }, { id: "creator", name: "Creator" });
assert.equal(normalized.title, "Clean Title");
assert.equal(normalized.creatorId, "creator");
assert.equal(normalized.thumb, "https://example.invalid/thumb.jpg");

assert.match(app, /function buildYouTubeSeriesCatalog/, "YouTube series aggregation is missing");
assert.match(app, /All creators interleaved by release date\./, "Series timeline must combine creators chronologically");
assert.match(app, /function YouTubeArtwork/, "Thumbnail fallback component is missing");
assert.match(app, /function YouTubeSeriesDetail/, "Clickable series detail is missing");
assert.match(app, /Upload Series Poster/, "Manual series poster upload is missing");
assert.match(app, /library="youtube"/, "Per-video collection membership is missing");
assert.match(app, /function HomesteadVideoPlayerOverlay/, "Shared global video player is missing");
assert.doesNotMatch(app.slice(app.indexOf("function YouTubeCreatorDetail"), app.indexOf("function PhotosPage")), /youtube-player-icon-button/, "Duplicate YouTube fullscreen button returned");
assert.match(app, /\{hasMembership \? "✓" : "＋"\}/, "Membership buttons must show current state");
assert.match(app, /\{ id: "collection-display", label: "Sort \/ Filter", icon: "⇅" \}/, "Collection sort and filter header action is missing");
assert.match(app, /\{ id: "collection-manage", label: "Manage", icon: "⋯" \}/, "Collection management header action is missing");

assert.match(server, /\/api\/youtube\/channel\/:channelId\/metadata/, "Channel metadata API is missing");
assert.match(server, /function buildYouTubeClientIndex/, "YouTube index response must enrich raw scanner records");
assert.match(server, /\/api\/youtube\/series\/:seriesId\/poster/, "Series artwork API is missing");
assert.match(server, /\["movies", "tv", "books", "youtube"\]/, "YouTube collection persistence is missing");
assert.match(css, /\.homestead-global-player-card/, "Global player styling is missing");
assert.match(css, /\.collection-ribbon-overlay/, "Collection overlay styling is missing");

console.log("Homestead 0.6.0 YouTube and global player tests: PASSED");
