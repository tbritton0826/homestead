const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const lock = require(path.join(root, "package-lock.json"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const mirroredNextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const entitlements = fs.readFileSync(path.join(root, "src", "server", "subscription-entitlements.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.63-pass.cjs"));
assert.match(nextVersion, /version: "0\.6\.8\.64"/);
assert.match(mirroredNextVersion, /version: "0\.6\.8\.64"/);

assert(server.includes('app.get("/api/integrations/seerr/status", handleSeerrStatus)'));
assert(server.includes('app.get("/api/integrations/jellyseerr/status", handleSeerrStatus)'));
assert(app.includes('const statusId = id === "jellyseerr" ? "seerr" : id;'));
assert(server.includes('require("./src/server/subscription-entitlements.cjs")'));
assert(entitlements.includes('concurrentStreams: 1'));
assert(entitlements.includes('limits: { users: 1, concurrentStreams: 1 }'));

console.log("Homestead 0.6.8.64 Free-preview entitlements and Jellyseerr connection compatibility checks passed.");
