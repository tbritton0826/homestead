const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { setupStorageInfo, inspectSetupFolder } = require("../src/server/setup-storage.cjs");

(async () => {
  const windows = { platform: "win32" };
  await assert.rejects(inspectSetupFolder(String.raw`C:\Users\Tim\AppData\Roaming\Microsoft\Windows\Network Shortcuts\Movies`, windows), /Windows shortcut/);
  for (const folder of ["/media/movies", "C:Movies", "Movies", String.raw`C:\Movies.lnk`]) await assert.rejects(inspectSetupFolder(folder, windows));
  let writes = 0;
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const io = { stat: async () => { throw missing; }, mkdir: async () => { writes++; }, access: async () => {}, readdir: async () => [] };
  await assert.rejects(inspectSetupFolder(String.raw`\\server\share\Movies`, { ...windows, create: true, io }), /network folder is unavailable/);
  assert.equal(writes, 0, "Never create missing network shares.");
  io.stat = async () => ({ isDirectory: () => true });
  assert.equal((await inspectSetupFolder(String.raw`\\server\share\Movies`, { ...windows, io })).status, "exists");
  assert.equal((await inspectSetupFolder(String.raw`M:\Movies`, { ...windows, io })).status, "exists");
  io.readdir = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
  await assert.rejects(inspectSetupFolder(String.raw`\\server\share\Movies`, { ...windows, io }), /cannot read this folder/);
  assert.equal(setupStorageInfo({ mediaRoot: String.raw`C:\Homestead\media`, dataDir: String.raw`C:\Homestead\data`, platform: "win32" }).folderDefaults.tvshows, String.raw`C:\Homestead\media\tv`);
  const root = path.resolve(__dirname, "../work");
  await fs.mkdir(root, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(root, "setup-storage-"));
  const folder = path.join(fixture, "Movies");
  try {
    assert.equal((await inspectSetupFolder(folder)).status, "missing");
    await assert.rejects(fs.stat(folder), { code: "ENOENT" });
    assert.equal((await inspectSetupFolder(folder, { create: true })).status, "created");
    assert.equal((await inspectSetupFolder(folder)).status, "exists");
    const file = path.join(folder, "sample.txt");
    await fs.writeFile(file, "fixture");
    await assert.rejects(inspectSetupFolder(file), /is a file/);
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
  console.log("Setup storage checks passed: real local folders, UNC/mapped drives, shortcuts, missing shares and read failures.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
