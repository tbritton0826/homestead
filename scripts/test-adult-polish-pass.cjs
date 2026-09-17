const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createPublicPersonDiscovery, quantity, buildQuery } = require("../src/server/public-person-discovery.cjs");
const { parseModelsProfileHtml, strongModelsMatch, createModelsLookup } = require("./metadata/models-com.cjs");
const { normalizeAdultCandidateForMetadata } = require("./metadata/fetch-adult-metadata.cjs");
const { discoverStructuredRecommendations } = require("../src/server/adult-recommendations.cjs");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const openPreferences = { gender: "female", minAge: 18, maxAge: 100, bodyTypes: [], breastShapes: [], heightCategories: [], maxWeight: 0, pantySizeMax: "", braBandMax: 0, cupSizeMax: "", requirePoster: true, matchMode: "compatible" };
async function run() {
  const f = await import("../src/utils/display-format.js");
  const { parseVideoDisplay } = await import("../src/utils/video-display.js");
  const formats = { MMM_D_YYYY: "Aug 26, 1993", MM_DD_YYYY_DASH: "08-26-1993", MM_DD_YYYY_SLASH: "08/26/1993", YYYY_MM_DD_SLASH: "1993/08/26", YYYY_MM_DD_DASH: "1993-08-26", D_MMM_YYYY: "26 Aug 1993", MMM_D: "Aug 26" };
  for (const [dateFormat, expected] of Object.entries(formats)) {
    f.setActiveDisplayPreferences({ dateFormat });
    for (const value of ["1993-08-26", "08/26/1993", "1993/08/26", "Aug 26, 1993"]) assert.equal(f.formatHomesteadDate(value), expected);
  }
  f.setActiveDisplayPreferences({});
  assert.equal(f.formatHomesteadDate("2025-02-29"), "—");
  assert.equal(f.formatHomesteadDate("2024-02-29"), "Feb 29, 2024");
  assert.equal(f.formatHomesteadDate("2024"), "2024");
  assert.equal(f.formatHomesteadDate("2024-04"), "Apr 2024");
  assert.equal(f.formatHomesteadHeight("71.99 in"), "6'-0\"");
  f.setActiveDisplayPreferences({ heightFormat: "CM", weightFormat: "KG", measurementFormat: "CM" });
  assert.equal(f.formatHomesteadHeight("5' 7\""), "170.2 cm");
  assert.equal(f.formatHomesteadWeight("100 lb"), "45.4 kg");
  assert.equal(f.formatHomesteadMeasurements("34-24-35"), "86.4 cm / 61 cm / 88.9 cm");
  assert.equal(f.formatHomesteadMeasurements({}), "—");
  assert.equal(f.normalizeDisplayInput("height", "170").value, "170 cm");
  assert.equal(f.normalizeDisplayInput("weight", "50").value, "50 kg");
  assert.equal(f.normalizeDisplayInput("birthday", "Feb 30, 2000").valid, false);
  assert.equal(f.normalizeDisplayInput("measurements", "86-61-89 cm").value, "86-61-89 cm");
  f.setActiveDisplayPreferences({ dateFormat: "MMM_D" });
  assert.equal(f.normalizeDisplayInput("birthday", "Aug 27", "1993-08-26").value, "1993-08-27");
  const stored = { birthday: "1993-08-26", height: { value: 170.18, unit: "cm" }, weight: "45.359237 kg" };
  const snapshot = JSON.stringify(stored);
  for (const account of [{ heightFormat: "INCHES", weightFormat: "LBS" }, { heightFormat: "CM", weightFormat: "KG" }]) {
    f.setActiveDisplayPreferences(account); for (const [field, value] of Object.entries(stored)) f.formatHomesteadField(field, value);
  }
  assert.equal(JSON.stringify(stored), snapshot, "display must never mutate stored values");
  f.setActiveDisplayPreferences({ dateFormat: "D_MMM_YYYY" }, { displayPreferences: { dateFormat: "YYYY_MM_DD_DASH" } });
  assert.equal(f.formatHomesteadDate(stored.birthday), "26 Aug 1993");
  f.setActiveDisplayPreferences({}, {});
  assert.equal(f.formatHomesteadDate(stored.birthday), "Aug 26, 1993", "account changes must clear prior preferences");

  const video = { id: "keep", path: "/media/adult/videos/unchanged.mp4", name: "Example.com.2024.08.26.Alex_Smith--A_Quiet_Day.1080p.x264.[scene-12345].mp4" };
  const videoBefore = JSON.stringify(video), parsed = parseVideoDisplay(video);
  assert.equal(parsed.displayTitle, "Alex Smith — A Quiet Day");
  assert.equal(parsed.source, "Example.com"); assert.equal(parsed.date, "2024-08-26");
  assert(parsed.quality.includes("1080p")); assert(parsed.sceneCodes.includes("12345"));
  assert.equal(JSON.stringify(video), videoBefore);
  assert.equal(parseVideoDisplay({ name: "Alex.2024.08.26.Travel.mp4" }).source, "", "a person name must not be guessed to be a studio");
  assert(parseVideoDisplay({ name: "Alex.2024.02.30.Travel.mp4" }).displayTitle.includes("2024 02 30"));
  assert.equal(parseVideoDisplay({ name: "1080p.mp4" }).confidence, "fallback");
  assert.equal(parseVideoDisplay({ ...video, title: "Manually chosen title" }).displayTitle, "Manually chosen title");

  const profileHtml = '<title>Alex Example - Model</title><script type="application/ld+json">' + JSON.stringify({ "@type": "Person", name: "Alex Example", nationality: "Canada", jobTitle: "Model", description: "A public professional biography.", birthDate: "1990-01-02", sameAs: ["https://instagram.com/alexexample"], additionalProperty: [{ name: "Height", value: 170, unitText: "cm" }, { name: "Waist", value: 25, unitText: "in" }] }) + '</script><table><tr><th>Bust (cm)</th><th>Hair</th><th>Shoe (EU)</th></tr><tr><td>86</td><td>Brown</td><td>38</td></tr></table><a href="/agencies/example">Example Agency</a><a href="/work/example">Example Work</a>';
  const candidate = parseModelsProfileHtml(profileHtml, "https://models.com/people/alex-example");
  assert.equal(candidate.height, "170 cm"); assert.equal(candidate.bust, "86 cm");
  assert.equal(candidate.shoeSize, "38 EU"); assert.equal(candidate.agencies[0].name, "Example Agency");
  assert.equal(strongModelsMatch(candidate, { name: "Alex Example" }), false, "name only is not a strong match");
  assert.equal(strongModelsMatch(candidate, { name: "Alex Example", birthday: "1990-01-02" }), true);
  assert.equal(strongModelsMatch(candidate, { name: "Alex Example", birthday: "1989-01-02", nationality: "Canada", occupation: "Model" }), false);
  assert.equal(strongModelsMatch(candidate, { name: "Alex Example", nationality: "Canada", occupation: "Model" }), true);
  assert.equal(parseModelsProfileHtml("<title>Just a moment</title>cf-chl-test", candidate.url), null);
  const enriched = normalizeAdultCandidateForMetadata(candidate, { biography: "Manual biography", height: "168 cm", manualMetadataFields: ["biography"], metadataLocks: { height: true } });
  assert.equal(enriched.biography, "Manual biography"); assert.equal(enriched.height, "168 cm");
  assert.equal(enriched.bust, "86 cm");
  const lookup = createModelsLookup({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => profileHtml }) });
  assert.equal(await lookup("Alex Example", [{ name: "Alex Example" }]), null);
  assert.equal((await lookup("Alex Example", [{ name: "Alex Example", birthday: "1990-01-02" }])).provider, "models-com");
  const blocked = createModelsLookup({ fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(() => blocked("Alex Example", []), /unavailable/);
  assert.equal(quantity({ amount: "+60", unit: "http://www.wikidata.org/entity/Q218593" }, "length"), 152.4);
  assert.equal(quantity({ amount: "+1000", unit: "http://www.wikidata.org/entity/Q41803" }, "mass"), 1);
  assert.equal(quantity({ amount: "+100", unit: "unknown" }, "length"), null);
  assert(!buildQuery("Q33999", openPreferences).includes("ORDER BY"));
  let calls = 0, failed = false, clock = Date.now();
  const claim = (value) => [{ mainsnak: { datavalue: { value } } }];
  const discovery = createPublicPersonDiscovery({ now: () => clock, fetchImpl: async (url) => {
    calls++; if (failed || decodeURIComponent(url).includes("Q10800557")) throw new Error("Fixture source timeout");
    if (url.includes("/sparql")) return { ok: true, json: async () => ({ results: { bindings: [{ person: { value: "http://www.wikidata.org/entity/Q123" } }] } }) };
    return { ok: true, json: async () => ({ entities: { Q123: { id: "Q123", labels: { en: { value: "Fixture Person" } }, claims: { P569: claim({ time: "+1990-01-02T00:00:00Z", precision: 11 }), P21: claim({ id: "Q6581072" }), P18: claim("Fixture.jpg") } } } }) };
  } });
  const first = await discovery({ profileType: "celebrity", preferences: openPreferences });
  assert.equal(first.items.length, 1); assert.equal(first.diagnostics[0].partial, true);
  const count = calls; await discovery({ profileType: "celebrity", preferences: openPreferences }); assert.equal(calls, count);
  assert.equal((await discovery({ profileType: "celebrity", preferences: openPreferences, existingNames: ["Fixture Person"] })).items.length, 0);
  failed = true; clock += 3600000;
  const stale = await discovery({ profileType: "celebrity", preferences: openPreferences });
  assert.equal(stale.items.length, 1); assert.equal(stale.diagnostics[0].stale, true);
  const start = Date.now();
  const structured = await discoverStructuredRecommendations({ profileType: "celebrity", preferences: openPreferences, providers: ["slow", "good"].map((id) => ({ id, name: id, type: "json", enabled: true, endpoint: "https://example.test/" + id, requiresApiKey: false, profileTypes: ["celebrity"], timeoutMs: 100 })), fetchImpl: (url) => url.includes("slow") ? new Promise(() => {}) : Promise.resolve({ ok: true, json: async () => ({ items: [{ id: "good", name: "Good Example", gender: "female", birthDate: "1990-01-02", imageUrl: "https://example.test/poster.jpg" }] }) }) });
  assert.equal(structured.items.length, 1); assert(structured.diagnostics.some((row) => !row.ok)); assert(Date.now() - start < 2000);

  const { transformWithOxc } = await import("vite");
  async function component(file, name, context = {}) {
    const code = read(file).replace(/^import .*;$/gm, "").replace(/export default /g, "");
    const result = await transformWithOxc(code, name + ".jsx", { jsx: { runtime: "classic" } });
    return vm.runInNewContext(result.code + "; " + name, { React, ...React, ...f, ...context });
  }
  const Photos = await component("src/components/PhotosLibraryPage.jsx", "PhotosLibraryPage", { photoUrl: (photo) => photo?.path || photo || "" });
  const index = { libraries: { photos: { public: { id: "public", name: "Public album", files: [] } }, adultPhotos: { private: { id: "private", name: "Private album", files: [{ type: "image", path: "/private/photo.jpg" }] } } } };
  const privateHtml = renderToStaticMarkup(React.createElement(Photos, { mediaIndex: index, libraryKey: "adultPhotos" }));
  const publicHtml = renderToStaticMarkup(React.createElement(Photos, { mediaIndex: index }));
  assert(privateHtml.includes("Private album")); assert(!privateHtml.includes("Public album"));
  assert(publicHtml.includes("Public album")); assert(!publicHtml.includes("Private album"));
  const Video = await component("src/components/AdultVideoCard.jsx", "AdultVideoCard", { parseVideoDisplay, photoUrl: (file) => file?.path || "" });
  const videoHtml = renderToStaticMarkup(React.createElement(Video, { video }));
  assert(videoHtml.includes("Alex Smith")); assert(!videoHtml.includes(">1080p<")); assert(!videoHtml.includes(">12345<"));
  const app = read("src/App.jsx"), css = read("src/AdultPolish.css");
  const home = app.slice(app.indexOf("function AdultHubPage"), app.indexOf("const ADULT_LIBRARY"));
  assert(app.includes('libraryKey="adultPhotos"'));
  assert(!app.includes("<h2>Adult Photo Imports</h2>"));
  assert(css.includes("grid-auto-flow: column")); assert(css.includes("isolation: isolate"));
  assert(read("src/components/ProfileToolPortal.jsx").includes("document.body"));
  assert(app.includes("normalizeDisplayInput(field, editableMetadata[field]"));
  console.log("Adult polish 0.6.8: formatter, canonical edits, filenames, source failure isolation/cache, Models identity/merge, shared Photos/privacy, SSR and stacking checks PASSED.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
