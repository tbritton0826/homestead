const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const nextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const mirroredNextVersion = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.match(nextVersion, /version: "0\.6\.8\.64"/);
assert.match(mirroredNextVersion, /version: "0\.6\.8\.64"/);

assert.match(server, /schemaVersion: 2[\s\S]*devices: \{\}/);
assert.match(server, /APPEARANCE_DEVICE_FIELDS/);
assert.match(server, /x-homestead-device-id/i);
assert.match(app, /homestead-appearance-device-id-v1/);
assert.match(app, /device\.libraries\?\.\[library\]/);
assert.match(app, /accountAppearanceStorageKey/);

assert.match(server, /\/api\/recipes\/categories/);
assert.match(server, /recipeAccountId/);
assert.match(app, /function RecipeCategoryEditor/);
assert.match(app, /No custom categories yet/);
assert.doesNotMatch(app, /const RECIPE_CATEGORIES/);
assert.doesNotMatch(server, /category: cleanRecipeValue\(req\.body\?\.category \|\| "Dinner"/);

assert.match(app, /type: "shared-collections", entryLibrary: "tv"/);
assert.match(app, /dashboardOpen\?\.type !== "shared-collections"/);
assert.match(app, /inventory-add-yugioh/);
assert.match(app, /initialPreset=\{intakeRequest\.preset/);
assert.doesNotMatch(app, /className="inventory-v1-commandbar"/);
assert.match(app, /activeLibrary === "calendar"[\s\S]*upload-schedule/);

console.log("Homestead 0.6.8.46 consolidation, scoped appearance, inventory header, calendar, and recipe-category checks passed.");
