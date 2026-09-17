const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const lock = require(path.join(root, "package-lock.json"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const sources = require(path.join(root, "scripts", "metadata", "adult-sources.cjs"));
const { validatedAdultHeight } = require(path.join(root, "scripts", "metadata", "fetch-adult-metadata.cjs"));

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.60-pass.cjs"));

assert.equal(validatedAdultHeight("5 ft 7 in"), "5 ft 7 in");
assert.equal(validatedAdultHeight("170 cm"), "170 cm");
assert.equal(validatedAdultHeight("1.70 m"), "1.7 m");
assert.equal(validatedAdultHeight("67 inches"), "5 ft 7 in");
assert.equal(validatedAdultHeight("10,method: 'polygon',border: 2,classes: 'qtip-flight'}"), "");
assert(server.includes("sanitizeAdultHeightMetadata"));

assert(app.includes("parseAdultPantySize"));
assert(app.includes('value="juniors"'));
assert(app.includes("Adult XS and Juniors XS stay separate"));
assert(css.includes("adult-profile-filter-fields"));

const celebrityInside = sources.DEFAULT_ADULT_SOURCES.find((source) => source.id === "celebrityinside");
assert(celebrityInside);
assert.equal(celebrityInside.priority, 91);
assert.equal(celebrityInside.supportsFixMatch, false);
assert(server.includes('celebrityInsideEnabled: sourceEnabled("celebrityinside")'));

assert(app.includes("canonicalSocialUrlFromHandle"));
assert(app.includes("displaySocialLinks"));
assert(app.includes("https://www.instagram.com/${value}/"));

assert(app.includes("QuickInstructionEditor"));
assert(app.includes("QuickStepTimer"));
assert(app.includes("Quick Instructions"));
assert(server.includes('entryType: req.body?.entryType === "quick-instruction"'));
assert(server.includes("timerSeconds: Math.min(86400"));
assert(css.includes("quick-instruction-editor"));

console.log("Homestead 0.6.8.60 profile filters, strict height validation, CelebrityInside, social links, and Quick Instructions checks passed.");
