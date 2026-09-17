const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(pkg.version, /^0\.6\.8(?:\.|$)/);

function functionSource(name) {
  const start = app.indexOf(`function ${name}`);
  assert(start >= 0, `missing function: ${name}`);
  const signatureEnd = app.indexOf(") {", start);
  assert(signatureEnd >= 0, `missing function body: ${name}`);
  const brace = signatureEnd + 2;
  let depth = 0;
  for (let index = brace; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const helpers = new Function(`${functionSource("encodePublicMediaPath")}
${functionSource("getPlayableMediaUrl")}
${functionSource("getAlphabetSortValue")}
${functionSource("getAlphabetBucket")}
${functionSource("cleanMusicTrackTitle")}
${functionSource("findLocalMusicAlbumArtwork")}
${functionSource("normalizeLocalMusicSong")}
return { getAlphabetSortValue, getAlphabetBucket, cleanMusicTrackTitle, normalizeLocalMusicSong };`)();

assert.equal(helpers.getAlphabetSortValue("The Beatles"), "Beatles");
assert.equal(helpers.getAlphabetBucket("The Beatles"), "B");
assert.equal(helpers.cleanMusicTrackTitle("01 - Luke Bryan - That's My Kind of Night", "Luke Bryan"), "That's My Kind of Night");
assert.equal(helpers.cleanMusicTrackTitle("1-02 - Test Artist - Second Song", "Test Artist"), "Second Song");

const audio = {
  type: "audio",
  name: "01 - Luke Bryan - That's My Kind of Night.mp3",
  path: "/media/music/Luke Bryan/Crash My Party...Again (2023)/01 - Luke Bryan - That's My Kind of Night.mp3",
};
const lyrics = {
  type: "text",
  name: "01 - Luke Bryan - That's My Kind of Night.lrc",
  path: "/media/music/Luke Bryan/Crash My Party...Again (2023)/01 - Luke Bryan - That's My Kind of Night.lrc",
};
const normalized = helpers.normalizeLocalMusicSong(audio, { name: "Luke Bryan" }, [audio, lyrics]);
assert.equal(normalized.title, "That's My Kind of Night", "filename must supply the song title");
assert.equal(normalized.album, "Crash My Party...Again (2023)", "parent folder must remain the album");
assert.equal(normalized.artist, "Luke Bryan");
assert.equal(normalized.lyricsFile.path, lyrics.path);

for (const marker of [
  "originalPlaybackQueue",
  "queueShuffled",
  'key={progressKey}',
  'onEnded={() => advanceQueue(1, true)}',
  'activePanel ? "panel-open" : ""',
  "navigator.mediaSession.setPositionState?.",
  'grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))',
  ".homestead-audio-expanded.panel-open",
  "overflow-y: auto",
]) {
  assert(app.includes(marker) || css.includes(marker), `missing Music polish marker: ${marker}`);
}

const playerStart = app.indexOf("function GlobalAudioPlayer");
const playerEnd = app.indexOf("function ImageViewer", playerStart);
const player = app.slice(playerStart, playerEnd);
assert(playerStart >= 0 && playerEnd > playerStart, "global audio player block not found");
assert(!/>Metadata</.test(player), "Metadata must not return to the Music player");
assert(!/setActivePanel\(""\);/.test(player), "queue/lyrics panel must stay open across automatic track changes");

for (const marker of [
  'app.post("/api/integrations/lidarr/request-song"',
  'app.post("/api/acquisition/request"',
  "async function syncLocalMusicArtistsWithLidarr({ refreshMetadata = false } = {})",
  'app.post("/api/integrations/lidarr/link-local-artists"',
]) assert(server.includes(marker), `missing retained Lidarr marker: ${marker}`);

console.log("Homestead 0.6.8 Music title, alphabet, queue, lyrics, shuffle, and media-session checks: PASSED");
