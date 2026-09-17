const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const sources = require(path.join(root, "scripts", "metadata", "adult-sources.cjs"));
const {
  getAdultMetadataSourceProfile,
  parseTheNudeProfileHtml,
} = require(path.join(root, "scripts", "metadata", "fetch-adult-metadata.cjs"));

const source = sources.DEFAULT_ADULT_SOURCES.find((entry) => entry.id === "thenude");
assert(source, "TheNude source must be registered");
assert.deepEqual(source.profileTypes, ["performer"]);
assert.equal(source.supportsImport, false);
assert.equal(source.supportsArtwork, false);
assert.equal(source.supportsFixMatch, false);
assert.match(source.searchUrlTemplate, /searchModels/);
assert.equal(getAdultMetadataSourceProfile("performers").providerRank.thenude, 10);

const html = `
<!doctype html>
<html>
<head>
  <title>Abisha nude from Example</title>
  <meta name="description" content="Abisha began her modeling career in 2009 and is also known as Emma. This performer-directory biography is long enough for the metadata check.">
  <meta property="og:image" content="https://img.example/abisha.jpg">
</head>
<body>
  <h1>Abisha</h1>
  <ul>
    <li><b>AKA:</b> Abisha, Emma</li>
    <li><b>ICGID:</b> AX-00BV</li>
    <li><b>Born:</b></li>
    <li><b>Birthplace:</b> Russia</li>
    <li><b>First Seen:</b> 2009</li>
    <li><b>Last Seen:</b> 2009</li>
    <li><b>Measurements:</b> 32-24-34</li>
    <li><b>Body Type:</b> Slim</li>
    <li><b>Height:</b> 165 cm</li>
    <li><b>Piercings:</b> Navel</li>
    <li><b>Hair Colour:</b> Brown</li>
    <li><b>Ethnicity:</b> Caucasian</li>
    <li><b>Breasts:</b> Small (Real)</li>
    <li><b>Tattoos:</b> None</li>
    <li><b>Activities:</b> Glamour</li>
  </ul>
</body>
</html>`;

const parsed = parseTheNudeProfileHtml(html, "https://www.thenude.com/Abisha_13447.htm", "Abisha");
assert(parsed);
assert.equal(parsed.name, "Abisha");
assert.deepEqual(parsed.aliases, ["Abisha", "Emma"]);
assert.equal(parsed.providerIds.thenude, "AX-00BV");
assert.equal(parsed.birthPlace, "Russia");
assert.equal(parsed.careerStart, "2009");
assert.equal(parsed.careerEnd, "2009");
assert.equal(parsed.height, "165 cm");
assert.equal(parsed.measurementsRaw, "32-24-34");
assert.equal(parsed.bodyType, "Slim");
assert.equal(parsed.breastDetails, "Small (Real)");
assert.equal(parsed.hairColor, "Brown");
assert.equal(parsed.ethnicity, "Caucasian");
assert.equal(parsed.requiresReview, true);
assert.equal(parsed.enrichmentOnly, true);
assert.equal(parsed.mediaReviewRequired, true);

assert(server.includes('theNudeEnabled: sourceEnabled("thenude")'));
assert(app.includes("thenude"));

console.log("Performer TheNude supplemental metadata checks passed.");
