const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");
assert.match(server, /Referrer-Policy", "strict-origin-when-cross-origin"/);
assert.match(app, /youtube-nocookie\.com\/embed/);
assert.match(app, /referrerPolicy="strict-origin-when-cross-origin"/);
assert.match(app, /Watch on YouTube/);
assert.match(server, /app\.get\("\/api\/integrations\/readarr\/status"/);
assert.match(server, /name === "readarr"\) url \+= "\/api\/v1\/system\/status"/);
assert.match(server, /\/api\/collections\/:collectionId\/artwork\/:role/);
assert.match(app, /Browse Poster/);
assert.match(app, /Scrollable exact watch order/);
assert.match(app, /homesteadAdultProfileSort/);
assert.match(css, /orientation: portrait/);
assert.match(css, /touch-action: pan-y/);

console.log("0.6.8.45 retained full public pass checks passed.");
