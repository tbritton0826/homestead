const fs = require("fs");
const path = require("path");

const state = {
  movies: { roots: [], watchers: new Map(), snapshot: new Map(), syncing: false },
  tv: { roots: [], watchers: new Map(), snapshot: new Map(), syncing: false },
};

// Artwork, metadata, and temporary sidecars are often written by scanners and
// media managers. Treating those writes as media changes creates a scan loop.
const MEDIA_PATTERN = /\.(mp4|m4v|mov|mkv|avi|webm)$/i;
const SIDECAR_PATTERN = /\.(?:jpe?g|png|webp|avif|gif|json|nfo|xml|srt|ass|sub|idx|tmp|part)$/i;

function send(message) {
  if (process.connected) process.send(message);
}

async function collectDirectories(roots = [], limit = 20000) {
  const directories = new Set();
  const pending = [...new Set(roots.filter(Boolean))];
  while (pending.length && directories.size < limit) {
    const directory = pending.pop();
    if (!directory || directories.has(directory)) continue;
    directories.add(directory);
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { send({ type: "warning", library: "system", message: `Unable to inspect ${directory}: ${error.message}` }); continue; }
    for (const entry of entries) if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
  }
  return Array.from(directories);
}

async function buildSnapshot(roots = [], limit = 200000) {
  const snapshot = new Map();
  const pending = [...new Set(roots.filter(Boolean))];
  while (pending.length && snapshot.size < limit) {
    const current = pending.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { pending.push(fullPath); continue; }
      if (!MEDIA_PATTERN.test(entry.name)) continue;
      try {
        const stat = await fs.promises.stat(fullPath);
        snapshot.set(fullPath, `${stat.size}:${Math.floor(stat.mtimeMs)}`);
      } catch {}
    }
  }
  return snapshot;
}

function snapshotChanged(previous, next) {
  if (!previous.size) return false;
  if (previous.size !== next.size) return true;
  for (const [filePath, signature] of next) if (previous.get(filePath) !== signature) return true;
  return false;
}

async function syncLibrary(library) {
  const target = state[library];
  if (!target || target.syncing) return;
  target.syncing = true;
  const startedAt = Date.now();
  try {
    const directories = await collectDirectories(target.roots, library === "tv" ? 20000 : 10000);
    const wanted = new Set(directories);
    for (const [folder, watcher] of target.watchers) {
      if (wanted.has(folder)) continue;
      watcher.close();
      target.watchers.delete(folder);
    }
    for (const folder of wanted) {
      if (target.watchers.has(folder)) continue;
      try {
        const watcher = fs.watch(folder, { persistent: false }, (eventType, filename) => {
          const changedName = String(filename || "");
          const isMediaFile = MEDIA_PATTERN.test(changedName);
          const isPossibleDirectoryRename = eventType === "rename" && (!changedName || !SIDECAR_PATTERN.test(changedName));
          if (isMediaFile || isPossibleDirectoryRename) {
            send({ type: "change", library, reason: `${eventType}${changedName ? `: ${changedName}` : ""}` });
          }
          if (eventType === "rename") setTimeout(() => syncLibrary(library), 1000).unref();
        });
        watcher.on("error", (error) => {
          target.watchers.delete(folder);
          send({ type: "warning", library, message: error.message });
        });
        target.watchers.set(folder, watcher);
      } catch (error) {
        send({ type: "warning", library, message: `Unable to watch ${folder}: ${error.message}` });
      }
    }
    send({ type: "status", library, watchedDirectoryCount: target.watchers.size, snapshotItems: target.snapshot.size, syncDurationMs: Date.now() - startedAt, state: "watching" });
  } finally {
    target.syncing = false;
  }
}

async function pollLibrary(library, { notify = true } = {}) {
  const target = state[library];
  if (!target) return;
  const startedAt = Date.now();
  const next = await buildSnapshot(target.roots, library === "tv" ? 200000 : 100000);
  const changed = snapshotChanged(target.snapshot, next);
  target.snapshot = next;
  if (changed && notify) send({ type: "change", library, reason: "poll detected add/remove/rename/replace" });
  send({ type: "status", library, watchedDirectoryCount: target.watchers.size, snapshotItems: next.size, pollDurationMs: Date.now() - startedAt, state: "watching" });
}

process.on("message", (message = {}) => {
  if (message.type === "configure") {
    state.movies.roots = Array.isArray(message.movies) ? message.movies : [];
    state.tv.roots = Array.isArray(message.tv) ? message.tv : [];
    Promise.all([syncLibrary("movies"), syncLibrary("tv")]).catch((error) => send({ type: "error", library: "system", message: error.message }));
    Promise.all([
      pollLibrary("movies", { notify: false }),
      pollLibrary("tv", { notify: false }),
    ]).catch((error) => send({ type: "error", library: "system", message: error.message }));
    return;
  }
  if (message.type === "baseline" && ["movies", "tv"].includes(message.library)) {
    pollLibrary(message.library, { notify: false }).catch((error) => send({ type: "error", library: message.library, message: error.message }));
  }
});

setInterval(() => {
  Promise.all([syncLibrary("movies"), syncLibrary("tv")]).catch((error) => send({ type: "error", library: "system", message: error.message }));
}, 60000).unref();

setInterval(() => {
  Promise.all([pollLibrary("movies"), pollLibrary("tv")]).catch((error) => send({ type: "error", library: "system", message: error.message }));
}, 300000).unref();

process.on("disconnect", () => process.exit(0));
send({ type: "ready" });
