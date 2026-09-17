"use strict";

const fs = require("fs");
const path = require("path");

const targetArgument = process.argv.slice(2).find((argument) => argument !== "--check");
const target = path.resolve(targetArgument || "src/App.jsx");
const checkOnly = process.argv.includes("--check");
const slotMarker = "homestead-ai-main-plugin-slot-v1";
const bridgeMarker = "homestead-plugin-api-bridge-v1";

if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
  console.error(`App source not found: ${target}`);
  process.exit(1);
}

const source = fs.readFileSync(target, "utf8");
let next = source;
const changes = [];

if (!next.includes(slotMarker)) {
  const pluginStatePattern = /  const navigablePlugins = useMemo\(\s*\n\s*\(\) => runtimePlugins\.filter\(\(plugin\) => plugin\.valid && plugin\.enabled && plugin\.clientUrl\),\s*\n\s*\[runtimePlugins\]\s*\n\s*\);/;
  const routePattern = /\) : activeLibrary === ["']ai["'] \? \(\s*\n\s*<AIPage setupConfig=\{setupConfig\} \/>/;
  const stateMatches = next.match(new RegExp(pluginStatePattern.source, "g")) || [];
  const routeMatches = next.match(new RegExp(routePattern.source, "g")) || [];
  if (stateMatches.length !== 1 || routeMatches.length !== 1) {
    console.error(`Safe patch stopped: expected one plugin-state anchor and one AI-page anchor, found ${stateMatches.length} and ${routeMatches.length}. No files were changed.`);
    process.exit(2);
  }

  next = next.replace(pluginStatePattern, `  // ${slotMarker}: generic surface selection; no plugin ID is hard-coded here.
  const aiMainPlugin = useMemo(
    () => runtimePlugins.find((plugin) =>
      plugin.valid &&
      plugin.enabled &&
      plugin.clientUrl &&
      plugin.navigation?.section === "ai" &&
      plugin.navigation?.slot === "main"
    ) || null,
    [runtimePlugins]
  );
  const navigablePlugins = useMemo(
    () => runtimePlugins.filter((plugin) =>
      plugin.valid &&
      plugin.enabled &&
      plugin.clientUrl &&
      !(plugin.navigation?.section === "ai" && plugin.navigation?.slot === "main") &&
      plugin.navigation?.hideStandalone !== true
    ),
    [runtimePlugins]
  );`);

  next = next.replace(routePattern, `) : activeLibrary === "ai" ? (
      aiMainPlugin
        ? <PluginHostPage plugin={aiMainPlugin} />
        : <AIPage setupConfig={setupConfig} />`);
  changes.push("generic ai.main plugin surface");
}

if (!next.includes(bridgeMarker)) {
  const pluginHostPattern = /function PluginHostPage\(\{ plugin \}\) \{[\s\S]*?\n\}(?=\n\nfunction SettingsPage)/g;
  const hostMatches = next.match(pluginHostPattern) || [];
  if (hostMatches.length !== 1) {
    console.error(`Safe patch stopped: expected one PluginHostPage anchor, found ${hostMatches.length}. No files were changed.`);
    process.exit(3);
  }

  const bridgedPluginHost = `function PluginHostPage({ plugin }) {
  // ${bridgeMarker}: the trusted parent proxies only this iframe's own plugin API namespace.
  const frameRef = useRef(null);
  const [bridgePluginId, setBridgePluginId] = useState("");
  const pluginId = String(plugin?.id || "");

  useEffect(() => {
    if (!pluginId) {
      setBridgePluginId("");
      return undefined;
    }
    const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    const handlePluginApiRequest = async (event) => {
      const frameWindow = frameRef.current?.contentWindow;
      const message = event.data;
      if (
        !frameWindow ||
        event.source !== frameWindow ||
        message?.type !== "homestead:plugin-api-request" ||
        message?.pluginId !== pluginId
      ) return;

      const requestId = String(message.requestId || "");
      if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(requestId)) return;
      const respond = (status, data) => event.source?.postMessage({
        type: "homestead:plugin-api-response",
        pluginId,
        requestId,
        status,
        data,
      }, "*");

      try {
        const method = String(message.method || "GET").toUpperCase();
        const rawPath = String(message.path || "");
        if (!allowedMethods.has(method)) throw new Error("Plugin API method is not allowed.");
        if (!rawPath.startsWith("/") || rawPath.length > 2048 || rawPath.includes("\\\\") || rawPath.includes("#")) {
          throw new Error("Plugin API path is invalid.");
        }

        const suffix = rawPath.replace(/^\\/+/, "");
        const decodedSuffixPath = decodeURIComponent(suffix.split("?")[0]);
        if (decodedSuffixPath.split("/").some((segment) => segment === "." || segment === "..")) {
          throw new Error("Plugin API path traversal is not allowed.");
        }

        const pluginPrefix = "/api/plugins/" + encodeURIComponent(pluginId) + "/";
        const requestUrl = new URL(pluginPrefix + suffix, window.location.origin);
        if (
          requestUrl.origin !== window.location.origin ||
          !requestUrl.pathname.startsWith(pluginPrefix) ||
          requestUrl.hash
        ) throw new Error("Plugin API request escaped its namespace.");

        let body;
        if (message.body !== undefined && method !== "GET") {
          body = typeof message.body === "string" ? message.body : JSON.stringify(message.body);
          if (body.length > 32 * 1024 * 1024) throw new Error("Plugin API request body is too large.");
        }
        const headers = { Accept: "application/json" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const response = await fetch(requestUrl.pathname + requestUrl.search, {
          method,
          headers,
          body,
          cache: "no-store",
          credentials: "same-origin",
        });
        const responseText = await response.text();
        let data;
        try { data = responseText ? JSON.parse(responseText) : {}; }
        catch { data = { ok: response.ok, message: responseText || "Plugin API returned a non-JSON response." }; }
        respond(response.status, data);
      } catch (error) {
        respond(Number(error?.statusCode || 400), {
          ok: false,
          code: "PLUGIN_API_BRIDGE_REJECTED",
          message: error?.message || "Plugin API bridge rejected the request.",
        });
      }
    };

    window.addEventListener("message", handlePluginApiRequest);
    setBridgePluginId(pluginId);
    return () => window.removeEventListener("message", handlePluginApiRequest);
  }, [pluginId]);

  if (!plugin?.clientUrl) {
    return (
      <div className="generic-page">
        <div className="panel plugin-host-unavailable">
          <h3>Plugin client unavailable</h3>
          <p>Enable this plugin in Settings, then restart Homestead if it includes server routes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="plugin-host-page">
      <iframe
        ref={frameRef}
        src={bridgePluginId === pluginId ? plugin.clientUrl : "about:blank"}
        title={plugin.name || plugin.id}
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts"
        referrerPolicy="same-origin"
      />
    </div>
  );
}`;

  next = next.replace(pluginHostPattern, bridgedPluginHost);
  changes.push("secure generic Plugin API Bridge");
}

if (!changes.length) {
  console.log(`The ai.main surface and Plugin API Bridge are already present in ${target}.`);
  process.exit(0);
}

if (
  !next.includes(slotMarker) ||
  !next.includes(bridgeMarker) ||
  !next.includes("<PluginHostPage plugin={aiMainPlugin} />") ||
  !next.includes('type: "homestead:plugin-api-response"')
) {
  console.error("Safe patch verification failed before write. No files were changed.");
  process.exit(4);
}

if (checkOnly) {
  console.log(`Patch can add ${changes.join(" and ")} to ${target}.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${target}.before-plugin-host-${stamp}.bak`;
const temporary = `${target}.${process.pid}.plugin-host.tmp`;
fs.copyFileSync(target, backup);
fs.writeFileSync(temporary, next, "utf8");
fs.renameSync(temporary, target);
console.log(`Added ${changes.join(" and ")} to ${target}.`);
console.log(`Backup: ${backup}`);
