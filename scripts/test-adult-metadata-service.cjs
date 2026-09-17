const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  normalizeEffectiveAt,
  buildChanges,
  buildTimelineEntries,
  atomicWriteJson,
  createRevertPatch,
} = require("../src/server/adult-metadata-service.cjs");

const effective = normalizeEffectiveAt("2026-08-13", "day");
assert.equal(effective.effectiveAt, "2026-08-13T12:00:00.000Z");
assert.equal(normalizeEffectiveAt("2026-08", "month").effectivePrecision, "month");
assert.equal(normalizeEffectiveAt("", "unknown").effectiveAt, "");

const current = { pantySize: "M", braBand: "34", cupSize: "B", braSize: "34B" };
const patch = { pantySize: "12", braBand: "32", braSize: "32B" };
const changes = buildChanges(current, patch, { pantySize: "Panty size", braBand: "Bra band", braSize: "Bra size" }, ["braSize"])
  .map((change) => ({ ...change, timelineType: "body" }));
const entries = buildTimelineEntries({ changes, effectiveAt: effective.effectiveAt, recordedAt: "2026-08-27T15:00:00.000Z", source: "Manual update", combineChanges: true });
assert.equal(entries.length, 1);
assert.equal(entries[0].title, "Body sizing updated");
assert.deepEqual(entries[0].changes.map((change) => change.field), ["pantySize", "braBand"]);
assert.equal(entries[0].effectiveAt, "2026-08-13T12:00:00.000Z");
assert.equal(entries[0].recordedAt, "2026-08-27T15:00:00.000Z");
assert.equal(buildTimelineEntries({ changes, effectiveAt: effective.effectiveAt, combineChanges: false }).length, 2);

const revert = createRevertPatch(entries[0], { pantySize: "12", braBand: "32" });
assert.deepEqual(revert.patch, { pantySize: "M", braBand: "34" });
assert.deepEqual(revert.conflicts, []);
assert.deepEqual(createRevertPatch(entries[0], { pantySize: "14", braBand: "32" }).conflicts, ["pantySize"]);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-metadata-test-"));
const target = path.join(temporaryRoot, "metadata.json");
atomicWriteJson(target, { ok: true, timeline: entries });
assert.equal(JSON.parse(fs.readFileSync(target, "utf8")).timeline[0].title, "Body sizing updated");
console.log("Adult metadata service tests: PASSED");
