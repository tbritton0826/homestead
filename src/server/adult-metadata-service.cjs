const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function valueLabel(value) {
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim() || "—";
}

function normalizeEffectiveAt(value = "", precision = "day") {
  const raw = String(value || "").trim();
  if (precision === "unknown") return { effectiveAt: "", effectivePrecision: "unknown" };
  if (precision === "year" && /^\d{4}$/.test(raw)) return { effectiveAt: `${raw}-01-01T12:00:00.000Z`, effectivePrecision: "year" };
  if (precision === "month" && /^\d{4}-\d{2}$/.test(raw)) return { effectiveAt: `${raw}-01T12:00:00.000Z`, effectivePrecision: "month" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { effectiveAt: `${raw}T12:00:00.000Z`, effectivePrecision: "day" };
  const parsed = new Date(raw || Date.now());
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid effective date.");
  return { effectiveAt: parsed.toISOString(), effectivePrecision: precision === "time" ? "time" : "day" };
}

function compareValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => String(entry).trim()));
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim();
}

function buildChanges(current = {}, patch = {}, labels = {}, hiddenFields = []) {
  const hidden = new Set(hiddenFields);
  return Object.entries(patch)
    .filter(([field, value]) => compareValue(current[field]) !== compareValue(value))
    .map(([field, value]) => ({ field, label: labels[field] || field, previous: current[field] ?? "", value, hiddenFromTimeline: hidden.has(field) }));
}

function buildTimelineEntries({ changes = [], effectiveAt = "", effectivePrecision = "day", recordedAt = new Date().toISOString(), source = "Manual update", note = "", correction = false, combineChanges = true, showRecordedAt = true, actor = {} } = {}) {
  const visible = changes.filter((change) => !change.hiddenFromTimeline);
  if (!visible.length) return [];
  const allBody = visible.every((change) => change.timelineType === "body");
  const title = correction ? "Metadata corrected" : allBody ? "Body sizing updated" : "Profile metadata updated";
  const makeEntry = (entryChanges, suffix = "") => ({
    id: `metadata-change-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${suffix}`,
    type: allBody ? "body" : "metadata",
    title: combineChanges ? title : `${entryChanges[0].label} updated`,
    date: effectiveAt || recordedAt,
    effectiveAt,
    effectivePrecision,
    recordedAt,
    showRecordedAt: showRecordedAt !== false,
    source: String(source || "Manual update"),
    correction: Boolean(correction),
    note: String(note || "").trim(),
    actor: { id: actor.id || "", name: actor.displayName || actor.username || actor.name || "" },
    changes: entryChanges.map((change) => ({ ...change, previousLabel: valueLabel(change.previous), valueLabel: valueLabel(change.value) })),
  });
  return combineChanges ? [makeEntry(visible)] : visible.map((change, index) => makeEntry([change], `-${index}`));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, filePath);
}

function createRevertPatch(entry = {}, current = {}) {
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (!changes.length) throw new Error("This timeline event does not contain stored previous values.");
  const patch = {};
  const conflicts = [];
  for (const change of changes) {
    if (!change.field) continue;
    if (compareValue(current[change.field]) !== compareValue(change.value)) conflicts.push(change.field);
    patch[change.field] = change.previous ?? "";
  }
  return { patch, conflicts };
}

module.exports = { valueLabel, normalizeEffectiveAt, buildChanges, buildTimelineEntries, atomicWriteJson, createRevertPatch, compareValue };
