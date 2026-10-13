"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const INDEX_FILES = ["metadata-matches.json", "media-index.json"];
const ARTWORK_FILES = ["poster.jpg", "fanart.jpg"];
const DAY = 24 * 60 * 60 * 1000;
const DEFAULTS = Object.freeze({ maxSnapshots: 20, maxAgeDays: 30, maxBytes: 5 * 1024 ** 3 });
const SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-zA-Z0-9-]+$/;

function failure(code) { return Object.assign(new Error(code), { code }); }
function positive(value, fallback, integer = false) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) throw failure("INVALID_RETENTION_SETTING");
  return number;
}
function settingsFromEnv(env = process.env) {
  return {
    maxSnapshots: positive(env.HOMESTEAD_ARTWORK_RECOVERY_MAX_SNAPSHOTS, DEFAULTS.maxSnapshots, true),
    maxAgeDays: positive(env.HOMESTEAD_ARTWORK_RECOVERY_MAX_AGE_DAYS, DEFAULTS.maxAgeDays),
    maxBytes: positive(env.HOMESTEAD_ARTWORK_RECOVERY_MAX_GB, 5) * 1024 ** 3,
  };
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw failure("UNSAFE_FILE");
  return stat;
}
function signature(file) {
  const stat = regular(file);
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}
function digest(file) {
  regular(file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, length));
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
}
function jsonObject(file) {
  regular(file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_SNAPSHOT_DATA");
  if (path.basename(file) === "media-index.json" && (!value.libraries || typeof value.libraries !== "object" || Array.isArray(value.libraries))) throw failure("INVALID_SNAPSHOT_DATA");
}

function syncFile(file) {
  regular(file);
  const descriptor = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function createArtworkRecovery({ dataDir, settings = settingsFromEnv(), logger = console, now = Date.now, timers = globalThis } = {}) {
  if (!dataDir) throw failure("DATA_DIRECTORY_REQUIRED");
  const configuredData = path.resolve(dataDir);
  const root = path.join(configuredData, "artwork-recovery");
  const limits = {
    maxSnapshots: positive(settings.maxSnapshots, DEFAULTS.maxSnapshots, true),
    maxAgeDays: positive(settings.maxAgeDays, DEFAULTS.maxAgeDays),
    maxBytes: positive(settings.maxBytes, DEFAULTS.maxBytes),
  };
  let canonicalData, canonicalRoot, rootIdentity, timer, lockToken, locked = false;
  const hashes = new Map();
  const latest = new Map();
  const validSignatures = new Map();
  function log(event, values = {}) {
    // Deliberately omit source paths, URLs, reasons, and raw filesystem errors.
    try { logger.info?.(`[artwork-recovery] ${event}`, values); } catch { /* logging must not affect recovery */ }
  }
  function safeRoot(create = true) {
    if (!fs.existsSync(configuredData)) {
      if (!create) return false;
      fs.mkdirSync(configuredData, { recursive: true });
    }
    const resolvedData = fs.realpathSync(configuredData);
    if (canonicalData && canonicalData !== resolvedData) throw failure("RECOVERY_ROOT_CHANGED");
    canonicalData = resolvedData;
    if (!fs.existsSync(root)) {
      if (!create) return false;
      if (canonicalRoot) throw failure("RECOVERY_ROOT_CHANGED");
      fs.mkdirSync(root);
    }
    const stat = fs.lstatSync(root);
    const resolved = fs.realpathSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || resolved !== path.join(canonicalData, "artwork-recovery")) throw failure("UNSAFE_RECOVERY_ROOT");
    const identity = `${stat.dev}:${stat.ino}`;
    if ((canonicalRoot && canonicalRoot !== resolved) || (rootIdentity && rootIdentity !== identity)) throw failure("RECOVERY_ROOT_CHANGED");
    canonicalRoot = resolved; rootIdentity = identity;
    return true;
  }
  function child(name) {
    safeRoot();
    if (!name || name === "." || name === ".." || path.basename(name) !== name || /[/\\:]/.test(name)) throw failure("UNSAFE_SNAPSHOT_PATH");
    const target = path.resolve(root, name);
    if (path.dirname(target) !== path.resolve(root)) throw failure("UNSAFE_SNAPSHOT_PATH");
    return target;
  }
  function directory(name) {
    const target = child(name);
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(target) !== path.join(canonicalRoot, name)) throw failure("UNSAFE_SNAPSHOT_PATH");
    return target;
  }
  function acquire() {
    if (locked) throw failure("RECOVERY_BUSY");
    safeRoot();
    const lock = child(".lock");
    try { fs.mkdirSync(lock); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // A live process never loses its lock on a timer. Unknown owners fail closed.
      // Serialize stale-lock reclamation, then re-read the owner. Otherwise two
      // reclaimers could accidentally rename a newly acquired, live lock.
      const reclaimName = ".lock-reclaim";
      try { fs.mkdirSync(child(reclaimName)); } catch { throw failure("RECOVERY_BUSY"); }
      try {
        directory(".lock");
        const ownerFile = path.join(lock, "owner.json");
        regular(ownerFile);
        const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
        if (fs.readdirSync(lock).join("|") !== "owner.json") throw failure("RECOVERY_BUSY");
        if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) throw failure("RECOVERY_BUSY");
        try { process.kill(owner.pid, 0); throw failure("RECOVERY_BUSY"); }
        catch (probe) { if (probe.code !== "ESRCH") throw failure("RECOVERY_BUSY"); }
        // Rename the abandoned lock before removing its known file. No recursive delete.
        const abandonedName = `.abandoned-${crypto.randomUUID()}`;
        const abandoned = child(abandonedName);
        fs.renameSync(lock, abandoned);
        fs.unlinkSync(path.join(directory(abandonedName), "owner.json"));
        fs.rmdirSync(directory(abandonedName));
        fs.mkdirSync(lock);
      } catch { throw failure("RECOVERY_BUSY"); }
      finally { fs.rmdirSync(directory(reclaimName)); }
    }
    lockToken = crypto.randomUUID();
    try { fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, host: os.hostname(), token: lockToken }), { flag: "wx" }); }
    catch (error) { fs.rmdirSync(lock); throw error; }
    locked = true;
  }
  function release() {
    try {
      const lock = directory(".lock");
      regular(path.join(lock, "owner.json"));
      if (JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")).token !== lockToken) throw failure("RECOVERY_LOCK_CHANGED");
      fs.unlinkSync(path.join(lock, "owner.json")); fs.rmdirSync(lock);
    } finally { locked = false; }
  }
  function withLock(action) {
    acquire();
    try {
      const result = action();
      if (result && typeof result.then === "function") throw failure("ASYNC_RECOVERY_ACTION_NOT_SUPPORTED");
      return result;
    } finally { release(); }
  }
  function inspect(name) {
    if (!SNAPSHOT_NAME.test(name)) throw failure("UNRECOGNIZED_SNAPSHOT");
    const target = directory(name);
    const entries = fs.readdirSync(target);
    let bytes = 0;
    for (const entry of entries) {
      if (![...INDEX_FILES, ...ARTWORK_FILES, "backup.json", ".protected"].includes(entry)) throw failure("UNRECOGNIZED_SNAPSHOT");
      bytes += regular(path.join(target, entry)).size;
    }
    let manifest = null;
    if (entries.includes("backup.json")) {
      if (regular(path.join(target, "backup.json")).size > 65536) throw failure("INVALID_SNAPSHOT_MANIFEST");
      manifest = JSON.parse(fs.readFileSync(path.join(target, "backup.json"), "utf8"));
    }
    const files = entries.filter(entry => INDEX_FILES.includes(entry) || ARTWORK_FILES.includes(entry)).sort();
    const kind = files.every(file => INDEX_FILES.includes(file)) ? "indexes" : "artwork";
    if (!files.length || (kind === "artwork" && (!files.every(file => ARTWORK_FILES.includes(file)) || !name.includes("-fix-match-")))) throw failure("INVALID_SNAPSHOT_MANIFEST");
    if (kind === "indexes" && !manifest) throw failure("INVALID_SNAPSHOT_MANIFEST");
    if (manifest && (!Array.isArray(manifest.files) || manifest.files.slice().sort().join("|") !== files.join("|"))) throw failure("INVALID_SNAPSHOT_MANIFEST");
    const stamp = name.slice(0, 24).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
    const createdAt = Date.parse(manifest?.createdAt || stamp);
    if (!Number.isFinite(createdAt)) throw failure("INVALID_SNAPSHOT_MANIFEST");
    return { name, target, files, kind, bytes, createdAt, protected: entries.includes(".protected") || manifest?.protected === true, manifest };
  }
  function inventory() {
    const snapshots = [];
    let ignored = 0;
    for (const name of fs.readdirSync(root)) {
      if (name.startsWith(".")) continue; // incomplete writes, locks, and failed cleanup are never retention candidates
      try { snapshots.push(inspect(name)); } catch { ignored++; }
    }
    return { snapshots: snapshots.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name)), ignored };
  }
  function validate(snapshot) {
    try {
      const state = [...snapshot.files, ...(snapshot.manifest ? ["backup.json"] : [])].map(name => signature(path.join(snapshot.target, name))).join("|");
      if (validSignatures.get(snapshot.name) === state) return true;
      // Validate the actual recovery contents, not just the manifest's existence.
      for (const name of snapshot.files) {
        const file = path.join(snapshot.target, name);
        if (INDEX_FILES.includes(name)) jsonObject(file);
        else if (regular(file).size === 0) return false;
        if (snapshot.manifest?.hashes?.[name] && digest(file) !== snapshot.manifest.hashes[name]) return false;
      }
      validSignatures.set(snapshot.name, state);
      return true;
    } catch { return false; }
  }
  function remove(snapshot) {
    const fresh = inspect(snapshot.name);
    if (fresh.protected) throw failure("SNAPSHOT_PROTECTED");
    // Only flat, recognized, regular files can be removed. Never recursively follow links.
    const deletingName = `.pruning-${crypto.randomUUID()}`;
    fs.renameSync(fresh.target, child(deletingName));
    for (const name of fs.readdirSync(directory(deletingName))) {
      const target = path.join(directory(deletingName), name);
      regular(target); fs.unlinkSync(target);
    }
    fs.rmdirSync(directory(deletingName));
    validSignatures.delete(snapshot.name);
  }
  function pruneLocked({ dryRun = false, excluded = new Set() } = {}) {
    const { snapshots, ignored } = inventory();
    const anchors = new Set(excluded);
    const covered = new Set();
    // Keep a valid point for each index file, and one artwork point. An artwork-only
    // backup must not evict the last usable metadata/index recovery point.
    for (const snapshot of snapshots) {
      const coverage = snapshot.kind === "indexes" ? snapshot.files : ["artwork"];
      if (coverage.every(key => covered.has(key))) continue;
      if (!validate(snapshot)) continue;
      anchors.add(snapshot.name);
      coverage.forEach(key => covered.add(key));
    }
    let bytes = snapshots.reduce((sum, snapshot) => sum + snapshot.bytes, 0);
    let unprotected = snapshots.filter(snapshot => !snapshot.protected).length;
    const result = { removed: [], bytesBefore: bytes, bytesAfter: bytes, ignored, retained: snapshots.length, dryRun };
    if (!covered.size && snapshots.length) {
      log("pruning-skipped", { code: "NO_VALID_RECOVERY_POINT", ignored });
      return result;
    }
    for (const snapshot of snapshots.slice().reverse()) {
      if (snapshot.protected || anchors.has(snapshot.name)) continue;
      if (unprotected <= limits.maxSnapshots && now() - snapshot.createdAt <= limits.maxAgeDays * DAY && bytes <= limits.maxBytes) continue;
      try {
        if (!dryRun) remove(snapshot);
        result.removed.push(snapshot.name);
        bytes -= snapshot.bytes; unprotected--; result.retained--;
      } catch (error) { log("pruning-failed", { code: error.code || "IO_ERROR" }); }
    }
    result.bytesAfter = bytes;
    result.budgetExceeded = bytes > limits.maxBytes;
    if (!dryRun) latest.clear();
    log("pruning", { removed: result.removed.length, retained: result.retained, bytesBefore: result.bytesBefore, bytesAfter: bytes, ignored, budgetExceeded: result.budgetExceeded, dryRun });
    return result;
  }
  function prune(options) {
    try {
      if (!safeRoot(false)) return { removed: [], retained: 0, bytesBefore: 0, bytesAfter: 0 };
      return withLock(() => pruneLocked(options));
    } catch (error) { log("pruning-failed", { code: error.code || "IO_ERROR" }); throw error; }
  }
  function fingerprint(file) {
    const before = signature(file);
    const cached = hashes.get(file);
    if (cached?.signature === before) return cached.hash;
    const hash = digest(file);
    if (signature(file) !== before) throw failure("SOURCE_CHANGED_DURING_SNAPSHOT");
    hashes.set(file, { signature: before, hash });
    return hash;
  }
  function snapshotLocked({ reason = "artwork-change", sources, kind = "indexes", scope = "", protected: protect = false, deduplicate = true, validateData = true } = {}) {
    if (!["indexes", "artwork"].includes(kind)) throw failure("INVALID_SNAPSHOT_SOURCE");
    const allowed = kind === "indexes" ? INDEX_FILES : ARTWORK_FILES;
    const existing = (sources || INDEX_FILES.map(name => ({ name, file: path.join(configuredData, name) }))).filter(source => fs.existsSync(source.file));
    if (!existing.length) return { directory: "", created: false };
    if (new Set(existing.map(source => source.name)).size !== existing.length || existing.some(source => !allowed.includes(source.name))) throw failure("INVALID_SNAPSHOT_SOURCE");
    const content = {}, signatures = {};
    for (const source of existing) { signatures[source.name] = signature(source.file); content[source.name] = fingerprint(source.file); }
    const key = `${kind}:${scope}:${existing.map(source => source.name).sort().join("|")}`;
    let previous = latest.get(key);
    if (!previous && deduplicate) previous = inventory().snapshots.find(item => item.kind === kind && (item.manifest?.scope || "") === scope && item.files.join("|") === existing.map(source => source.name).sort().join("|"));
    if (previous && deduplicate && !protect) {
      try {
        const fresh = inspect(previous.name);
        const same = existing.every(source => fingerprint(path.join(fresh.target, source.name)) === content[source.name]);
        if (same && validate(fresh)) {
          latest.set(key, fresh);
          return { directory: fresh.target, created: false };
        }
      } catch { /* removed or invalid snapshot: create a new valid point */ }
    }
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
    const safeReason = String(reason).replace(/[^a-z0-9-]+/gi, "-").slice(0, 80) || "backup";
    const name = `${stamp}-${safeReason}-${crypto.randomUUID()}`;
    const stagingName = `.writing-${crypto.randomUUID()}`;
    const staging = child(stagingName);
    fs.mkdirSync(staging);
    try {
      for (const source of existing) {
        const target = path.join(staging, source.name);
        fs.copyFileSync(source.file, target, fs.constants.COPYFILE_EXCL);
        if (signature(source.file) !== signatures[source.name] || digest(target) !== content[source.name]) throw failure("SOURCE_CHANGED_DURING_SNAPSHOT");
        if (kind === "indexes") { if (validateData) jsonObject(target); }
        else if (regular(target).size === 0) throw failure("INVALID_SNAPSHOT_DATA");
        syncFile(target);
      }
      for (const source of existing) if (signature(source.file) !== signatures[source.name]) throw failure("SOURCE_CHANGED_DURING_SNAPSHOT");
      fs.writeFileSync(path.join(staging, "backup.json"), JSON.stringify({ version: 1, reason: safeReason, createdAt: new Date(now()).toISOString(), files: existing.map(source => source.name), kind, scope, hashes: content, protected: protect }, null, 2), { flag: "wx" });
      syncFile(path.join(staging, "backup.json"));
      fs.renameSync(staging, child(name));
      const result = { directory: child(name), created: true };
      latest.set(key, inspect(name));
      log("created", { files: existing.length, kind });
      return result;
    } catch (error) {
      // This staging directory belongs to this lock holder; other incomplete writes stay untouched.
      if (fs.existsSync(staging)) {
        for (const entry of fs.readdirSync(directory(stagingName))) { const file = path.join(staging, entry); regular(file); fs.unlinkSync(file); }
        fs.rmdirSync(directory(stagingName));
      }
      throw error;
    }
  }
  function snapshot(options = {}, change) {
    try {
      return withLock(() => {
        const result = snapshotLocked(options);
        try {
          if (change) {
            const changed = change(result);
            if (changed && typeof changed.then === "function") throw failure("ASYNC_RECOVERY_ACTION_NOT_SUPPORTED");
          }
          return result;
        } finally {
          if (result.created) {
            try { pruneLocked({ excluded: new Set([path.basename(result.directory)]) }); }
            catch (error) { log("pruning-failed", { code: error.code || "IO_ERROR" }); }
          }
        }
      });
    } catch (error) { log("creation-failed", { code: error.code || "IO_ERROR" }); throw error; }
  }
  function protect(name, enabled = true) {
    return withLock(() => {
      const point = inspect(name);
      const marker = path.join(point.target, ".protected");
      if (enabled && !fs.existsSync(marker)) fs.writeFileSync(marker, "protected\n", { flag: "wx" });
      if (!enabled) {
        if (point.manifest?.protected === true) {
          const manifest = { ...point.manifest, protected: false };
          const temporary = path.join(point.target, "backup.json.tmp");
          fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { flag: "wx" });
          fs.renameSync(temporary, path.join(point.target, "backup.json"));
        }
        if (fs.existsSync(marker)) { regular(marker); fs.unlinkSync(marker); }
      }
      latest.clear();
      log("protection-changed", { protected: enabled });
    });
  }
  function restore(name, { dryRun = true } = {}) {
    return withLock(() => {
      const point = inspect(name);
      if (point.kind !== "indexes") throw failure("ARTWORK_RESTORE_REQUIRES_MANUAL_DESTINATION");
      if (!validate(point)) throw failure("INVALID_SNAPSHOT_DATA");
      if (dryRun) return { restored: point.files, dryRun: true };
      // Never prune the point being restored. Retain the previous state as an explicitly
      // protected checkpoint, including when a restore must be retried after a crash.
      const checkpoint = snapshotLocked({ reason: "before-restore", protected: true, deduplicate: false, validateData: false });
      const staged = [], completed = [];
      try {
        for (const file of point.files) {
          const target = path.join(configuredData, file);
          if (fs.existsSync(target)) regular(target);
          const temporary = path.join(configuredData, `.${file}.restore-${crypto.randomUUID()}`);
          staged.push({ file, target, temporary, existed: fs.existsSync(target) });
          fs.copyFileSync(path.join(point.target, file), temporary, fs.constants.COPYFILE_EXCL);
          syncFile(temporary);
        }
        for (const item of staged) { safeRoot(); fs.renameSync(item.temporary, item.target); completed.push(item); }
      } catch (error) {
        for (const item of completed.reverse()) {
          if (item.existed) {
            const rollback = path.join(configuredData, `.${item.file}.rollback-${crypto.randomUUID()}`);
            fs.copyFileSync(path.join(checkpoint.directory, item.file), rollback, fs.constants.COPYFILE_EXCL);
            fs.renameSync(rollback, item.target);
          } else fs.unlinkSync(item.target);
        }
        log("restore-failed", { code: error.code || "IO_ERROR" });
        throw error;
      } finally {
        for (const item of staged) if (fs.existsSync(item.temporary)) { regular(item.temporary); fs.unlinkSync(item.temporary); }
        hashes.clear(); latest.clear();
      }
      try { pruneLocked({ excluded: new Set([name]) }); } catch (error) { log("pruning-failed", { code: error.code || "IO_ERROR" }); }
      log("restored", { files: point.files.length });
      return { restored: point.files, checkpoint: checkpoint.directory, dryRun: false };
    });
  }
  function start() {
    if (timer) return;
    const check = () => { try { prune(); } catch { /* already logged; retry next day */ } };
    check();
    timer = timers.setInterval(check, DAY);
    timer.unref?.();
  }
  function stop() { if (timer) timers.clearInterval(timer); timer = undefined; }
  return { root, limits, snapshot, prune, protect, restore, withLock, start, stop, list: () => safeRoot(false) ? withLock(() => inventory().snapshots.map(({ target, manifest, ...item }) => item)) : [] };
}

module.exports = { createArtworkRecovery, settingsFromEnv, DEFAULTS, DAY };
