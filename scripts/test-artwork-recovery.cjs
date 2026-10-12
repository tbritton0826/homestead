"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const vm = require("node:vm");
const { createArtworkRecovery, settingsFromEnv, DEFAULTS, DAY } = require("../src/server/artwork-recovery.cjs");

const epoch = Date.parse("2026-10-12T12:00:00.000Z");
const modulePath = path.resolve(__dirname, "../src/server/artwork-recovery.cjs");
function fixture(t, settings = {}, options = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-artwork-test-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true })); // isolated fixture, never production
  const logs = [];
  let clock = epoch;
  const manager = createArtworkRecovery({ dataDir: data, settings: { ...DEFAULTS, ...settings }, now: () => clock, logger: { info: (...args) => logs.push(args) }, ...options });
  const write = (value = 1) => {
    fs.writeFileSync(path.join(data, "metadata-matches.json"), JSON.stringify({ match: value }));
    fs.writeFileSync(path.join(data, "media-index.json"), JSON.stringify({ libraries: { movies: [{ id: value }] } }));
  };
  return { data, manager, logs, write, time: value => { clock = value; } };
}
function legacy(data, age, { files = ["metadata-matches.json", "media-index.json"], corrupt = false, protected: protectedPoint = false, images = false } = {}) {
  const date = new Date(epoch - age * DAY).toISOString();
  const name = `${date.replace(/[:.]/g, "-")}-${images ? "fix-match-0123456789" : "metadata-match"}`;
  const directory = path.join(data, "artwork-recovery", name);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(directory, file), images ? "old-image" : corrupt ? "{broken" : JSON.stringify({ ...(file === "media-index.json" ? { libraries: {} } : {}), file, age }));
  if (!images) fs.writeFileSync(path.join(directory, "backup.json"), JSON.stringify({ createdAt: date, reason: "metadata-match", files, protected: protectedPoint }));
  else if (protectedPoint) fs.writeFileSync(path.join(directory, ".protected"), "protected");
  return name;
}

test("safe defaults and explicit retention environment settings", () => {
  assert.deepEqual(settingsFromEnv({}), DEFAULTS);
  assert.deepEqual(settingsFromEnv({ HOMESTEAD_ARTWORK_RECOVERY_MAX_SNAPSHOTS: "7", HOMESTEAD_ARTWORK_RECOVERY_MAX_AGE_DAYS: "15", HOMESTEAD_ARTWORK_RECOVERY_MAX_GB: "0.5" }), { maxSnapshots: 7, maxAgeDays: 15, maxBytes: 0.5 * 1024 ** 3 });
  for (const [key, value] of [["MAX_SNAPSHOTS", "0"], ["MAX_SNAPSHOTS", "1.5"], ["MAX_AGE_DAYS", "-1"], ["MAX_GB", "garbage"]]) assert.throws(() => settingsFromEnv({ [`HOMESTEAD_ARTWORK_RECOVERY_${key}`]: value }), { code: "INVALID_RETENTION_SETTING" });
});

test("default count retains the newest 20 unprotected legacy snapshots", t => {
  const f = fixture(t, { maxAgeDays: 100 });
  const names = Array.from({ length: 25 }, (_, index) => legacy(f.data, index));
  const result = f.manager.prune();
  assert.equal(result.removed.length, 5);
  assert.deepEqual(f.manager.list().map(item => item.name).sort(), names.slice(0, 20).sort());
});

test("age limit applies below count limit and never removes only valid point", t => {
  const f = fixture(t);
  const only = legacy(f.data, 90);
  assert.equal(f.manager.prune().removed.length, 0);
  const fresh = legacy(f.data, 1);
  assert.deepEqual(f.manager.prune().removed, [only]);
  assert.deepEqual(f.manager.list().map(item => item.name), [fresh]);
});

test("corrupt newest JSON does not evict the older valid recovery point", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 });
  const valid = legacy(f.data, 40);
  const corrupt = legacy(f.data, 1, { corrupt: true });
  assert.deepEqual(f.manager.prune().removed, [corrupt]);
  assert.deepEqual(f.manager.list().map(item => item.name), [valid]);
});

test("no valid recovery point means no automatic deletion", t => {
  const f = fixture(t, { maxBytes: 1 });
  const corrupt = legacy(f.data, 80, { corrupt: true });
  assert.equal(f.manager.prune().removed.length, 0);
  assert(fs.existsSync(path.join(f.manager.root, corrupt)));
  assert(f.logs.some(entry => entry[1]?.code === "NO_VALID_RECOVERY_POINT"));
});

test("valid JSON with an unusable media-index shape cannot become the last recovery point", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 });
  const valid = legacy(f.data, 40);
  const unusable = legacy(f.data, 1);
  fs.writeFileSync(path.join(f.manager.root, unusable, "media-index.json"), "{}");
  assert.deepEqual(f.manager.prune().removed, [unusable]);
  assert.deepEqual(f.manager.list().map(item => item.name), [valid]);
});

test("protected manifests and markers survive age, count, and storage thresholds", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 });
  const manifestProtected = legacy(f.data, 95, { protected: true });
  const markerProtected = legacy(f.data, 94);
  f.manager.protect(markerProtected);
  legacy(f.data, 93);
  const current = legacy(f.data, 1);
  const result = f.manager.prune();
  assert.equal(result.budgetExceeded, true);
  assert.deepEqual(f.manager.list().map(item => item.name).sort(), [manifestProtected, markerProtected, current].sort());
  f.manager.protect(manifestProtected, false);
  f.manager.protect(markerProtected, false);
  assert.equal(f.manager.prune().retained, 1);
});

test("storage budget prunes oldest points even below count and age limits", t => {
  const f = fixture(t);
  const names = [legacy(f.data, 3), legacy(f.data, 2), legacy(f.data, 1)];
  const size = f.manager.list().find(item => item.name === names[2]).bytes;
  const budgeted = createArtworkRecovery({ dataDir: f.data, settings: { ...DEFAULTS, maxBytes: size + 1 }, now: () => epoch, logger: { info() {} } });
  assert.deepEqual(budgeted.prune({ dryRun: true }).removed.sort(), names.slice(0, 2).sort());
  assert.equal(f.manager.list().length, 3);
  const result = budgeted.prune();
  assert.equal(result.retained, 1);
  assert(result.bytesAfter <= size + 1);
});

test("artwork-only legacy points participate in retention without evicting index coverage", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 });
  const index = legacy(f.data, 40);
  const oldArtwork = legacy(f.data, 39, { files: ["poster.jpg"], images: true });
  const newArtwork = legacy(f.data, 1, { files: ["poster.jpg", "fanart.jpg"], images: true });
  assert.deepEqual(f.manager.prune().removed, [oldArtwork]);
  assert.deepEqual(f.manager.list().map(item => item.name).sort(), [index, newArtwork].sort());
  assert.throws(() => f.manager.restore(newArtwork), { code: "ARTWORK_RESTORE_REQUIRES_MANUAL_DESTINATION" });
});

test("different partial index snapshots preserve a valid point for both files", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 });
  const metadata = legacy(f.data, 50, { files: ["metadata-matches.json"] });
  const media = legacy(f.data, 1, { files: ["media-index.json"] });
  assert.equal(f.manager.prune().removed.length, 0);
  assert.deepEqual(f.manager.list().map(item => item.name).sort(), [metadata, media].sort());
});

test("creation is atomic, prunes after success, and deduplicates unchanged full indexes", t => {
  const f = fixture(t, { maxSnapshots: 2 });
  f.write(1);
  const first = f.manager.snapshot({ reason: "metadata-match" });
  assert.equal(first.created, true);
  let changes = 0;
  const duplicate = f.manager.snapshot({ reason: "before-library-scan" }, () => changes++);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.directory, first.directory);
  assert.equal(changes, 1, "deduplication must still execute the protected mutation");
  f.write(2); f.time(epoch + 1); f.manager.snapshot();
  f.write(3); f.time(epoch + 2); f.manager.snapshot();
  assert.equal(f.manager.list().length, 2);
  const point = f.manager.list()[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(f.manager.root, point.name, "backup.json")));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.hashes["metadata-matches.json"].length, 64);
  assert(!fs.readdirSync(f.manager.root).some(name => name.startsWith(".writing-")));
  assert(!fs.existsSync(path.join(f.manager.root, ".lock")));
});

test("deduplication is scope-aware for artwork and works with legacy index snapshots", t => {
  const f = fixture(t);
  const old = legacy(f.data, 1);
  for (const name of ["metadata-matches.json", "media-index.json"]) fs.copyFileSync(path.join(f.manager.root, old, name), path.join(f.data, name));
  assert.equal(f.manager.snapshot().created, false);
  const image = path.join(f.data, "poster.jpg"); fs.writeFileSync(image, "a-poster");
  const options = { reason: "fix-match-123", kind: "artwork", scope: "123", sources: [{ name: "poster.jpg", file: image }] };
  assert.equal(f.manager.snapshot(options).created, true);
  assert.equal(f.manager.snapshot(options).created, false);
  assert.equal(f.manager.snapshot({ ...options, reason: "fix-match-456", scope: "456" }).created, true);
});

test("changed or removed dedup target is never trusted", t => {
  const f = fixture(t); f.write();
  const first = f.manager.snapshot();
  fs.writeFileSync(path.join(first.directory, "metadata-matches.json"), "{broken");
  const replacement = f.manager.snapshot();
  assert.equal(replacement.created, true);
  fs.rmSync(replacement.directory, { recursive: true });
  assert.equal(f.manager.snapshot().created, true);
});

test("failed copy leaves no completed point, releases lock, and prevents protected write", t => {
  const f = fixture(t); f.write();
  const original = fs.copyFileSync;
  let mutation = false;
  fs.copyFileSync = () => { throw Object.assign(new Error("private/path"), { code: "ENOSPC" }); };
  try { assert.throws(() => f.manager.snapshot({}, () => { mutation = true; }), { code: "ENOSPC" }); }
  finally { fs.copyFileSync = original; }
  assert.equal(mutation, false);
  assert.equal(f.manager.list().length, 0);
  assert(!fs.existsSync(path.join(f.manager.root, ".lock")));
  assert(!JSON.stringify(f.logs).includes("private/path"));
  assert.equal(f.manager.snapshot().created, true);
});

test("source modification during copying aborts the snapshot", t => {
  const f = fixture(t); f.write();
  const original = fs.copyFileSync;
  fs.copyFileSync = (source, ...args) => { original(source, ...args); fs.appendFileSync(source, " "); };
  try { assert.throws(() => f.manager.snapshot(), { code: "SOURCE_CHANGED_DURING_SNAPSHOT" }); }
  finally { fs.copyFileSync = original; }
  assert.equal(f.manager.list().length, 0);
});

test("a completed recovery point is retained and pruned even if the protected mutation fails", t => {
  const f = fixture(t, { maxSnapshots: 1 }); f.write();
  legacy(f.data, 60);
  assert.throws(() => f.manager.snapshot({}, () => { throw Object.assign(new Error("write failed"), { code: "EIO" }); }), { code: "EIO" });
  assert.equal(f.manager.list().length, 1);
  assert.equal(f.manager.restore(f.manager.list()[0].name).dryRun, true);
});

test("local CLI dry runs do not prune or restore without --apply", t => {
  const f = fixture(t); f.write(99);
  const older = legacy(f.data, 60);
  legacy(f.data, 1);
  const cli = path.resolve(__dirname, "artwork-recovery.cjs");
  const options = { env: { ...process.env, HOMESTEAD_DATA_DIR: f.data }, encoding: "utf8" };
  assert.equal(spawnSync(process.execPath, [cli, "prune"], options).status, 0);
  assert.equal(f.manager.list().length, 2);
  assert.equal(spawnSync(process.execPath, [cli, "restore", older], options).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, "metadata-matches.json"))).match, 99);
  assert.equal(spawnSync(process.execPath, [cli, "protect", older], options).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, "prune", "--apply"], options).status, 0);
  assert(fs.existsSync(path.join(f.manager.root, older)));
  assert.equal(spawnSync(process.execPath, [cli, "restore", "../outside", "--apply"], options).status, 1);
});

test("incomplete writes, unknown directories, and unsafe file trees are never deleted", t => {
  const f = fixture(t, { maxBytes: 1 });
  legacy(f.data, 1);
  const writing = path.join(f.manager.root, ".writing-in-progress"); fs.mkdirSync(writing); fs.writeFileSync(path.join(writing, "metadata-matches.json"), "writing");
  const unknown = path.join(f.manager.root, "archived"); fs.mkdirSync(unknown); fs.writeFileSync(path.join(unknown, "private"), "archived");
  const nested = legacy(f.data, 60); fs.mkdirSync(path.join(f.manager.root, nested, "nested"));
  const result = f.manager.prune();
  assert.equal(result.ignored, 2);
  for (const file of [writing, unknown, path.join(f.manager.root, nested, "nested")]) assert(fs.existsSync(file));
});

test("traversal and symlink/junction recovery roots cannot escape the data directory", t => {
  const f = fixture(t); f.write(); f.manager.snapshot();
  for (const name of ["..", "../outside", "..\\outside", "C:\\outside", "/outside"]) {
    assert.throws(() => f.manager.protect(name));
    assert.throws(() => f.manager.restore(name));
  }
  const linkedData = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-artwork-link-"));
  t.after(() => fs.rmSync(linkedData, { recursive: true, force: true }));
  fs.symlinkSync(f.manager.root, path.join(linkedData, "artwork-recovery"), process.platform === "win32" ? "junction" : "dir");
  const unsafe = createArtworkRecovery({ dataDir: linkedData, logger: { info() {} } });
  assert.throws(() => unsafe.prune(), { code: "UNSAFE_RECOVERY_ROOT" });
  assert.equal(f.manager.list().length, 1);
});

test("junctions inside snapshots are not followed, and replacement of root fails closed", t => {
  const f = fixture(t, { maxBytes: 1 });
  legacy(f.data, 1);
  const linked = legacy(f.data, 70);
  const outside = path.join(f.data, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "sentinel"), "keep");
  fs.symlinkSync(outside, path.join(f.manager.root, linked, "nested"), process.platform === "win32" ? "junction" : "dir");
  f.manager.prune();
  assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "keep");
  fs.renameSync(f.manager.root, `${f.manager.root}-saved`);
  fs.mkdirSync(f.manager.root);
  assert.throws(() => f.manager.prune(), { code: "RECOVERY_ROOT_CHANGED" });
});

test("reentrant creation, pruning, and restoration fail safely while the lock is held", t => {
  const f = fixture(t); f.write();
  const point = f.manager.snapshot();
  f.manager.withLock(() => {
    assert.throws(() => f.manager.snapshot(), { code: "RECOVERY_BUSY" });
    assert.throws(() => f.manager.prune(), { code: "RECOVERY_BUSY" });
    assert.throws(() => f.manager.restore(path.basename(point.directory), { dryRun: false }), { code: "RECOVERY_BUSY" });
  });
  assert.equal(f.manager.list().length, 1);
});

test("another process holding snapshot/restore lock excludes concurrent creation and cleanup", async t => {
  const f = fixture(t); f.write();
  const point = f.manager.snapshot();
  const release = path.join(f.data, "release-child");
  const code = `const fs=require('node:fs'); const {createArtworkRecovery}=require(${JSON.stringify(modulePath)}); const m=createArtworkRecovery({dataDir:process.argv[1],logger:{info(){}}}); m.withLock(()=>{ process.stdout.write('locked\\n'); while(!fs.existsSync(process.argv[2])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); });`;
  const child = spawn(process.execPath, ["-e", code, f.data, release], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  const exit = once(child, "exit");
  await once(child.stdout, "data");
  for (const operation of [() => f.manager.snapshot(), () => f.manager.prune(), () => f.manager.restore(path.basename(point.directory), { dryRun: false })]) assert.throws(operation, { code: "RECOVERY_BUSY" });
  fs.writeFileSync(release, "release");
  assert.equal((await exit)[0], 0);
  assert.equal(f.manager.snapshot().created, false);
});

test("crashed process lock is recovered without expiring live or unknown owners", t => {
  const f = fixture(t); f.write();
  const code = `const {createArtworkRecovery}=require(${JSON.stringify(modulePath)}); createArtworkRecovery({dataDir:process.argv[1],logger:{info(){}}}).withLock(()=>process.exit(0));`;
  assert.equal(spawnSync(process.execPath, ["-e", code, f.data]).status, 0);
  assert(fs.existsSync(path.join(f.manager.root, ".lock")));
  assert.equal(f.manager.snapshot().created, true);
  fs.mkdirSync(path.join(f.manager.root, ".lock"));
  assert.throws(() => f.manager.prune(), { code: "RECOVERY_BUSY" });
});

test("concurrent stale-lock reclaimers cannot steal a fresh snapshot lock", t => {
  const f = fixture(t); f.write();
  const code = `const {createArtworkRecovery}=require(${JSON.stringify(modulePath)}); createArtworkRecovery({dataDir:process.argv[1],logger:{info(){}}}).withLock(()=>process.exit(0));`;
  assert.equal(spawnSync(process.execPath, ["-e", code, f.data]).status, 0);
  const other = createArtworkRecovery({ dataDir: f.data, logger: { info() {} } });
  const original = fs.renameSync;
  let competing = 0;
  fs.renameSync = (source, target) => {
    if (path.basename(target).startsWith(".abandoned-")) {
      competing++;
      assert.throws(() => other.snapshot(), { code: "RECOVERY_BUSY" });
    }
    return original(source, target);
  };
  try { assert.equal(f.manager.snapshot().created, true); }
  finally { fs.renameSync = original; }
  assert.equal(competing, 1);
  assert.equal(other.snapshot().created, false);
  assert(!fs.existsSync(path.join(f.manager.root, ".lock-reclaim")));
});

test("legacy index restore is a dry run by default and retains a protected rollback point", t => {
  const f = fixture(t, { maxSnapshots: 1, maxBytes: 1 }); f.write(99);
  const name = legacy(f.data, 90);
  const before = fs.readFileSync(path.join(f.data, "metadata-matches.json"), "utf8");
  assert.equal(f.manager.restore(name).dryRun, true);
  assert.equal(fs.readFileSync(path.join(f.data, "metadata-matches.json"), "utf8"), before);
  const restored = f.manager.restore(name, { dryRun: false });
  for (const file of restored.restored) assert.deepEqual(fs.readFileSync(path.join(f.data, file)), fs.readFileSync(path.join(f.manager.root, name, file)));
  assert.equal(fs.readFileSync(path.join(restored.checkpoint, "metadata-matches.json"), "utf8"), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored.checkpoint, "backup.json"))).protected, true);
  assert(fs.existsSync(path.join(f.manager.root, name)), "restore target must survive post-restore pruning");
});

test("restore recovers damaged current JSON and rejects corrupt saved data before writing", t => {
  const f = fixture(t); f.write();
  const valid = f.manager.snapshot();
  fs.writeFileSync(path.join(f.data, "metadata-matches.json"), "");
  const result = f.manager.restore(path.basename(valid.directory), { dryRun: false });
  assert.equal(fs.readFileSync(path.join(result.checkpoint, "metadata-matches.json"), "utf8"), "");
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, "metadata-matches.json"))).match, 1);
  fs.writeFileSync(path.join(valid.directory, "metadata-matches.json"), "{broken");
  assert.throws(() => f.manager.restore(path.basename(valid.directory), { dryRun: false }), { code: "INVALID_SNAPSHOT_DATA" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, "metadata-matches.json"))).match, 1);
});

test("restore verifies content hashes and leaves missing legacy files unchanged", t => {
  const f = fixture(t); f.write(1);
  const valid = f.manager.snapshot();
  fs.writeFileSync(path.join(valid.directory, "metadata-matches.json"), JSON.stringify({ tampered: true }));
  assert.throws(() => f.manager.restore(path.basename(valid.directory), { dryRun: false }), { code: "INVALID_SNAPSHOT_DATA" });
  const partial = legacy(f.data, 1, { files: ["metadata-matches.json"] });
  const media = fs.readFileSync(path.join(f.data, "media-index.json"));
  f.manager.restore(partial, { dryRun: false });
  assert.deepEqual(fs.readFileSync(path.join(f.data, "media-index.json")), media);
});

test("failed multi-file restore rolls back files already replaced", t => {
  const f = fixture(t); f.write(99);
  const name = legacy(f.data, 1);
  const before = fs.readFileSync(path.join(f.data, "media-index.json"));
  const original = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(source).includes(".restore-") && target === path.join(f.data, "metadata-matches.json")) throw Object.assign(new Error("secret"), { code: "EIO" });
    return original(source, target);
  };
  try { assert.throws(() => f.manager.restore(name, { dryRun: false }), { code: "EIO" }); }
  finally { fs.renameSync = original; }
  assert.deepEqual(fs.readFileSync(path.join(f.data, "media-index.json")), before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, "metadata-matches.json"))).match, 99);
  assert.equal(f.manager.list().filter(item => item.protected).length, 1);
  assert(!fs.readdirSync(f.data).some(file => file.includes(".restore-") || file.includes(".rollback-")));
});

test("failed restore staging leaves no temporary replacements and keeps the checkpoint", t => {
  const f = fixture(t); f.write(99);
  const name = legacy(f.data, 1);
  const original = fs.fsyncSync;
  fs.fsyncSync = descriptor => {
    // Checkpoints are fully written first; fail when the staged replacement is synced.
    const staged = fs.readdirSync(f.data).some(file => file.includes(".restore-"));
    if (staged) throw Object.assign(new Error("private"), { code: "EIO" });
    return original(descriptor);
  };
  try { assert.throws(() => f.manager.restore(name, { dryRun: false }), { code: "EIO" }); }
  finally { fs.fsyncSync = original; }
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.data, "metadata-matches.json"))).match, 99);
  assert(!fs.readdirSync(f.data).some(file => file.includes(".restore-")));
  assert.equal(f.manager.list().filter(item => item.protected).length, 1);
});

test("startup pruning and 24-hour scheduling happen once and stop cleanly", t => {
  let callback, interval, cleared = 0, unref = 0;
  const timers = { setInterval(fn, ms) { callback = fn; interval = ms; return { unref() { unref++; } }; }, clearInterval() { cleared++; } };
  const f = fixture(t, {}, { timers });
  legacy(f.data, 31); const recent = legacy(f.data, 1);
  f.manager.start(); f.manager.start();
  assert.equal(f.manager.list().length, 1);
  assert.equal(interval, DAY); assert.equal(unref, 1);
  legacy(f.data, 32); callback();
  assert.deepEqual(f.manager.list().map(item => item.name), [recent]);
  f.manager.stop(); f.manager.stop(); assert.equal(cleared, 1);
});

test("cleanup failures do not lose the only valid point or invalidate a new snapshot", t => {
  const f = fixture(t, { maxSnapshots: 1 }); f.write();
  legacy(f.data, 60);
  const original = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (path.basename(target).startsWith(".pruning-")) throw Object.assign(new Error("private media path"), { code: "EACCES" });
    return original(source, target);
  };
  let point;
  try { point = f.manager.snapshot(); }
  finally { fs.renameSync = original; }
  assert.equal(point.created, true);
  assert(fs.existsSync(path.join(point.directory, "media-index.json")));
  assert(f.logs.some(entry => entry[1]?.code === "EACCES"));
  assert(!JSON.stringify(f.logs).includes("private media path"));
  assert.equal(f.manager.prune().retained, 1);
});

test("no recovery operation touches missing data during startup, and timer busy check retries safely", t => {
  let callback;
  const f = fixture(t, {}, { timers: { setInterval(fn) { callback = fn; return { unref() {} }; }, clearInterval() {} } });
  f.manager.start();
  assert.equal(fs.existsSync(f.manager.root), false);
  f.write(); f.manager.snapshot();
  legacy(f.data, 60);
  f.manager.withLock(callback);
  assert.equal(f.manager.list().length, 2);
  callback();
  assert.equal(f.manager.list().length, 1);
});

test("server metadata no-op avoids a snapshot and shared mutation lock surrounds changed writes", t => {
  const f = fixture(t);
  const server = fs.readFileSync(path.join(__dirname, "../server.cjs"), "utf8").replace(/\r\n/g, "\n");
  const source = server.slice(server.indexOf("function writeMetadataMatches("), server.indexOf("\nfunction getMetadataMatchStats"));
  let snapshots = 0;
  const context = { fs, process, crypto: require("node:crypto"), METADATA_MATCHES_FILE: path.join(f.data, "metadata-matches.json"), ensureHomesteadDataDir() {}, compactMetadataMatches: value => value, backupArtworkIndexes(reason, change) { snapshots++; return f.manager.snapshot({ reason }, change); } };
  vm.createContext(context); vm.runInContext(`${source}\nthis.write = writeMetadataMatches;`, context);
  context.write({ a: 1 });
  const count = snapshots; const stat = fs.statSync(context.METADATA_MATCHES_FILE);
  context.write({ a: 1 });
  assert.equal(snapshots, count);
  assert.equal(fs.statSync(context.METADATA_MATCHES_FILE).mtimeMs, stat.mtimeMs);
  context.write({ a: 2 });
  assert.equal(snapshots, count + 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.manager.root, f.manager.list()[0].name, "metadata-matches.json"))), { a: 1 });
  assert.match(server, /artworkRecoverySnapshots\.start\(\)/);
  assert.match(server, /reason: `fix-match-\$\{scope\}`/);
});
