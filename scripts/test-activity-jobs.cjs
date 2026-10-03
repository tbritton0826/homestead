const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createActivityJobStore } = require("../src/server/activity-jobs.cjs");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-activity-jobs-"));
const filePath = path.join(testRoot, "activity-jobs.json");
let clock = 0;
const now = () => new Date(Date.UTC(2026, 7, 28, 2, clock++)).toISOString();

try {
  const store = createActivityJobStore({ filePath, now });
  const job = store.create({ activityType: "metadata-refresh", status: "processing", title: "Refresh performers", libraryId: "performers", progress: { current: 1, total: 4, label: "Checking profiles" } });
  assert.equal(job.progress.percent, 25);
  assert.equal(store.summary().activeCount, 1);

  store.update(job.id, { progress: { current: 3, total: 4, detail: "Two approvals ready" } });
  assert.equal(store.read()[0].progress.percent, 75);
  assert.equal(store.read()[0].progress.label, "Checking profiles");

  const approval = store.create({ activityType: "metadata-approval", status: "needs-attention", title: "Kenzie — 2 proposed changes", proposal: { patch: { pantySize: "12", braBand: "32" } } });
  assert.equal(store.summary().approvalCount, 1);
  assert.deepEqual(Object.keys(store.read().find((item) => item.id === approval.id).proposal.patch), ["pantySize", "braBand"]);

  store.complete(job.id, { progress: { current: 4, total: 4, label: "Complete" } }, "Done");
  assert.equal(store.summary().activeCount, 0);
  assert.equal(store.read().find((item) => item.id === job.id).progress.percent, 100);

  const interrupted = store.create({ activityType: "library-scan", status: "processing", title: "Movies scan" });
  store.recoverInterrupted();
  assert.equal(store.read().find((item) => item.id === interrupted.id).status, "needs-attention");
  assert.match(store.read().find((item) => item.id === interrupted.id).error, /restarted/i);

  const skipped = store.create({ activityType: "library-scan", status: "failed", title: "Automatic Movies scan", libraryId: "movies", source: "Library watcher" });
  store.fail(skipped.id, new Error("A full media-library scan is already running."));
  const genuineFailure = store.create({ activityType: "library-scan", status: "failed", title: "Automatic TV scan", libraryId: "tv", source: "Library watcher", error: "Permission denied" });
  assert.equal(store.reconcileSkippedLibraryScans(), 1);
  assert.equal(store.read().find((item) => item.id === skipped.id).status, "completed");
  assert.equal(store.read().find((item) => item.id === skipped.id).result.skippedBecauseBusy, true);
  assert.equal(store.read().find((item) => item.id === genuineFailure.id).status, "failed");
  assert.equal(store.summary().needsAttentionCount, 3);
  console.log("Persistent Activity Center job tests: PASSED");
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
