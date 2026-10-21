const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

(async () => {
  const root = path.resolve(__dirname, "..");
  const work = path.join(root, "work");
  await fs.mkdir(work, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(work, "windows-setup-api-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const mediaRoot = path.join(fixture, "media");
  const child = spawn(process.execPath, [path.join(root, "server.cjs")], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOMESTEAD_DATA_DIR: path.join(fixture, "data"), MEDIA_ROOT: mediaRoot } });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${origin}/api/platform`)).ok) { ready = true; break; } } catch { }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(ready, "Isolated server did not start. " + output);
    const defaultIcon = await fs.readFile(path.join(root, "public/homestead-icon.png"));
    const getIcon = async () => {
      const response = await fetch(`${origin}/api/branding/icon`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^image\/png/);
      return Buffer.from(await response.arrayBuffer());
    };
    assert.deepEqual(await getIcon(), defaultIcon, "Fresh setup must render the bundled default icon.");
    const config = await fetch(`${origin}/api/setup-config`).then((response) => response.json());
    assert.equal(config.storage.platform, process.platform);
    assert.equal(config.storage.folderDefaults.movies, path.join(mediaRoot, "movies"));
    for (const id of ["livetv", "family", "inventory", "ai", "cloud", "pets"]) assert.equal(config.subscription.libraryAccess[id], false);
    for (const id of ["movies", "tvshows", "music", "books", "photos", "youtube", "adult"]) assert.equal(config.subscription.libraryAccess[id], true);
    const post = async (route, body, method = "POST") => {
      const response = await fetch(origin + route, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const custom = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
    await post("/api/branding/icon", { imageData: `data:image/png;base64,${custom.toString("base64")}` });
    assert.deepEqual(await getIcon(), custom);
    await post("/api/branding/icon", {}, "DELETE");
    assert.deepEqual(await getIcon(), defaultIcon);
    const folder = path.join(mediaRoot, "movies");
    const body = { enabledLibraries: { movies: true }, folderMappings: { movies: folder } };
    assert.equal((await post("/api/setup/check-folders", body)).ok, true);
    await assert.rejects(fs.stat(folder), { code: "ENOENT" });
    assert.equal((await post("/api/setup/create-folders", body)).ok, true);
    assert((await fs.stat(folder)).isDirectory());
    const shortcut = path.join(fixture, "Network Shortcuts", "Movies");
    body.folderMappings.movies = shortcut;
    for (const route of ["check-folders", "create-folders"]) {
      const result = await post(`/api/setup/${route}`, body);
      assert.equal(result.ok, false);
      assert.match(result.results[0].message, /Windows shortcut/);
    }
    await assert.rejects(fs.stat(shortcut), { code: "ENOENT" });
    const blocked = path.join(fixture, "paid-inventory");
    const ignored = await post("/api/setup/create-folders", { enabledLibraries: { inventory: true }, folderMappings: { inventory: blocked } });
    assert(!ignored.results.some((result) => result.libraryId === "inventory"));
    await assert.rejects(fs.stat(blocked), { code: "ENOENT" });
    console.log("Windows setup API checks passed: default/custom/reset icon, native folder defaults, shortcut rejection and paid-library filesystem lock.");
  } finally {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    if (child.exitCode === null) { child.kill(); await closed; }
    await fs.rm(fixture, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
