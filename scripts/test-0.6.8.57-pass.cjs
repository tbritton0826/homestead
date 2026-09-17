const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const pkg = JSON.parse(read("package.json"));
const server = read("server.cjs");
const app = read("src/App.jsx");
const worker = read("scripts/library-watch-worker.cjs");
const musicSource = read("scripts/metadata/fetch-music-metadata.cjs");

assert.equal(pkg.version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.57-pass.cjs"));

// Library watching responds only to actual playable media changes, refreshes
// its snapshot after a scan, and does not start the retired duplicate watcher.
assert(worker.includes("const MEDIA_PATTERN = /\\.(mp4|m4v|mov|mkv|avi|webm)$/i"));
assert(worker.includes("const SIDECAR_PATTERN"));
assert(worker.includes('message.type === "baseline"'));
assert(worker.includes("pollLibrary(message.library, { notify: false })"));
assert(worker.includes("}, 300000).unref();"));
assert(server.includes('refreshLibraryWatchBaseline("movies")'));
assert(server.includes('refreshLibraryWatchBaseline("tv")'));
assert(server.includes("setTimeout(configureLibraryWatchWorker, 250).unref()"));
assert(!server.includes("setTimeout(syncMovieLibraryWatchers, 250)"));

// Album candidates and older saved matches receive a stable release-group
// cover URL. Missing Lidarr image arrays no longer create slow, doomed calls.
assert(musicSource.includes("coverartarchive.org/release-group/${match[0]}/front-500"));
assert(server.includes("musicReleaseGroupCoverUrl"));
assert(!server.includes('addSource("cover", { imagePath: `/api/v1/mediacover/album/${entityId}/cover-500.jpg` })'));
assert(app.includes("useMemo(() => loadHomesteadMetadataMatches(), [metadataMatchesVersion])"));
assert(app.includes("metadataMatchesVersion={metadataMatchesVersion}"));
assert(app.includes("const manualArtwork = getLocalApiFileUrl("));

const { musicBrainzReleaseGroupCoverUrl } = require("./metadata/fetch-music-metadata.cjs");
assert.equal(
  musicBrainzReleaseGroupCoverUrl("f5093c06-23e3-404f-aeaa-40f72885ee3a"),
  "https://coverartarchive.org/release-group/f5093c06-23e3-404f-aeaa-40f72885ee3a/front-500"
);

const celebrityTallFixture = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Person","name":"celebritytall"}</script>
</head><body><h1>Amber Heard Height, Weight, Measurements, Bra Size, Shoe Size</h1>
<table><tr><td>Height in Feet Inches</td><td>5 ft 7 in</td></tr>
<tr><td>Weight in Pounds</td><td>121 lbs</td></tr>
<tr><td>Body Measurements</td><td>34-27-34 in or 86-68.5-86 cm</td></tr>
<tr><td>Bra Size</td><td>32B</td></tr><tr><td>Feet/Shoe Size</td><td>8 (US)</td></tr>
<tr><td>Dress Size</td><td>10 (US)</td></tr><tr><td>Hair Color</td><td>Blonde</td></tr>
<tr><td>Eye Color</td><td>Blue</td></tr></table></body></html>`;

async function testCelebrityTallFallback() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => celebrityTallFixture,
  });
  try {
    const { searchCelebrityTallMetadata } = require("./metadata/fetch-adult-metadata.cjs");
    const results = await searchCelebrityTallMetadata("Amber Heard");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Amber Heard");
    assert.equal(results[0].height, "5 ft 7 in");
    assert.equal(results[0].weight, "121 lbs");
    assert.equal(results[0].measurementsRaw, "34-27-34");
    assert.equal(results[0].braSize, "32B");
    assert.equal(results[0].shoeSize, "US 8");
    assert.equal(results[0].dressSize, "US 10");
    assert.equal(results[0].fallbackOnly, true);
    assert.equal(results[0].requiresReview, true);
  } finally {
    global.fetch = originalFetch;
  }
}

testCelebrityTallFallback()
  .then(() => console.log("Homestead 0.6.8.57 library watch, music artwork, and CelebrityTall checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
