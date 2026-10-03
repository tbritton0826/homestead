const fs = require("fs");
const path = require("path");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stripBom(value = "") {
  return String(value).replace(/^\uFEFF/, "");
}

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = stripBom(fs.readFileSync(filePath, "utf8"));
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[plugins] Unable to read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function createPluginConfigStore(options = {}) {
  const homesteadRoot =
    options.homesteadRoot ||
    process.env.HOMESTEAD_ROOT ||
    path.resolve(__dirname, "..");

  const pluginDataBase =
    options.pluginDataBase ||
    process.env.HOMESTEAD_PLUGIN_DATA_DIR ||
    path.join(homesteadRoot, "data", "plugin-data");

  const statePath =
    options.statePath ||
    path.join(pluginDataBase, "plugins.json");

  function readAll() {
    const state = readJson(statePath, { version: 1, plugins: {} });

    return {
      version: Number(state?.version) || 1,
      plugins:
        state?.plugins && typeof state.plugins === "object"
          ? state.plugins
          : {},
    };
  }

  function writeAll(nextState) {
    const normalized = {
      version: Number(nextState?.version) || 1,
      plugins:
        nextState?.plugins && typeof nextState.plugins === "object"
          ? nextState.plugins
          : {},
    };

    writeJsonAtomic(statePath, normalized);
    return normalized;
  }

  function get(pluginId) {
    return readAll().plugins[pluginId] || null;
  }

  function set(pluginId, nextValue = {}) {
    const state = readAll();

    state.plugins[pluginId] = {
      ...(state.plugins[pluginId] || {}),
      ...nextValue,
      updatedAt: new Date().toISOString(),
    };

    writeAll(state);
    return state.plugins[pluginId];
  }

  return {
    statePath,
    readAll,
    writeAll,
    get,
    set,
  };
}

module.exports = {
  createPluginConfigStore,
  readJson,
  writeJsonAtomic,
  stripBom,
};