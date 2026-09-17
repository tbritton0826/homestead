const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const server = read("server.cjs");
const app = read("src/App.jsx");
const css = read("src/App.css");

assert.equal(pkg.version, "0.6.8.64");
assert.equal(lock.version, "0.6.8.64");
assert.equal(lock.packages[""].version, "0.6.8.64");
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.58-pass.cjs"));
assert(pkg.scripts["test:full-pass"].includes("test-0.6.8.59-pass.cjs"));

// Panty-size sorting uses clothing-size order, not lexical order.
const sortStart = app.indexOf("function compareAdultPantySizes");
const sortEnd = app.indexOf("function AdultLibraryPage", sortStart);
assert(sortStart >= 0 && sortEnd > sortStart);
const { compareAdultPantySizes } = new Function(`${app.slice(sortStart, sortEnd)}; return { compareAdultPantySizes };`)();
assert(compareAdultPantySizes("Juniors XXS/3", "Juniors XS") < 0);
assert(compareAdultPantySizes("Juniors XS", "Juniors S") < 0);
assert(compareAdultPantySizes("M", "XL") < 0);

// Crop coordinates stay finite and the transformed image is contained inside
// the fixed preview instead of participating in page layout.
assert(app.includes("const verticalLimit = Number.isFinite(metrics?.maxY)"));
assert(app.includes("translate(-50%, -50%) translate3d"));
assert(!app.includes('value={offset.y} disabled={!metrics?.maxY}'));
assert(css.includes("contain: layout paint size"));
assert(css.includes("overscroll-behavior: contain"));

// Saved metadata is merged into the live profile synchronously and subsequent
// parent refreshes update an already-open profile with the same id.
assert(app.includes("metadata: mergeAdultLoadedMetadata(current.metadata || {}, person?.metadata || {})"));
assert(app.includes("const mergedMetadata = mergeAdultLoadedMetadata(base?.metadata || {}, nextMetadata || {})"));
assert(app.includes("profile: updatedProfile"));
assert(server.includes('path.join(profileDir, "metadata.json")'));
assert(server.includes("atomicWriteJson(metadataPath, next)"));

// URL imports now preview, select, approve, de-duplicate, and only then save.
assert(app.includes('fetch("/api/adult/import-preview-url"'));
assert(app.includes("profileImportSelectedUrls"));
assert(app.includes("I reviewed these selections and approve saving the selected media"));
assert(app.includes("Import Selected (${profileImportSelectedUrls.length})"));
assert(server.includes("requestedSelectedUrls"));
assert(server.includes('error: "Review and approve the selected media before importing it."'));
assert(server.includes("const seenSelection = new Set()"));
assert(server.includes("selectedImport: true"));
assert(css.includes(".profile-import-candidate-grid"));

console.log("Homestead 0.6.8.59 profile sizing, crop stability, metadata refresh, and selective gallery import checks passed.");
