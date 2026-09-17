const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const add = fs.readFileSync(path.join(root, "src", "components", "adult", "AddAdultProfileModal.jsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "library-watch-worker.cjs"), "utf8");

for (const expected of [
  'app.get("/api/adult/source-packs"',
  'app.post("/api/adult/profiles/create", homesteadAccess.requireAdmin',
  'app.get("/api/metadata/adult/approvals"',
  'app.post("/api/metadata/adult/approvals/:approvalId/decision"',
  'activityType: "metadata-refresh"',
  'activityType: "metadata-approval"',
  'setTimeout(startLibraryWatchWorker, 1500).unref()',
  'Profile folders must stay inside the configured Adult library root.',
]) assert(server.includes(expected), `missing server behavior: ${expected}`);

const listenBlock = server.slice(server.indexOf("app.listen(PORT"), server.indexOf('process.once("SIGTERM"'));
assert(!listenBlock.includes("startMovieLibraryWatcher"));
assert(!listenBlock.includes("startTvLibraryWatcher"));
assert(!listenBlock.includes("fs.readdirSync"));
assert(worker.includes("fs.promises.readdir"));

for (const expected of [
  'function ActivityCenter',
  'reviewMetadataApproval',
  'metadata-approval',
  'Activity & Notifications',
  'function AdultPersonBrowsePage',
  'AdultPersonSourceChips',
  'app-ribbon-activity-button',
]) assert(app.includes(expected), `missing UI behavior: ${expected}`);

for (const expected of [
  '["search", "🔎", "Search"]',
  '["social", "@", "Social (Optional)"]',
  '["summary", "✓", "Summary"]',
  'Bra Band',
  'Cup Size',
  'Link an existing folder or choose a destination',
]) assert(add.includes(expected), `missing Add workflow behavior: ${expected}`);
assert(!add.includes('tab === "metadata"'));
assert(!add.includes('tab === "preview"'));
console.log("Homestead 0.5.3 person discovery and Activity Center regression checks: PASSED");
