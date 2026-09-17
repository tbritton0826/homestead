const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const server = read("server.cjs");
const app = read("src/App.jsx");
const css = read("src/App.css");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.57-pass.cjs"));
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.58-pass.cjs"));

// Direct browser-playable files advertise real byte ranges. Compatibility
// streams probe full duration and accept an absolute restart point for seek.
assert(server.includes('res.setHeader("Accept-Ranges", "bytes")'));
assert(server.includes('res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`)'));
assert(server.includes('app.get("/api/media/probe", homesteadAccess.authorizeFile'));
assert(server.includes('spawn("ffprobe"'));
assert(server.includes('...(start > 0 ? ["-ss", String(start)] : [])'));
assert(server.includes('app.get("/api/media/transcode", homesteadAccess.authorizeFile'));
assert(app.includes('fetch(`/api/media/probe?path=${encodeURIComponent(sourcePath)}`'));
assert(app.includes('resumeTime={savedTime}'));
assert(app.includes('startOffset + event.currentTarget.currentTime'));
assert(app.includes('className="compatibility-video-controls"'));
assert(app.includes('const openingReset ='));
assert(css.includes('.compatibility-video-controls'));

// Live channels use EPG start/stop times for the finite program progress bar.
assert(app.includes('<LiveTvPlayer channel={selectedChannel} program={selectedNowProgram} />'));
assert(app.includes('const programDuration ='));
assert(app.includes('className="live-tv-epg-progress"'));
assert(css.includes('.live-tv-epg-progress-track'));

// A deliberate missing-metadata fetch now persists the merged result and its
// provenance. Complete bra sizes supersede incomplete cup-only fallbacks.
assert(app.includes('saveToProfile: Boolean(person?.id || person?.name || person?.title)'));
assert(app.includes('data.saveResult?.metadata'));
assert(server.includes('metadataFieldSources: aggregation.fieldSources'));
assert(server.includes('const replacesIncompleteBra ='));
const braHelperStart = server.indexOf('function normalizeAdultBraDetails');
const braHelperEnd = server.indexOf('function augmentAdultBodyMetadata', braHelperStart);
assert(braHelperStart >= 0 && braHelperEnd > braHelperStart);
const braHelpers = new Function(`${server.slice(braHelperStart, braHelperEnd)}; return { normalizeAdultBraDetails, isCompleteAdultBraSize };`)();
assert.deepEqual(braHelpers.normalizeAdultBraDetails("32B"), { braBand: "32", cupSize: "B", braSize: "32B", complete: true });
assert.deepEqual(braHelpers.normalizeAdultBraDetails("B", "32", "B"), { braBand: "32", cupSize: "B", braSize: "32B", complete: true });
assert.equal(braHelpers.isCompleteAdultBraSize("B"), false);
assert.equal(braHelpers.isCompleteAdultBraSize("32B"), true);

console.log("Homestead 0.6.8.58 playback duration, resume, Live TV EPG, and body metadata persistence checks passed.");
