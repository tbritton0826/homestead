const fs = require("fs");
const path = require("path");
const { createPluginConfigStore } = require("./plugin-config-store.cjs");

const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version", "type"];

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    return {
      __error: `Unable to parse ${filePath}: ${error.message}`,
    };
  }
}

function validateManifest(manifest = {}, manifestPath = "") {
  const errors = [];

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) {
      errors.push(`Missing required field "${field}".`);
    }
  }

  if (manifest.id && !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id)) {
    errors.push("Plugin id may contain only letters, numbers, dots, underscores, and hyphens.");
  }

  if (manifest.clientEntry && typeof manifest.clientEntry !== "string") {
    errors.push("clientEntry must be a string.");
  }

  if (manifest.client !== undefined) {
    if (!manifest.client || typeof manifest.client !== "object" || Array.isArray(manifest.client)) {
      errors.push("client must be an object.");
    } else if (manifest.client.entry !== undefined && typeof manifest.client.entry !== "string") {
      errors.push("client.entry must be a string.");
    }
  }

  if (manifest.serverEntry && typeof manifest.serverEntry !== "string") {
    errors.push("serverEntry must be a string.");
  }

  return {
    valid: errors.length === 0,
    errors,
    manifestPath,
  };
}

function createPluginRegistry(options = {}) {
  const homesteadRoot =
    options.homesteadRoot ||
    process.env.HOMESTEAD_ROOT ||
    path.resolve(__dirname, "..");

  const pluginsRoot =
    options.pluginsRoot ||
    process.env.HOMESTEAD_PLUGINS_DIR ||
    path.join(homesteadRoot, "plugins");

  const pluginDataBase =
    options.pluginDataBase ||
    process.env.HOMESTEAD_PLUGIN_DATA_DIR ||
    path.join(homesteadRoot, "data", "plugin-data");

  const configStore = createPluginConfigStore({
    homesteadRoot,
    pluginDataBase,
  });

  function scan() {
    if (!fs.existsSync(pluginsRoot)) {
      return [];
    }

    const directoryEntries = fs
      .readdirSync(pluginsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    return directoryEntries.map((entry) => {
      const pluginRoot = path.join(pluginsRoot, entry.name);
      const manifestPath = path.join(pluginRoot, "plugin.json");
      const storedConfig = configStore.get(entry.name) || {};

      if (!fs.existsSync(manifestPath)) {
        return {
          id: entry.name,
          pluginRoot,
          manifestPath,
          installed: true,
          valid: false,
          enabled: false,
          errors: ["plugin.json is missing."],
        };
      }

      const manifest = safeReadJson(manifestPath);

      if (manifest.__error) {
        return {
          id: entry.name,
          pluginRoot,
          manifestPath,
          installed: true,
          valid: false,
          enabled: false,
          errors: [manifest.__error],
        };
      }

      const validation = validateManifest(manifest, manifestPath);
      const clientEntry = manifest.client?.entry || manifest.clientEntry || "";
      const clientEntryPath = clientEntry
        ? path.resolve(pluginRoot, clientEntry)
        : null;
      const serverEntryPath = manifest.serverEntry
        ? path.resolve(pluginRoot, manifest.serverEntry)
        : null;

      if (manifest.id && manifest.id !== entry.name) {
        validation.errors.push(`Plugin folder must match manifest id "${manifest.id}".`);
      }
      if (clientEntryPath && (!isPathInside(pluginRoot, clientEntryPath) || !fs.existsSync(clientEntryPath))) {
        validation.errors.push("Client entry is missing or outside the plugin folder.");
      }
      if (serverEntryPath && (!isPathInside(pluginRoot, serverEntryPath) || !fs.existsSync(serverEntryPath))) {
        validation.errors.push("Server entry is missing or outside the plugin folder.");
      }
      validation.valid = validation.errors.length === 0;
      const requestedEnabled =
        typeof storedConfig.enabled === "boolean"
          ? storedConfig.enabled
          : Boolean(manifest.enabledByDefault);

      return {
        id: manifest.id || entry.name,
        name: manifest.name || entry.name,
        version: manifest.version || "0.0.0",
        type: manifest.type || "unknown",
        description: manifest.description || "",
        manifest,
        pluginRoot,
        manifestPath,
        installed: true,
        valid: validation.valid,
        enabled: validation.valid ? requestedEnabled : false,
        errors: validation.errors,
        clientEntryPath,
        serverEntryPath,
        dataRoot: path.join(pluginDataBase, manifest.id || entry.name),
        install: readJsonOrNull(path.join(pluginRoot, ".homestead-install.json")),
      };
    });
  }

  function get(pluginId) {
    return scan().find((plugin) => plugin.id === pluginId) || null;
  }

  function setEnabled(pluginId, enabled) {
    const plugin = get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not installed.`);
    }

    if (!plugin.valid && enabled) {
      throw new Error(
        `Plugin "${pluginId}" cannot be enabled because its manifest is invalid.`
      );
    }

    configStore.set(pluginId, { enabled: Boolean(enabled) });
    return get(pluginId);
  }

  function loadServerPlugin(pluginId, context = {}) {
    const plugin = get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not installed.`);
    }

    if (!plugin.valid) {
      throw new Error(`Plugin "${pluginId}" is invalid: ${plugin.errors.join(" ")}`);
    }

    if (!plugin.enabled) {
      return {
        loaded: false,
        reason: "disabled",
        plugin,
      };
    }

    if (!plugin.serverEntryPath || !fs.existsSync(plugin.serverEntryPath)) {
      throw new Error(`Plugin "${pluginId}" has no readable server entry.`);
    }

    delete require.cache[require.resolve(plugin.serverEntryPath)];
    const moduleValue = require(plugin.serverEntryPath);

    const register =
      moduleValue.registerPlugin ||
      moduleValue.registerServerPlugin ||
      moduleValue.default;

    if (typeof register !== "function") {
      throw new Error(
        `Plugin "${pluginId}" server entry does not export a recognized register function.`
      );
    }

    return {
      loaded: true,
      plugin,
      result: register({
        ...context,
        homesteadRoot,
        pluginsRoot,
        pluginDataBase,
        plugin,
      }),
    };
  }

  return {
    homesteadRoot,
    pluginsRoot,
    pluginDataBase,
    configStore,
    scan,
    get,
    setEnabled,
    loadServerPlugin,
  };
}

function readJsonOrNull(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const value = safeReadJson(filePath);
  return value.__error ? null : value;
}

module.exports = {
  createPluginRegistry,
  validateManifest,
};
