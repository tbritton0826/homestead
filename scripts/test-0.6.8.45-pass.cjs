const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const scanner = fs.readFileSync(path.join(root, "scripts", "scanners", "scan-media.cjs"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(pkg.version, "0.6.8.64");
assert.match(scanner, /movie-folder-identity-v2/);
assert.match(scanner, /libraryId === "movies"[\s\S]*normalize\("NFC"\)/);
assert.match(scanner, /sourceFolderName: entry\.name/);
const normalizerSource = scanner.match(/function normalizeLibraryItemKey\(libraryId, value\) \{[\s\S]*?\n\}\n\nfunction uniqueByPath/)?.[0].replace(/\n\nfunction uniqueByPath[\s\S]*$/, "");
assert.ok(normalizerSource, "movie identity normalizer is available");
const normalizeLibraryItemKey = new Function(`${normalizerSource}; return normalizeLibraryItemKey;`)();
assert.equal(normalizeLibraryItemKey("movies", "Wonder Woman (2017)"), "wonder-woman-2017");
assert.equal(normalizeLibraryItemKey("movies", "Wonder Woman 1984 (2020)"), "wonder-woman-1984-2020");
assert.notEqual(normalizeLibraryItemKey("movies", "Wonder Woman (2017)"), normalizeLibraryItemKey("movies", "Wonder Woman 1984 (2020)"));
assert.match(app, /homestead-book-edition-links-v1/);
assert.match(app, /Link as edition/);
assert.match(app, /fetch\("\/api\/books\/edition-links"/);
assert.match(server, /app\.get\("\/api\/books\/edition-links"/);
assert.match(server, /app\.put\("\/api\/books\/edition-links"/);
assert.match(app, /Only explicit work-level identifiers may merge/);
assert.doesNotMatch(app, /return `\$\{normalize\(workTitle\)\}\|\$\{normalize\(book\.author\)\}`/);
assert.match(css, /book-edition-manage-list/);
assert.match(css, /height: 720px/);

console.log("0.6.8.45 movie identity, safe Book editions, and stable profile layout checks passed.");
