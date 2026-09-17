const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function requireText(source, text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

if (!/^0\.6\.8(?:\.|$)/.test(pkg.version)) throw new Error(`Expected a 0.6.8 release, found ${pkg.version}`);

requireText(app, "function normalizeYouTubeSeason", "YouTube season normalizer");
requireText(app, ".replace(/\\b[a-f0-9]{12,}\\b/gi, \"\")", "YouTube trailing hash cleanup");
requireText(app, "normalizeYouTubeSeason(video, seriesName)", "series season repair");
requireText(server, "normalizeYouTubeClientSeason(video, seriesName)", "server season repair");
requireText(server, "/api/youtube/channel/:channelId/artwork/:kind", "creator artwork cache route");
requireText(server, "normalizedCreator.poster || creator.poster", "local-first creator poster");

const seasonSource = app.match(/function normalizeYouTubeSeason[\s\S]*?\n}\n/)?.[0];
if (!seasonSource) throw new Error("Could not extract YouTube season normalizer for behavior test");
const tokenSource = app.match(/function parseYouTubeSeasonToken[\s\S]*?\n}\n/)?.[0];
if (!tokenSource) throw new Error("Could not extract YouTube season-token parser for behavior test");
const normalizeSeason = vm.runInNewContext(`${tokenSource}\n${seasonSource}\nnormalizeYouTubeSeason`);
const repairedSeason = normalizeSeason({
  title: "Hermitcraft 6 Episode 150 END OF THE SEASON 69296c81985ccb35",
  season: "Season 69296",
}, "Hermitcraft");
if (repairedSeason !== "Season 6") throw new Error(`Expected Hermitcraft Season 6, found ${repairedSeason}`);

requireText(app, "function MusicSongRow", "compact song row");
requireText(css, ".music-song-list", "compact song layout CSS");
requireText(app, "playbackQueue", "persistent audio queue");
requireText(app, "onEnded={() => advanceQueue(1, true)}", "automatic next track");
requireText(app, "No lyrics file was found beside this track.", "working lyrics panel");
requireText(app, "setActionHandler?.(\"nexttrack\"", "vehicle/media-session next track");
if (/homestead-audio-expanded-actions[\s\S]{0,500}>Metadata</.test(app)) throw new Error("Music player Metadata action returned");

requireText(app, "function BookDetailOverlay", "book detail overlay");
requireText(app, "function BookAuthorOverlay", "author overlay");
requireText(app, "const books = useMemo", "cached normalized books");
requireText(app, "book-reader-pdf", "PDF reader");
requireText(app, "kind: \"audiobook\"", "audiobook chapter queue");
requireText(server, "max-age=86400, stale-while-revalidate=604800", "media artwork cache");
requireText(css, ".book-detail-overlay", "book overlay CSS");

console.log("Homestead 0.6.8 retained Music and Books regression tests: PASSED");
