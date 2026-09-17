const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");

assert.equal(pkg.version, "0.6.8.64");
assert.match(app, /tabletPosterScale/);
assert.match(app, /desktopPosterScale/);
assert.match(app, /Other screen layout is preserved/);
assert.match(css, /height: 720px;\s*min-height: 720px;\s*max-height: 720px;/);
assert.match(app, /function BookEditionChooser/);
assert.match(app, /Choose Edition/);
assert.match(app, /normalizeBookWorkIdentity/);
assert.match(app, /const bookWorks = useMemo/);
assert.match(app, /editionCount: editions\.reduce/);
assert.match(app, /progressKey = `book:/);

console.log("0.6.8.44 responsive profile poster and multi-edition Books checks passed.");
