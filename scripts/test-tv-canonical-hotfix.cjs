const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

const movieWrite = server.match(/const canonicalKey = `movies:[\s\S]{0,420}?movieAutoMatchStatus\.matched/);
const tvWrite = server.match(/const canonicalKey = `tv:[\s\S]{0,420}?tvAutoMatchStatus\.matched/);
assert.ok(movieWrite && movieWrite[0].includes("aliasKey !== canonicalKey"), "Movie auto-match preserves canonical record");
assert.ok(tvWrite && tvWrite[0].includes("aliasKey !== canonicalKey"), "TV auto-match preserves canonical record");
assert.ok(!app.includes("{show.year && <p>{show.year}</p>}"), "TV grid does not display years");
console.log("Homestead 0.5.6.2 canonical metadata match regression checks: PASSED");
