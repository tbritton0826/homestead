"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const scanner = fs.readFileSync(path.join(root, "scripts", "scanners", "scan-media.cjs"), "utf8");
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const pkg = require(path.join(root, "package.json"));

assert.equal(pkg.version, "0.6.8.64");

assert.match(dockerfile, /node:20-bookworm-slim/);
assert.match(dockerfile, /rembg\[cpu,cli\]==2\.0\.84/);
assert.match(dockerfile, /REMBG_HOME=\/opt\/homestead-rembg-models/);
assert.match(dockerfile, /rembg d u2net/);

assert.match(server, /REMOTE_ARTWORK_CACHE_ROOT/);
assert.match(server, /\/api\/artwork\/cache/);
assert.match(server, /remoteArtworkNegativeCache/);
assert.match(server, /AbortSignal\.timeout\(6000\)/);
assert.match(server, /args: \["i", "-m", "u2net", resolvedInput, temporaryOutput\]/);

assert.match(server, /backupArtworkIndexes/);
assert.match(server, /before-full-scan/);
assert.match(server, /before-artwork-relink/);
assert.match(server, /saveConfirmedMatchArtwork/);
assert.match(server, /fileName: "poster\.jpg"/);
assert.match(server, /fileName: "fanart\.jpg"/);
assert.match(server, /fix-match-/);
assert.match(server, /\/api\/admin\/artwork\/recover/);

assert.match(app, /homeMusicArtwork/);
assert.match(app, /artistLocalPoster/);
assert.match(app, /The scanner already records which local poster\/banner files exist/);
assert.match(app, /preserveArtwork, matchSource: "movie-fix-match"/);
assert.match(app, /preserveArtwork, matchSource: "tv-fix-match"/);
assert.match(scanner, /isNestedAlbumArtwork/);

console.log("Homestead 0.6.8.55 artwork recovery, local Fix Match art, music posters, rembg runtime, and artwork performance checks passed.");
