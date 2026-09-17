const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { buildEntities, evaluateCandidate, selectCandidate, createLibraryAutoMatch } = require("../src/server/library-auto-match.cjs");
const root = path.resolve(__dirname, "..");
const book = { localId: "castle-high-heat", kind: "book", title: "High Heat", authors: ["Richard Castle"], identifiers: {} };
const castle = { provider: "openlibrary", providerId: "/works/castle", title: "High Heat", authors: ["Richard Castle"], identifiers: {} };
const child = { ...castle, providerId: "/works/child", authors: ["Lee Child"] };
assert.equal(selectCandidate(book, [child]).match, null, "never substitute Lee Child for Richard Castle");
assert.equal(selectCandidate(book, [child, castle]).match.providerId, castle.providerId);
assert.equal(selectCandidate(book, [{ ...castle, authors: [] }]).match, null, "missing author requires review");
assert.equal(selectCandidate({ ...book, authors: ["Castle, Richard"] }, [castle]).match.providerId, castle.providerId);
assert.equal(selectCandidate(book, [castle, { ...castle, providerId: "/works/other-edition" }]).match, null, "duplicate editions need review");
assert.equal(selectCandidate({ ...book, identifiers: { isbn13: "978-1234567890" } }, [castle]).match, null, "ISBN evidence cannot be silently discarded");
assert(evaluateCandidate({ ...book, identifiers: { isbn13: "9781234567890" } }, { ...castle, raw: { isbn: ["9781234567890"] } }).compatible);
assert.equal(selectCandidate({ ...book, edition: "Large Print" }, [castle]).match, null);
assert.equal(selectCandidate(book, [{ ...child, identifiers: { isbn13: "9781234567890" } }]).match, null, "identifier cannot override conflicting author");

const recording = { kind: "recording", title: "Mind Reader", artists: ["Dustin Lynch"], album: "Where It's At", duration: 194, identifiers: {} };
const track = { provider: "musicbrainz", providerId: "track-1", mediaType: "recording", title: "Mind Reader", artists: ["Dustin Lynch"], raw: { length: 194000, releases: [{ title: "Where It's At" }] } };
assert(evaluateCandidate(recording, track).compatible);
assert(!evaluateCandidate(recording, { ...track, artists: ["Other Artist"] }).compatible);
assert(!evaluateCandidate(recording, { ...track, raw: { length: 230000, releases: [{ title: "Where It's At" }] } }).compatible);
assert(!evaluateCandidate(recording, { ...track, raw: { length: 194000, releases: [{ title: "Live Album" }] } }).compatible);
assert.equal(selectCandidate(recording, [track, { ...track, providerId: "track-2" }]).match, null);
assert.equal(selectCandidate({ ...recording, identifiers: { musicbrainzId: "track-1" } }, [track, { ...track, providerId: "track-2" }]).match.providerId, "track-1");
assert(!evaluateCandidate({ ...recording, identifiers: { musicbrainzId: "track-2" } }, track).compatible);

const music = { libraries: { music: { artist: { id: "artist-local", name: "Test Artist", files: [
  { name: "01 - A Song.mp3", path: "/custom/library/Test Artist/Album (2024)/01 - A Song.mp3", type: "audio" },
  { name: "02.flac", path: "/custom/library/Test Artist/Album (2024)/02.flac", type: "audio", metadata: { title: "99 Problems", artist: "Test Artist", album: "Album (2024)" } },
] } } } };
const entities = buildEntities("music", music);
assert.deepEqual(entities.map((item) => item.kind), ["artist", "release-group", "recording", "recording"]);
assert.equal(entities[1].localId, "album:artist-local:Album (2024)");
assert.equal(entities[1].title, "Album");
assert.equal(entities[2].title, "A Song");
assert.equal(entities[3].title, "99 Problems");
assert.equal(entities[2].artists[0], "Test Artist", "custom root must not become artist name");

async function lifecycle() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "homestead-match-tests-"));
  try {
    let matches = {};
    let searches = 0;
    let results = [child];
    const index = { libraries: { books: { b: { id: book.localId, name: book.title, metadata: { author: "Richard Castle" }, files: [{ type: "ebook", path: "/media/books/Richard Castle/High Heat/book.epub" }] } } } };
    const config = { stateFile: path.join(temporary, "state.json"), readIndex: () => index, readMatches: () => structuredClone(matches), writeMatches: (next) => { matches = next; },
      searchBooks: async () => { searches++; return results; }, searchMusic: async () => [] };
    let service = createLibraryAutoMatch(config);
    await service.run("books");
    assert.equal(Object.keys(matches).length, 0);
    assert.equal(service.getStatus("books").reviewCount, 1);
    assert.equal(index.libraries.books.b.metadata.author, "Richard Castle");
    await service.run("books");
    assert.equal(searches, 1, "rescan must reuse prior review result");
    service = createLibraryAutoMatch(config);
    assert.equal(service.getStatus("books").reviewCount, 1, "review survives restart");
    results = [castle];
    await service.run("books", { force: true });
    assert.equal(matches[`books:${book.localId}`].providerId, castle.providerId);
    assert.equal(service.getStatus("books").reviewCount, 0);
    matches[`books:${book.localId}`] = { ...matches[`books:${book.localId}`], title: "Manual title", matchLocked: true, manualOverride: true };
    await service.run("books", { force: true });
    assert.equal(searches, 2, "force retry cannot overwrite a manual lock");
    assert.equal(matches[`books:${book.localId}`].title, "Manual title");
    service.setEnabled("books", false);
    assert.equal(createLibraryAutoMatch(config).getStatus("books").enabled, false);
    assert.equal(service.start("books", { automatic: true }).running, false);

    delete matches[`books:${book.localId}`];
    const manualOnly = createLibraryAutoMatch({ ...config, stateFile: path.join(temporary, "manual-only.json") });
    manualOnly.setEnabled("books", false);
    await manualOnly.run("books");
    assert.equal(matches[`books:${book.localId}`].providerId, castle.providerId, "manual run works when automatic matching is disabled");
    delete matches[`books:${book.localId}`];
    service = createLibraryAutoMatch({ ...config, searchBooks: async () => {
      matches[`books:${book.localId}`] = { localId: book.localId, title: "Saved during search", matchLocked: true };
      return [castle];
    } });
    await service.run("books", { force: true });
    assert.equal(matches[`books:${book.localId}`].title, "Saved during search", "network race must preserve manual save");
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/components/PhotosLibraryPage.jsx"), "utf8");
const picker = fs.readFileSync(path.join(root, "src/components/PhotoLibraryPicker.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/App.css"), "utf8");
const matchFunction = app.match(/function getHomesteadMetadataMatchFromIndex[\s\S]*?\n}\n/)[0];
const lookup = vm.runInNewContext(`${matchFunction}; getHomesteadMetadataMatchFromIndex`);
const saved = { "books:castle": { localId: "castle", authors: ["Richard Castle"] }, "books:child": { localId: "child", authors: ["Lee Child"] }, "books:high-heat": { aliasOf: "books:child" } };
assert.equal(lookup(saved, "books", { id: "castle", name: "High Heat" }).authors[0], "Richard Castle");
assert.equal(lookup(saved, "books", { id: "unmatched", name: "High Heat" }), null);
assert.equal(lookup(saved, "books", "high-heat"), null, "legacy title alias cannot cross authors");
for (const text of ["photos-poster-card", "albumCovers", "bannerImage", "onAlbumChange", "setNavBackAction", "openImageViewer", "slice(0, visible)"]) assert(photos.includes(text), text);
for (const text of ["page * 60", 'type="button"', "Escape", "sourcePath", "encodeURIComponent(raw)"]) assert(picker.includes(text), text);
for (const text of ['setPhotoPickerTarget("backgroundImage")', 'setPhotoPickerTarget("sidebarBackgroundImage")', 'setPhotoPickerTarget("bannerImage")', 'isBookOrMusic && <LibraryAutoMatchPanel library={library} />', '<LibraryAutoMatchPanel library="books"', "mediaAppearanceLoadedLibrary !== activeLibrary"]) assert(app.includes(text), text);
assert(css.includes(".photos-poster-image"));
assert(server.includes('["sidebar", "header", "ribbon", "banner", "library", "poster"].includes(requestedTarget)'));
assert(server.includes("libraryAutoMatch.start(library, { automatic: true })"));
assert(server.includes("fs.watchFile(path.join(dataDir, \"media-index.json\")"));
lifecycle().then(() => console.log("Auto Match identity, High Heat author safety, review persistence, race protection, Photos/pickers: PASSED")).catch((error) => { console.error(error); process.exitCode = 1; });
