const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const lock = require(path.join(root, "package-lock.json"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const activityJobs = fs.readFileSync(path.join(root, "src", "server", "activity-jobs.cjs"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const mirroredNextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const profileWizard = fs.readFileSync(path.join(root, "src", "components", "adult", "AddAdultProfileModal.jsx"), "utf8");

assert.match(pkg.version, /^0\.6\.8\.(?:62|63|64)$/);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.62-pass.cjs"));
assert.match(nextVersion, /version: "0\.6\.8\.(?:62|63|64)"/);
assert.match(mirroredNextVersion, /version: "0\.6\.8\.(?:62|63|64)"/);

assert(app.includes('runProfileAction("family")}>Link Family Profile'));
assert(app.includes('profileToolOverlay === "family"'));
assert(app.includes('className="profile-family-tree"'));
assert(app.includes('Use Actions → Link Family Profile to add one.'));
assert.equal((app.match(/tab === "family"/g) || []).length, 1);
assert(css.includes(".profile-family-linked-card:hover"));

assert(profileWizard.includes('destination: item.destination || "photos"'));
assert(profileWizard.includes('destination: item.kind === "video" ? "videos" : "photos"'));
assert(profileWizard.includes("function setMediaDestination(itemId, destination)"));
assert(profileWizard.includes("Photos is the default folder."));
assert(profileWizard.includes("Save this photo in"));
assert(!profileWizard.includes("setBulkImageDestination"));
assert(profileWizard.includes("adult-profile-photo-viewer"));
assert(profileWizard.includes("View full size"));
assert(profileWizard.includes("moveMediaPreview"));
assert(css.includes(".adult-profile-photo-viewer-shell"));
assert(app.includes("const requestedFile = originalFiles"));
assert(app.includes('if (/^\\/api\\/file(?:\\?|$)/i.test(rawPublic))'));

assert(server.includes('const requestedMode = rawMode ? normalizeScanLibraryId(rawMode) : ""'));
assert(server.includes("let mediaScanRunning = false"));
assert(server.includes("Movies scan deferred without creating an Activity error"));
assert(server.includes("TV scan deferred without creating an Activity error"));
assert(server.includes("reconcileSkippedLibraryScans"));
assert(activityJobs.includes("Skipped because another media scan was already running. No media failed."));

console.log("Homestead 0.6.8.62 family layout, per-photo imports, photo viewers, and serialized media-scan checks passed.");
