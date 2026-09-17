const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const lock = require(path.join(root, "package-lock.json"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.64-pass.cjs"));

assert(server.includes('app.use("/api/integrations", subscriptionService.requireFeature("externalIntegrations"))'));
assert(server.includes('app.post("/api/setup/test-integration", homesteadAccess.requireOwner, subscriptionService.requireFeature("externalIntegrations")'));
assert(server.includes('app.get("/api/admin/integration-health", homesteadAccess.requireAdmin, subscriptionService.requireFeature("externalIntegrations")'));
assert(server.includes('if (!subscriptionService.has("externalIntegrations"))'));
assert(server.includes("storedConfig.integrationSettings = {}"));
assert(app.includes("Connected Services Are Not Included"));
assert(app.includes('settingsTab === "integrations" && integrationsAvailable'));
assert(app.includes("integrationsAvailable ? <MediaIntegrationsToolPage"));

console.log("Homestead 0.6.8.64 Free integration enforcement checks passed.");
