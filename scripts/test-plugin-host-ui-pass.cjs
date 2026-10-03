"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const preferenceSource = fs.readFileSync(path.join(root, "src", "server", "next-version.cjs"), "utf8");
const scheduleRecognition = require(path.join(root, "src", "server", "schedule-recognition.cjs"));

assert(appSource.includes("homestead:plugin-command"), "Plugin host command bridge is missing.");
assert(appSource.includes("Promise.allSettled(searchablePlugins.map"), "Plugin searches are not isolated.");
assert(appSource.includes("Include in my global search"), "Per-user plugin search toggle is missing.");
assert(appSource.includes("plugin.hostIntegration?.settingsCommand"), "Plugin settings entry is missing.");
assert(serverSource.includes("hostIntegration: plugin.manifest?.hostIntegration || null"), "Plugin host manifest contract is missing.");
assert(preferenceSource.includes("pluginSearch: Object.fromEntries"), "Plugin search preferences are not persisted.");
assert(appSource.includes("plugin-host-section-actions"), "Plugin section actions are missing.");
assert(appSource.includes("Array.isArray(action?.sections)"), "Section-aware global plugin actions are missing.");
assert(appSource.includes("homestead:plugin-appearance"), "Plugin background bridge is missing.");
assert(appSource.includes("/host/cards"), "Adult plugin card summaries are missing.");
assert(appSource.includes("Promise.allSettled(["), "Plugin card summaries are not failure-isolated.");
assert(appSource.includes("person-card-panty-badge"), "Panty Archive card badge is missing.");
assert(appSource.includes("person-card-dominion-badge"), "Dominion card badge is missing.");
assert(appSource.includes("function ProfileNotesPanel({ profile = {}, onMetadataSaved, editRequest = 0 })"), "Notes editor request handling is not wired.");
assert(appSource.includes("activePluginSectionDefinition?.title"), "Plugin section-aware header title is missing.");
assert(appSource.includes("profile-plugin-decoration dominion"), "Dominion profile decorations are missing.");
assert(appSource.includes("ethnicityInclude") && appSource.includes("ethnicityExclude"), "Race/ethnicity recommendation filters are missing.");
assert(serverSource.includes("adultRecommendationMatchesEthnicity"), "Server-side race/ethnicity recommendation filtering is missing.");
assert(serverSource.includes("collectAdultPersonMediaCandidates"), "Reviewed metadata media candidate collection is missing.");
assert(serverSource.includes("/api/appearance/config"), "Per-user appearance configuration API is missing.");
assert(appSource.includes("homestead:resolved-appearance"), "Resolved appearance is not sent to hosted plugins.");
assert(appSource.includes("movie-filter-overlay-card"), "Movie year and genre filter overlay is missing.");
assert(appSource.includes("Owned · Not Added"), "Cross-library timeline ownership status is missing.");
assert(appSource.includes("ownershipItems={allOwnedCollectionItems}"), "Collection timelines are not checking the full owned library.");
assert(appSource.includes("activePluginSectionDefinition?.title"), "Page-aware plugin title is missing.");
assert(appSource.includes("function RecipeWizard({ onClose, onSaved, categories = [] })"), "Recipe intake wizard is missing.");
assert(appSource.includes('{ id: "add-recipe", label: "Add Recipe"'), "The Recipes page does not publish its global Add action.");
assert(appSource.includes('if (event.detail?.action === "add-recipe") setWizardOpen(true)'), "The Recipes global Add action does not open the recipe wizard directly.");
assert(appSource.includes('{wizardOpen && <RecipeWizard categories={categories}'), "The Recipes page does not mount its category-aware intake wizard.");
assert(appSource.includes('selectedCategoryDetails?.name || (selectedCategory === "favorites" ? "Favorite Recipes" : "All Recipes")'), "The Recipes landing page does not default to Favorites.");
assert(/function RecipeDetailsOverlay\(\{ recipe, (?:cookingMode = false, )?onClose, onToggleFavorite(?:, onEdit)? \}\)/.test(appSource), "The full recipe details overlay is missing.");
assert(appSource.includes('className="recipe-detail-columns"'), "Recipe ingredients and directions are not rendered in the details overlay.");
assert(appSource.includes('aria-label={`View ${recipe.title} recipe`}'), "Recipe cards are not accessible viewer controls.");
assert(appSource.includes('onClick={(event) => { event.stopPropagation(); toggleFavorite(recipe); }}'), "The recipe favorite control can accidentally open the details overlay.");
assert(appSource.includes('onClick={(event) => event.stopPropagation()}'), "The recipe source link can accidentally open the details overlay.");
assert(appSource.includes('<RecipeDetailsOverlay recipe={selectedRecipe}'), "The recipe details overlay is not mounted by the Recipes page.");
assert(!appSource.includes("For now this creates a placeholder recipe card."), "The placeholder URL importer is still rendered on the Recipes page.");
assert(appSource.includes('{ id: "family-home", name: "Family Archive"'), "Family Archive is missing from the desktop Family sidebar.");
assert(appSource.includes("← Back to Family Home"), "Family sublibraries are missing their Family Home return control.");
assert(!appSource.includes("<h2>Browse Family</h2>"), "The duplicate Browse Family ribbon is still on Family Home.");
assert(appSource.includes("function ScheduleImportModal"), "The reviewed schedule import wizard is missing.");
assert(appSource.includes("Link Family profile (optional)"), "Schedule imports still require a Family profile link.");
assert(appSource.includes("Needs coverage"), "The calendar coordination coverage view is missing.");
for (const route of [
  'app.get("/api/calendar"',
  'app.post("/api/calendar/events"',
  'app.patch("/api/calendar/events/:eventId"',
  'app.post("/api/calendar/schedule-preview"',
  'app.post("/api/calendar/schedule-import"',
]) assert(serverSource.includes(route), `Family calendar API route is missing: ${route}`);
assert(serverSource.includes("parseScheduleOcrText"), "Schedule OCR parsing is missing.");
assert(serverSource.includes("duplicate = calendar.events.some"), "Duplicate imported shifts are not guarded.");
assert(serverSource.includes('activityType: "calendar-schedule-import"'), "Schedule imports are not recorded in administrator Activity.");
assert(appSource.includes("const palette ="), "Stable person colors are missing from the combined calendar.");
assert(serverSource.includes("runTesseractTsv"), "Position-aware Tesseract output is not enabled for photographed schedules.");
assert(serverSource.includes('runTesseractTsv(extracted.sourcePath, "6")'), "Structured table OCR retry is missing when sparse recognition cannot find the requested row.");
assert(appSource.includes("Approval is blocked until the included shifts total"), "Schedule hour mismatches do not block approval.");
assert(serverSource.includes("These shifts total ${calculatedHours} hours"), "The server does not reject a schedule whose calculated hours disagree with its printed total.");
const lidarrArtworkMapBlock = serverSource.slice(serverSource.indexOf("function getLidarrArtworkMap"), serverSource.indexOf("function normalizeLidarrMbid"));
assert(lidarrArtworkMapBlock.includes('parameters.append("path", imagePath)') && lidarrArtworkMapBlock.includes('parameters.append("remote", remoteToken)'), "Lidarr artwork responses do not preserve all local cache paths and remote fallbacks.");
assert(lidarrArtworkMapBlock.includes('["poster-500.jpg"]'), "Lidarr artist artwork does not synthesize the bounded MediaCover poster candidate.");
assert(lidarrArtworkMapBlock.includes('`/api/v1/mediacover/artist/${entityId}/${filename}${versionQuery}`'), "Lidarr artist artwork does not use the API-authenticated MediaCover route.");
assert(serverSource.includes("configuredBasePath") && serverSource.includes("mediaCoverPath.slice(configuredBasePath.length)"), "Lidarr MediaCover paths do not support an application URL base path.");
const lidarrArtworkProxyBlock = serverSource.slice(serverSource.indexOf('app.get("/api/integrations/lidarr/artwork-file"'), serverSource.indexOf('app.post("/api/integrations/lidarr/request-artist"'));
assert(lidarrArtworkProxyBlock.indexOf('kind: "lidarr-api-cache"') >= 0 && lidarrArtworkProxyBlock.indexOf('kind: "lidarr-api-cache"') < lidarrArtworkProxyBlock.indexOf('kind: "remote-provider"'), "The artwork proxy does not try Lidarr's authenticated MediaCover API before the remote provider.");
assert(lidarrArtworkProxyBlock.includes("const candidate = candidates[candidateIndex++]"), "The Lidarr artwork proxy does not fall back between available image sources.");
assert(lidarrArtworkProxyBlock.includes("for (const imagePath of imagePaths)"), "The artwork proxy does not try every standard Lidarr MediaCover size.");
assert(lidarrArtworkProxyBlock.includes("getLidarrApiMediaCoverPath(imagePath)"), "Lidarr MediaCover requests are not translated to the authenticated API route.");
assert(lidarrArtworkProxyBlock.includes("getArtistArtworkFallbackUrls") && lidarrArtworkProxyBlock.includes('kind: "artist-metadata-fallback"'), "Missing Lidarr posters do not fall back to artist metadata artwork.");
assert(lidarrArtworkProxyBlock.includes("candidateIndex < candidates.length || !fallbackDiscovered"), "Artist metadata fallback is not deferred until Lidarr artwork sources fail.");
assert(serverSource.includes("queueMusicBrainzArtworkRequest") && serverSource.includes("commons.wikimedia.org/wiki/Special:Redirect/file"), "Rare artists without TheAudioDB art do not fall back to rate-limited Wikimedia artwork.");
assert(!appSource.includes('searchParams.set("apikey"'), "The Lidarr API key must never be placed in a browser-side artwork URL.");
const lidarrArtworkHelpersSource = serverSource.slice(
  serverSource.indexOf("function normalizeLidarrMediaCoverPath"),
  serverSource.indexOf("function normalizeLidarrMbid")
);
const lidarrArtworkSandbox = {
  URL,
  URLSearchParams,
  encodeURIComponent,
  getLidarrConfig: () => ({ url: "http://lidarr.test/lidarr" }),
  registerLidarrRemoteArtwork: (value) => value ? `remote-${value}` : "",
  normalizeLidarrMbid: (value) => String(value || "").toLowerCase(),
};
vm.createContext(lidarrArtworkSandbox);
vm.runInContext(`${lidarrArtworkHelpersSource}\nthis.normalizePath = normalizeLidarrMediaCoverPath; this.apiPath = getLidarrApiMediaCoverPath; this.artworkMap = getLidarrArtworkMap;`, lidarrArtworkSandbox);
assert.strictEqual(
  lidarrArtworkSandbox.normalizePath("/lidarr/MediaCover/42/poster-500.jpg?lastWrite=123"),
  "/MediaCover/42/poster-500.jpg?lastWrite=123",
  "A Lidarr application URL prefix was not normalized."
);
const synthesizedArtistPoster = lidarrArtworkSandbox.artworkMap({ id: 42, lastInfoSync: "2026-09-07T12:00:00Z" }, { entityType: "artist" }).poster;
const synthesizedArtistPosterUrl = new URL(synthesizedArtistPoster, "http://homestead.test");
assert.deepStrictEqual(
  Array.from(synthesizedArtistPosterUrl.searchParams.getAll("path"), (value) => value.replace(/\?.*$/, "")),
  ["/api/v1/mediacover/artist/42/poster-500.jpg"],
  "The artist poster fallback was not bounded to one fast Lidarr MediaCover candidate."
);
assert.strictEqual(synthesizedArtistPosterUrl.searchParams.get("artist"), null, "Synthetic artist without a name unexpectedly added an artist lookup.");
const namedArtistPoster = lidarrArtworkSandbox.artworkMap({ id: 43, artistName: "Anna Margaret", foreignArtistId: "11111111-2222-4333-8444-555555555555" }, { entityType: "artist" }).poster;
const namedArtistPosterUrl = new URL(namedArtistPoster, "http://homestead.test");
assert.strictEqual(namedArtistPosterUrl.searchParams.get("artist"), "Anna Margaret", "Artist name was not preserved for last-resort artwork lookup.");
assert.strictEqual(namedArtistPosterUrl.searchParams.get("mbid"), "11111111-2222-4333-8444-555555555555", "Artist MusicBrainz id was not preserved for last-resort artwork lookup.");
assert.strictEqual(lidarrArtworkSandbox.apiPath("/MediaCover/42/poster.jpg?lastWrite=123"), "/api/v1/mediacover/artist/42/poster.jpg?lastWrite=123", "Legacy artist MediaCover paths are not translated to the API route.");
assert.strictEqual(lidarrArtworkSandbox.apiPath("/MediaCover/Albums/91/cover.jpg"), "/api/v1/mediacover/album/91/cover.jpg", "Legacy album MediaCover paths are not translated to the API route.");
const scheduleTsvRows = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"];
scheduleTsvRows.push("1\t1\t0\t0\t0\t0\t0\t0\t1600\t400\t-1\t");
let scheduleWordNumber = 0;
const scheduleWord = (text, left, top, width = 45, line = 1) => scheduleTsvRows.push(`5\t1\t1\t1\t${line}\t${++scheduleWordNumber}\t${left}\t${top}\t${width}\t20\t95\t${text}`);
["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].forEach((day, index) => scheduleWord(day, 278 + index * 200, 100, 44, 1));
scheduleWord("James", 45, 145, 55, 2); scheduleWord("8:00", 238, 145, 38, 2); scheduleWord("AM", 278, 145, 24, 2); scheduleWord("-", 304, 145, 8, 2); scheduleWord("12:00", 314, 145, 48, 2); scheduleWord("PM", 364, 145, 24, 2);
scheduleWord("Andrea", 45, 200, 68, 2); scheduleWord("Britton", 120, 200, 65, 2);
const fixtureRanges = [["5:00", "AM", "1:00", "PM"], ["5:00", "AM", "10:00", "AM"], ["5:00", "AM", "2:00", "PM"], ["5:00", "AM", "1:00", "PM"], ["5:00", "AM", "10:00", "AM"], ["5:00", "AM", "1:00", "PM"], ["5:00", "AM", "11:00", "AM"]];
fixtureRanges.forEach((range, index) => { const left = 238 + index * 200; scheduleWord(range[0], left, 200, 38, 2); scheduleWord(range[1], left + 40, 200, 24, 2); scheduleWord("-", left + 66, 200, 8, 2); scheduleWord(range[2], left + 76, 200, 42, 2); scheduleWord(range[3], left + 120, 200, 24, 2); });
scheduleWord("Total", 45, 228, 42, 3); scheduleWord("Hours:", 90, 228, 48, 3); scheduleWord("49", 142, 228, 24, 3);
const positionedFixture = scheduleRecognition.parsePositionedSchedule(scheduleTsvRows.join("\n"), { personName: "Andrea", firstDate: "2026-09-03" });
assert.strictEqual(positionedFixture.shifts.length, 7, "The table parser did not keep all seven Andrea shifts.");
assert.strictEqual(positionedFixture.shifts[0].date, "2026-09-03", "The first table column has the wrong date.");
assert.strictEqual(positionedFixture.shifts[6].date, "2026-09-09", "The last table column has the wrong date.");
assert.strictEqual(positionedFixture.recognition.calculatedHours, 49, "The table parser calculated the wrong weekly hours.");
assert.strictEqual(positionedFixture.recognition.hoursMatch, true, "The calculated hours do not match the printed 49-hour total.");
assert.strictEqual(positionedFixture.recognition.safeToApprove, true, "A validated seven-day row was incorrectly blocked.");
const guidedFixture = scheduleRecognition.parsePositionedSchedule(scheduleTsvRows.join("\n"), { personName: "Unreadable Name", firstDate: "2026-09-03", rowCenterPercent: 52.5 });
assert.strictEqual(guidedFixture.shifts.length, 7, "The manual row guide did not recover the selected seven-day row.");
assert.strictEqual(guidedFixture.recognition.manuallyGuided, true, "Manual row guidance was not reported to the review screen.");
assert.strictEqual(guidedFixture.matchedPersonName, "Unreadable Name", "Manual row guidance incorrectly reported a nearby role heading as the person's name.");
const nameMissingRows = scheduleTsvRows.filter((row) => !row.endsWith("\tAndrea") && !row.endsWith("\tBritton"));
const missingNameFixture = scheduleRecognition.parsePositionedSchedule(nameMissingRows.join("\n"), { personName: "Andrea", firstDate: "2026-09-03" });
assert.strictEqual(missingNameFixture.recognition.rowMatched, false, "A short AM OCR fragment was incorrectly accepted as Andrea's name.");
assert.strictEqual(missingNameFixture.shifts.length, 0, "Another employee's shifts were substituted when Andrea's name was not found.");
const joinedNameRows = [...nameMissingRows, "5\t1\t1\t1\t2\t999\t45\t200\t190\t20\t91\tAndreaBritton(01099233)"];
const joinedNameFixture = scheduleRecognition.parsePositionedSchedule(joinedNameRows.join("\n"), { personName: "Andrea Britton", firstDate: "2026-09-03" });
assert.strictEqual(joinedNameFixture.recognition.rowMatched, true, "A joined full-name OCR token was not accepted as Andrea Britton.");
assert.strictEqual(joinedNameFixture.shifts.length, 7, "The joined Andrea Britton token did not keep the complete employee row.");
assert.strictEqual(joinedNameFixture.recognition.calculatedHours, 49, "The joined-name row did not preserve Andrea's 49-hour total.");
const recoveredFixture = scheduleRecognition.applyCellTextRecovery(
  { ...positionedFixture, shifts: positionedFixture.shifts.slice(0, 1), recognition: { ...positionedFixture.recognition, printedHours: null, calculatedHours: 8, hoursMatch: null } },
  fixtureRanges.map((range) => `${range[0]} ${range[1]} - ${range[2]} ${range[3]}`),
  "Total Hours: 49",
);
assert.strictEqual(recoveredFixture.shifts.length, 7, "Targeted day-cell OCR did not rebuild all seven Andrea shifts.");
assert.strictEqual(recoveredFixture.recognition.calculatedHours, 49, "Recovered Andrea shifts did not total 49 hours.");
assert.strictEqual(recoveredFixture.recognition.hoursMatch, true, "Recovered Andrea shifts did not match the printed weekly total.");
for (const route of [
  'app.get("/api/recipes"',
  'app.post("/api/recipes/import-preview"',
  'app.post("/api/recipes/photo-preview"',
  'app.post("/api/recipes"',
  'app.patch("/api/recipes/:recipeId"',
]) assert(serverSource.includes(route), `Recipe API route is missing: ${route}`);
const movieTabBlock = appSource.slice(appSource.indexOf("const movieLibraryTabs = ["), appSource.indexOf("];", appSource.indexOf("const movieLibraryTabs = [")) + 2);
assert(!movieTabBlock.includes('id: "years"') && !movieTabBlock.includes('id: "genres"'), "Years and Genres should not remain top-level movie tabs.");

console.log("Homestead plugin host polish integration checks passed.");
