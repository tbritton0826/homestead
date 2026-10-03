const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert(app.includes('title="Edit Quick Instruction"'));
assert(app.includes("function quickInstructionEditorDraft"));
assert(app.includes('editing ? "PATCH" : "POST"'));
assert(app.includes('accept="image/jpeg,image/png,image/webp"'));
assert(app.includes('editing ? "Update Instructions" : "Save Instructions"'));
assert(css.includes(".quick-instruction-poster-preview"));
assert(css.includes(".recipe-detail-edit"));
assert(server.includes('app.patch("/api/recipes/:recipeId", homesteadAccess.requireSession, async'));
assert(server.includes("saveRecipeArtwork(current.id, decodeRecipeImageDataUrl(req.body.imageDataUrl))"));
assert(server.includes("quickSteps: Array.isArray(req.body?.quickSteps)"));

console.log("Quick Instruction editing and poster artwork checks passed.");
