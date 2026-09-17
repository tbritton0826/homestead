const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appPath = require("node:path").join(__dirname, "..", "src", "App.jsx");
const app = fs.readFileSync(appPath, "utf8");

function sourceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return app.slice(startIndex, endIndex);
}

const context = {};
vm.createContext(context);
vm.runInContext(
  `${sourceBetween("function normalizeSharedSmartMatchText", "function normalizeTimelineMatchText")}
   ${sourceBetween("function normalizeTimelineMatchText", "function parseTimelineEpisodeSelection")}
   ${sourceBetween("function getSharedEpisodePlayablePath", "function normalizeSharedEpisodeCandidate")}
   this.buildTimelineOwnedItemIndex = buildTimelineOwnedItemIndex;
   this.findTimelineOwnedItem = findTimelineOwnedItem;
   this.getSharedEpisodePlayablePath = getSharedEpisodePlayablePath;`,
  context
);

const cyclic = {};
cyclic.file = cyclic;
assert.equal(context.getSharedEpisodePlayablePath(cyclic), "", "Circular media wrappers must terminate safely");

let deep = { path: "/media/tv/Test/Season 1/Test S01E01.mkv" };
for (let index = 0; index < 120; index += 1) deep = { file: deep };
assert.equal(
  context.getSharedEpisodePlayablePath(deep),
  "/media/tv/Test/Season 1/Test S01E01.mkv",
  "Deep media wrappers must resolve without recursive stack growth"
);

const items = [
  { library: "movies", sourceId: "iron-man", title: "Iron Man", files: [{ name: "Iron.Man.2008.mkv" }] },
  { library: "movies", sourceId: "iron-man-2", title: "Iron Man 2", files: [] },
  { library: "tv", sourceId: "loki", title: "Loki", files: [] },
];
const index = context.buildTimelineOwnedItemIndex(items);
assert.equal(context.findTimelineOwnedItem({ title: "Iron Man", type: "movie" }, index)?.sourceId, "iron-man");
assert.equal(context.findTimelineOwnedItem({ title: "Loki", type: "tv" }, index)?.sourceId, "loki");
assert.equal(context.findTimelineOwnedItem({ title: "Loki", type: "movie" }, index), null);

assert.match(app, /playableVideoPattern/, "Collection episodes must filter to playable video files");
assert.match(app, /const byCode = new Map\(\)/, "Collection episodes must deduplicate by season and episode");
assert.match(app, /<em>\{row\.info\.title \|\| "Episode"\}<\/em>/, "Episode rows must show the clean episode title");
assert.match(app, /const itemIndex = useMemo\(\(\) => buildTimelineOwnedItemIndex\(items\), \[items\]\)/, "MCU timelines must build one bounded item index per render input");

console.log("Collection episode cleanup and bounded MCU timeline tests: PASSED");
