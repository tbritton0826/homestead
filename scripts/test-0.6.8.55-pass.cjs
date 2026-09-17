"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "src", "components", "adult", "AddAdultProfileModal.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const metadata = fs.readFileSync(path.join(root, "scripts", "metadata", "fetch-adult-metadata.cjs"), "utf8");
const { DEFAULT_ADULT_SOURCES } = require(path.join(root, "scripts", "metadata", "adult-sources.cjs"));
const pkg = require(path.join(root, "package.json"));

assert.equal(pkg.version, "0.6.8.64");

const posterStart = app.indexOf("const rawCandidates = [", app.indexOf("function getProfilePosterCandidates"));
const posterEnd = app.indexOf("];", posterStart);
const posterOrder = app.slice(posterStart, posterEnd);
assert(posterOrder.indexOf("profile.selectedPoster") < posterOrder.indexOf("profile.headshot"), "Selected profile poster must precede the headshot fallback.");
assert(posterOrder.indexOf("metadata.poster") < posterOrder.indexOf("metadata.headshot"), "Selected metadata poster must precede metadata headshot.");
assert.match(app, /artworkRevision \|\| person\?\.updatedAt/);
assert.match(app, /\.\.\.existingCandidates,\s*manifestHeadshot/);

assert.match(server, /function collectSeerrPersonCredits/);
assert.match(server, /optionalPaths = \["combined_credits", "combinedcredits", "credits"\]/);
assert.match(app, /function SeerrPersonSearchSection/);
assert.match(app, /People &amp; Appearances/);
assert.match(app, /mediaType === "person"/);
assert.match(app, /function handleSeerrPersonSelect/);
assert.match(app, /Create Profile & Search Sources/);
assert.match(app, /<MediaStatusBadge status=\{itemStatus\}/);

const teenIdols = DEFAULT_ADULT_SOURCES.find((source) => source.id === "teenidols4you");
const celebrityTall = DEFAULT_ADULT_SOURCES.find((source) => source.id === "celebritytall");
assert(teenIdols?.enabled && teenIdols.profileTypes.includes("celebrity"));
assert.match(teenIdols.notes, /not an adult-only catalog/i);
assert(celebrityTall?.enabled && celebrityTall.priority >= 90);
assert.match(celebrityTall.notes, /Last-resort secondary source/i);

assert.match(metadata, /async function searchTeenIdolsMetadata/);
assert.match(metadata, /if \(currentAge !== null && currentAge < 18\) return \[\]/);
assert.match(metadata, /if \(adultYear && year && year < adultYear\) continue/);
assert.match(metadata, /requiresAgeReview: !verifiedAdultEra/);
assert.match(metadata, /async function searchCelebrityTallMetadata/);
assert.match(metadata, /libraryType === "celebrities" && options\.celebrityTallEnabled !== false/);
assert.match(metadata, /fallbackOnly: true/);
assert.match(modal, /Age\/date uncertain/);
assert.match(modal, /selectAndAggregateMetadata\(initialCandidate/);

console.log("Homestead 0.6.8.55 selected profile posters, cohesive person appearances, and reviewed celebrity-source checks passed.");
