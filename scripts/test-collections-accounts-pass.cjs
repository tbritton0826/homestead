const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.cjs"), "utf8");
const access = fs.readFileSync(path.join(__dirname, "..", "src", "server", "next-version.cjs"), "utf8");

assert.match(app, /function getSharedTimelineEpisodeThumbnailInfo/, "MCU timeline needs a globally scoped thumbnail helper");
assert.match(app, /const thumbnailInfo = getSharedTimelineEpisodeThumbnailInfo\(episode, showFiles\)/, "MCU cards must call the shared helper");
assert.doesNotMatch(app.slice(app.indexOf("function SharedTimelineEpisodeCard"), app.indexOf("function SharedCollectionTimelineCardsView")), /getEpisodeThumbnailInfo\(/, "MCU cards must not call the TV-detail-only helper");

assert.match(app, /function makeSharedBookCollectionItems/, "Books need collection-ready records");
assert.match(app, /books\.map\(\(item\) => makeSharedCollectionItem\(item, "books"\)\)/, "Collection builder must include Books");
assert.match(app, /library: \["movies", "tv", "books", "youtube"\]/, "Unavailable Book and YouTube references must survive collection refreshes");
assert.match(server, /\["movies", "tv", "books", "youtube"\]\.includes\(requestedLibrary\)/, "Server must persist Book and YouTube collection members");

assert.match(app, /const \[dragIndex, setDragIndex\] = useState\(null\)/, "Exact watch order needs drag state");
assert.match(app, /draggable key=\{row\.editorId/, "Individual episode rows must be draggable");
assert.match(app, /manualOrder: true/, "Manual watch orders must remain authored rather than air-date sorted");
assert.match(app, /const addBook = \(item\)/, "Books must be insertable into a watch order");

assert.match(server, /app\.post\("\/api\/collections\/:collectionId\/background"/, "Each collection needs its own background upload");
assert.match(app, /--collection-background-image/, "Collection details must render their own background");
assert.match(css, /\.shared-collection-detail\.has-collection-background::before/, "Collection background styling is missing");

assert.match(server, /const userWatchlistsDir = path\.join\(dataDir, "watchlists", "users"\)/, "Watchlists must be stored per account");
assert.match(server, /app\.get\("\/api\/watchlist", homesteadAccess\.requireSession/, "Watchlist reads must be authenticated");
assert.match(server, /app\.post\("\/api\/watchlist", homesteadAccess\.requireSession/, "Watchlist writes must be authenticated");
assert.match(access, /youtube: \["youtube", "youtubeCreators"\]/, "YouTube data must participate in account filtering");
assert.match(access, /This library is not assigned to your account/, "Local file access must enforce library assignment");
assert.match(server, /app\.post\("\/api\/metadata\/matches\/merge"/, "Legacy browser poster matches need a persistent migration route");
const manifestStart = server.indexOf("function sendHomesteadManifest");
const manifestEnd = server.indexOf("function escapeHomesteadHtml", manifestStart);
assert.ok(manifestStart >= 0 && manifestEnd > manifestStart, "Manifest handler is missing");
assert.match(server.slice(manifestStart, manifestEnd), /res\.status\(200\).*application\/manifest\+json/s, "Manifest fallback must return a valid 200 response");

console.log("Homestead 0.5.8 collections and account isolation tests: PASSED");
