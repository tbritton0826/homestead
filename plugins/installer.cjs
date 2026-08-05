const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { validateManifest } = require("./registry.cjs");
const { readJson, writeJsonAtomic } = require("./plugin-config-store.cjs");

const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20000;
const STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function safePluginId(value = "") {
  const pluginId = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pluginId)) {
    throw new Error("Plugin id may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return pluginId;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRelativePluginPath(value, label) {
  const clean = String(value || "").replaceAll("\\", "/").trim();
  if (!clean || clean.startsWith("/") || /^[a-z]:/i.test(clean)) {
    throw new Error(`${label} must be a relative path inside the plugin package.`);
  }
  const normalized = path.posix.normalize(clean);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
    throw new Error(`${label} escapes the plugin package.`);
  }
  return normalized.replace(/^\.\//, "");
}

function assertSafeArchiveEntries(entries = []) {
  if (!entries.length) throw new Error("The plugin package is empty.");
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`The plugin package contains too many files (${entries.length}).`);
  }
  for (const entry of entries) {
    const clean = String(entry || "").replaceAll("\\", "/");
    if (!clean || clean.startsWith("/") || /^[a-z]:/i.test(clean)) {
      throw new Error(`Unsafe archive path: ${entry}`);
    }
    const normalized = path.posix.normalize(clean);
    if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) {
      throw new Error(`Unsafe archive path: ${entry}`);
    }
  }
}

function listArchiveEntries(packagePath) {
  let output = "";
  try {
    output = execFileSync("unzip", ["-Z1", packagePath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Unable to read the plugin ZIP package: ${error.message}`);
  }
  return output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function inspectArchiveLayout(packagePath) {
  let output = "";
  try {
    output = execFileSync("unzip", ["-Z", "-l", packagePath], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Unable to inspect the plugin ZIP package: ${error.message}`);
  }

  let declaredBytes = 0;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([dlcbps-][rwxStT-]{9})\s+\S+\s+\S+\s+(\d+)\s+/);
    if (!match) continue;
    const entryType = match[1][0];
    if (!["-", "d"].includes(entryType)) {
      throw new Error("Plugin packages may contain only regular files and directories.");
    }
    declaredBytes += Number(match[2] || 0);
    if (declaredBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("The plugin package declares more than 1 GiB of extracted data.");
    }
  }
  return declaredBytes;
}

function directorySize(directoryPath) {
  let total = 0;
  const stack = [directoryPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Plugin packages may not contain symbolic links: ${entry.name}`);
      }
      if (stat.isDirectory()) stack.push(fullPath);
      else if (stat.isFile()) total += stat.size;
      if (total > MAX_EXTRACTED_BYTES) {
        throw new Error("The extracted plugin exceeds the 1 GiB safety limit.");
      }
    }
  }
  return total;
}

function findPluginRoot(extractRoot) {
  const directManifest = path.join(extractRoot, "plugin.json");
  if (fs.existsSync(directManifest)) return extractRoot;

  const directories = fs
    .readdirSync(extractRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "__MACOSX");

  if (directories.length === 1) {
    const nestedRoot = path.join(extractRoot, directories[0].name);
    if (fs.existsSync(path.join(nestedRoot, "plugin.json"))) return nestedRoot;
  }

  throw new Error("plugin.json must be at the package root or inside one top-level plugin folder.");
}

function readAndValidateManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, "plugin.json");
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`plugin.json is not valid JSON: ${error.message}`);
  }

  const validation = validateManifest(manifest, manifestPath);
  if (!validation.valid) throw new Error(validation.errors.join(" "));

  manifest.id = safePluginId(manifest.id);
  manifest.schemaVersion = Number(manifest.schemaVersion || 1);
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported plugin schema version: ${manifest.schemaVersion}`);
  }

  if (manifest.serverEntry) {
    const serverEntry = assertRelativePluginPath(manifest.serverEntry, "serverEntry");
    const serverPath = path.resolve(pluginRoot, serverEntry);
    if (!isPathInside(pluginRoot, serverPath) || !fs.existsSync(serverPath)) {
      throw new Error(`Server entry was not found: ${serverEntry}`);
    }
    manifest.serverEntry = serverEntry;
  }

  const clientEntryValue = manifest.client?.entry || manifest.clientEntry || "";
  if (clientEntryValue) {
    const clientEntry = assertRelativePluginPath(clientEntryValue, "client entry");
    const clientPath = path.resolve(pluginRoot, clientEntry);
    if (!isPathInside(pluginRoot, clientPath) || !fs.existsSync(clientPath)) {
      throw new Error(`Client entry was not found: ${clientEntry}`);
    }
    if (path.extname(clientEntry).toLowerCase() !== ".html") {
      throw new Error("Runtime plugins must provide a prebuilt HTML client entry.");
    }
    manifest.client = { ...(manifest.client || {}), entry: clientEntry, mode: "iframe" };
    delete manifest.clientEntry;
  }

  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) {
    throw new Error("permissions must be an array of permission identifiers.");
  }
  manifest.permissions = [...new Set((manifest.permissions || []).map(String).map((item) => item.trim()).filter(Boolean))];

  if (manifest.navigation && typeof manifest.navigation !== "object") {
    throw new Error("navigation must be an object when provided.");
  }

  return manifest;
}

function sanitizeManifest(manifest = {}) {
  return {
    schemaVersion: Number(manifest.schemaVersion || 1),
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    description: manifest.description || "",
    author: manifest.author || "",
    homepage: manifest.homepage || "",
    permissions: manifest.permissions || [],
    navigation: manifest.navigation || null,
    hasClient: Boolean(manifest.client?.entry),
    hasServer: Boolean(manifest.serverEntry),
  };
}

function normalizeSha256(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return "";
  if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error("SHA-256 must be exactly 64 hexadecimal characters.");
  return clean;
}

function safeCatalogUrl(value = "") {
  let parsed = null;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS catalog URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Plugin catalogs must use HTTP or HTTPS.");
  }
  return parsed.toString();
}

function createPluginInstaller(options = {}) {
  const registry = options.registry;
  if (!registry) throw new Error("Plugin installer requires a plugin registry.");

  const pluginsRoot = options.pluginsRoot || registry.pluginsRoot;
  const installerDataRoot = options.installerDataRoot || path.join(registry.pluginDataBase, ".installer");
  const stagingRoot = path.join(installerDataRoot, "staging");
  const backupsRoot = path.join(installerDataRoot, "backups");
  const trashRoot = path.join(installerDataRoot, "trash");
  const catalogSettingsPath = path.join(installerDataRoot, "catalog.json");
  const defaultCatalogUrl = String(options.defaultCatalogUrl || "").trim();
  const stages = new Map();

  [pluginsRoot, stagingRoot, backupsRoot, trashRoot].forEach(ensureDirectory);

  function cleanupOldStages() {
    const cutoff = Date.now() - STAGE_MAX_AGE_MS;
    for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(stagingRoot, entry.name);
      try {
        if (fs.statSync(fullPath).mtimeMs < cutoff) fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {}
    }
  }
  cleanupOldStages();

  function stagePackageFile(packagePath, metadata = {}) {
    const stat = fs.statSync(packagePath);
    if (stat.size <= 0) throw new Error("The plugin package is empty.");
    if (stat.size > MAX_PACKAGE_BYTES) throw new Error("The plugin package exceeds the 512 MiB limit.");

    const actualSha256 = sha256File(packagePath);
    const expectedSha256 = normalizeSha256(metadata.expectedSha256 || "");
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new Error(`Package checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`);
    }

    const archiveEntries = listArchiveEntries(packagePath);
    assertSafeArchiveEntries(archiveEntries);
    inspectArchiveLayout(packagePath);

    const stageId = crypto.randomUUID();
    const stageRoot = path.join(stagingRoot, stageId);
    const extractRoot = path.join(stageRoot, "extracted");
    ensureDirectory(extractRoot);

    try {
      execFileSync("unzip", ["-qq", packagePath, "-d", extractRoot], {
        maxBuffer: 16 * 1024 * 1024,
      });
      const extractedBytes = directorySize(extractRoot);
      const pluginRoot = findPluginRoot(extractRoot);
      const manifest = readAndValidateManifest(pluginRoot);
      const installed = registry.get(manifest.id);
      const stage = {
        stageId,
        stageRoot,
        packagePath,
        pluginRoot,
        manifest,
        sha256: actualSha256,
        packageBytes: stat.size,
        extractedBytes,
        source: metadata.source || "upload",
        sourceLabel: metadata.sourceLabel || metadata.fileName || "Local package",
        catalogEntry: metadata.catalogEntry || null,
        createdAt: new Date().toISOString(),
      };
      stages.set(stageId, stage);
      return {
        stageId,
        manifest: sanitizeManifest(manifest),
        sha256: actualSha256,
        packageBytes: stat.size,
        extractedBytes,
        source: stage.source,
        sourceLabel: stage.sourceLabel,
        update: Boolean(installed),
        installedVersion: installed?.version || "",
      };
    } catch (error) {
      fs.rmSync(stageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  function stageUpload(buffer, metadata = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("No plugin package was uploaded.");
    if (buffer.length > MAX_PACKAGE_BYTES) throw new Error("The plugin package exceeds the 512 MiB limit.");
    const uploadRoot = fs.mkdtempSync(path.join(stagingRoot, "upload-"));
    const packagePath = path.join(uploadRoot, "package.zip");
    fs.writeFileSync(packagePath, buffer);
    try {
      return stagePackageFile(packagePath, { ...metadata, source: "upload" });
    } finally {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
    }
  }

  function readCatalogSettings() {
    const stored = readJson(catalogSettingsPath, {});
    return {
      url: String(stored.url || process.env.HOMESTEAD_PLUGIN_CATALOG_URL || defaultCatalogUrl || "").trim(),
      updatedAt: stored.updatedAt || "",
    };
  }

  function writeCatalogSettings(value = {}) {
    const url = value.url ? safeCatalogUrl(value.url) : "";
    const settings = { url, updatedAt: new Date().toISOString() };
    writeJsonAtomic(catalogSettingsPath, settings);
    return settings;
  }

  async function fetchJson(url, maxBytes = 2 * 1024 * 1024) {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Homestead-Plugin-Installer/1" } });
    if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) throw new Error("The plugin catalog is too large.");
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("The plugin catalog is too large.");
    return JSON.parse(text);
  }

  async function getCatalog() {
    const settings = readCatalogSettings();
    if (!settings.url) return { configured: false, url: "", plugins: [] };
    const catalogUrl = safeCatalogUrl(settings.url);
    const document = await fetchJson(catalogUrl);
    if (Number(document.schemaVersion || 1) !== 1 || !Array.isArray(document.plugins)) {
      throw new Error("The catalog must use schemaVersion 1 and contain a plugins array.");
    }
    const installedMap = new Map(registry.scan().map((plugin) => [plugin.id, plugin]));
    const plugins = document.plugins.map((entry) => {
      const id = safePluginId(entry.id);
      const packageUrl = new URL(String(entry.packageUrl || ""), catalogUrl).toString();
      const parsedPackageUrl = safeCatalogUrl(packageUrl);
      const sha256 = normalizeSha256(entry.sha256 || "");
      if (!sha256) throw new Error(`Catalog plugin "${id}" is missing a SHA-256 checksum.`);
      const installed = installedMap.get(id);
      return {
        id,
        name: String(entry.name || id),
        version: String(entry.version || "0.0.0"),
        description: String(entry.description || ""),
        author: String(entry.author || ""),
        icon: String(entry.icon || "🧩"),
        packageUrl: parsedPackageUrl,
        sha256,
        sizeBytes: Number(entry.sizeBytes || 0),
        permissions: Array.isArray(entry.permissions) ? entry.permissions.map(String) : [],
        installed: Boolean(installed),
        installedVersion: installed?.version || "",
      };
    });
    return {
      configured: true,
      url: catalogUrl,
      name: String(document.name || "Private Plugin Catalog"),
      updatedAt: String(document.updatedAt || ""),
      plugins,
    };
  }

  async function downloadPackage(url, destinationPath) {
    const response = await fetch(safeCatalogUrl(url), { headers: { Accept: "application/zip, application/octet-stream", "User-Agent": "Homestead-Plugin-Installer/1" } });
    if (!response.ok || !response.body) throw new Error(`Plugin download failed with HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_PACKAGE_BYTES) throw new Error("The plugin package exceeds the 512 MiB limit.");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destinationPath));
    if (fs.statSync(destinationPath).size > MAX_PACKAGE_BYTES) {
      throw new Error("The plugin package exceeds the 512 MiB limit.");
    }
  }

  async function stageCatalogPlugin(pluginId) {
    const catalog = await getCatalog();
    const entry = catalog.plugins.find((plugin) => plugin.id === pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" was not found in the configured catalog.`);
    const downloadRoot = fs.mkdtempSync(path.join(stagingRoot, "catalog-"));
    const packagePath = path.join(downloadRoot, "package.zip");
    try {
      await downloadPackage(entry.packageUrl, packagePath);
      return stagePackageFile(packagePath, {
        source: "catalog",
        sourceLabel: catalog.name || "Private Plugin Catalog",
        expectedSha256: entry.sha256,
        catalogEntry: entry,
      });
    } finally {
      fs.rmSync(downloadRoot, { recursive: true, force: true });
    }
  }

  function confirmInstall(stageId, options = {}) {
    const stage = stages.get(String(stageId || ""));
    if (!stage) throw new Error("The staged plugin package expired. Stage it again.");
    const pluginId = safePluginId(stage.manifest.id);
    const targetPath = path.join(pluginsRoot, pluginId);
    const existing = registry.get(pluginId);
    if (existing && options.allowUpdate !== true) {
      throw new Error(`Plugin "${pluginId}" is already installed. Confirm that this is an update.`);
    }

    ensureDirectory(pluginsRoot);
    let backupPath = "";
    try {
      if (fs.existsSync(targetPath)) {
        backupPath = path.join(backupsRoot, `${pluginId}-${Date.now()}`);
        fs.renameSync(targetPath, backupPath);
      }
      fs.renameSync(stage.pluginRoot, targetPath);
      writeJsonAtomic(path.join(targetPath, ".homestead-install.json"), {
        installedAt: new Date().toISOString(),
        source: stage.source,
        sourceLabel: stage.sourceLabel,
        sha256: stage.sha256,
        previousBackup: backupPath || null,
      });
      registry.configStore.set(pluginId, { enabled: options.enable === true });
      stages.delete(stage.stageId);
      fs.rmSync(stage.stageRoot, { recursive: true, force: true });
      const plugin = registry.get(pluginId);
      return {
        plugin,
        backupPath: backupPath || "",
        restartRequired: Boolean(plugin?.serverEntryPath || options.enable),
      };
    } catch (error) {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
      if (backupPath && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, targetPath);
      }
      throw error;
    }
  }

  function setPluginEnabled(pluginId, enabled) {
    const plugin = registry.setEnabled(safePluginId(pluginId), Boolean(enabled));
    return { plugin, restartRequired: Boolean(plugin.serverEntryPath) };
  }

  function uninstallPlugin(pluginId) {
    const id = safePluginId(pluginId);
    const plugin = registry.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" is not installed.`);
    registry.configStore.set(id, { enabled: false });
    const trashPath = path.join(trashRoot, `${id}-${Date.now()}`);
    fs.renameSync(plugin.pluginRoot, trashPath);
    return { id, trashPath, dataPreserved: true, restartRequired: Boolean(plugin.serverEntryPath) };
  }

  function resolveClientRequest(pluginId, requestPath = "/") {
    const plugin = registry.get(safePluginId(pluginId));
    if (!plugin || !plugin.valid || !plugin.enabled) return null;
    const entry = plugin.manifest?.client?.entry || "";
    if (!entry) return null;
    const entryPath = path.resolve(plugin.pluginRoot, entry);
    const clientRoot = path.dirname(entryPath);
    if (!isPathInside(plugin.pluginRoot, entryPath) || !fs.existsSync(entryPath)) return null;

    const cleanRequest = decodeURIComponent(String(requestPath || "/").split("?")[0]).replace(/^\/+/, "");
    const requestedPath = cleanRequest ? path.resolve(clientRoot, cleanRequest) : entryPath;
    if (!isPathInside(clientRoot, requestedPath)) return null;
    if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) return requestedPath;
    if (cleanRequest && path.extname(cleanRequest)) return null;
    return entryPath;
  }

  return {
    stageUpload,
    getCatalog,
    readCatalogSettings,
    writeCatalogSettings,
    stageCatalogPlugin,
    confirmInstall,
    setPluginEnabled,
    uninstallPlugin,
    resolveClientRequest,
    sanitizeManifest,
  };
}

module.exports = {
  createPluginInstaller,
  sanitizeManifest,
  safePluginId,
};
