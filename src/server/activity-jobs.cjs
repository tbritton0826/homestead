const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, filePath);
}

function clampProgress(progress = {}) {
  const total = Math.max(0, Number(progress.total || 0));
  const current = Math.max(0, Number(progress.current || 0));
  const percent = total > 0
    ? Math.min(100, Math.max(0, Math.round((current / total) * 100)))
    : Math.min(100, Math.max(0, Number(progress.percent || 0)));
  return {
    current,
    total,
    percent,
    label: String(progress.label || "").trim(),
    detail: String(progress.detail || "").trim(),
  };
}

function normalizeItem(item = {}) {
  return {
    id: String(item.id || ""),
    activityType: String(item.activityType || "background-job"),
    status: String(item.status || "queued"),
    title: String(item.title || "Background task"),
    libraryId: String(item.libraryId || "system"),
    source: String(item.source || "Homestead"),
    provider: String(item.provider || item.source || "Homestead"),
    notes: String(item.notes || item.message || ""),
    progress: clampProgress(item.progress || {}),
    sources: Array.isArray(item.sources) ? item.sources.slice(0, 100) : [],
    proposal: item.proposal && typeof item.proposal === "object" ? item.proposal : null,
    result: item.result && typeof item.result === "object" ? item.result : null,
    error: String(item.error || ""),
    cancellable: item.cancellable === true,
    retryable: item.retryable !== false,
    initiatedBy: item.initiatedBy && typeof item.initiatedBy === "object" ? item.initiatedBy : {},
    createdAt: item.createdAt || new Date().toISOString(),
    startedAt: item.startedAt || "",
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    completedAt: item.completedAt || "",
  };
}

function createActivityJobStore({ filePath, maxItems = 2000, now = () => new Date().toISOString() } = {}) {
  if (!filePath) throw new Error("Activity job storage path is required.");

  function read() {
    let items = [];
    try {
      items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      items = [];
    }
    return (Array.isArray(items) ? items : []).map(normalizeItem);
  }

  function write(items = []) {
    const normalized = items.map(normalizeItem).slice(-maxItems);
    atomicWriteJson(filePath, normalized);
    return normalized;
  }

  function mutate(id, updater) {
    const items = read();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    items[index] = normalizeItem(updater({ ...items[index] }) || items[index]);
    write(items);
    return items[index];
  }

  function create(input = {}) {
    const timestamp = now();
    const item = normalizeItem({
      ...input,
      id: input.id || `activity-job-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      startedAt: input.status === "processing" ? timestamp : input.startedAt || "",
    });
    const items = read();
    items.push(item);
    write(items);
    return item;
  }

  function update(id, patch = {}) {
    return mutate(id, (current) => ({
      ...current,
      ...patch,
      progress: patch.progress ? { ...current.progress, ...patch.progress } : current.progress,
      updatedAt: now(),
    }));
  }

  function complete(id, result = {}, notes = "") {
    return update(id, {
      status: "completed",
      result,
      notes: notes || undefined,
      completedAt: now(),
      progress: { percent: 100, ...(result.progress || {}) },
      error: "",
    });
  }

  function fail(id, error, result = {}) {
    return update(id, {
      status: "failed",
      error: String(error?.message || error || "Background task failed."),
      result,
      completedAt: now(),
    });
  }

  function recoverInterrupted() {
    const items = read();
    let changed = false;
    const recovered = items.map((item) => {
      if (item.status !== "processing") return item;
      changed = true;
      return normalizeItem({
        ...item,
        status: "needs-attention",
        error: item.error || "Homestead restarted while this task was running. Review it and retry if needed.",
        notes: item.notes || "Interrupted by a Homestead restart.",
        updatedAt: now(),
        completedAt: now(),
      });
    });
    if (changed) write(recovered);
    return recovered;
  }

  function reconcileSkippedLibraryScans() {
    const items = read();
    let changed = 0;
    const reconciled = items.map((item) => {
      const isWatcherScan = item.activityType === "library-scan"
        && String(item.source || "").toLowerCase() === "library watcher";
      const isKnownBusyError = /^(?:a full )?media-library scan is already running\.?$/i.test(String(item.error || "").trim());
      if (item.status !== "failed" || !isWatcherScan || !isKnownBusyError) return item;
      changed += 1;
      return normalizeItem({
        ...item,
        status: "completed",
        notes: "Skipped because another media scan was already running. No media failed.",
        result: { ...(item.result || {}), skippedBecauseBusy: true },
        error: "",
        progress: { ...item.progress, percent: 100, label: "Skipped duplicate scan" },
        updatedAt: now(),
        completedAt: item.completedAt || now(),
      });
    });
    if (changed) write(reconciled);
    return changed;
  }

  function remove(id) {
    const items = read();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    write(next);
    return true;
  }

  function summary(items = read()) {
    return {
      count: items.length,
      needsAttentionCount: items.filter((item) => ["queued", "pending", "needs-attention", "failed"].includes(item.status)).length,
      activeCount: items.filter((item) => item.status === "processing").length,
      approvalCount: items.filter((item) => item.activityType === "metadata-approval" && item.status === "needs-attention").length,
    };
  }

  return { read, write, create, update, complete, fail, recoverInterrupted, reconcileSkippedLibraryScans, remove, summary };
}

module.exports = { createActivityJobStore, normalizeItem, clampProgress };
