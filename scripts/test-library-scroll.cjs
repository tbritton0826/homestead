const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/hooks/useLibraryScrollReset.js"), "utf8")
  .replace(/^import .*;\n/m, "").replace(/export default /g, "").replace(/export /g, "");
const element = (parentElement = null) => ({ parentElement, scrollTop: 1500, scrollLeft: 75, calls: [], scrollTo(options) { this.calls.push(options); } });
const html = element(), body = element(html), shell = element(body), main = element(shell);
const sidebar = element(shell), posterRow = element(main), playerQueue = element(main);
const document = { scrollingElement: html, documentElement: html, body };
const window = { calls: [], scrollTo(options) { this.calls.push(options); } };
let effect, dependencies, effectCount = 0;
const ref = { current: main };
const { resetLibraryScroll, useLibraryScrollReset } = vm.runInNewContext(source + "; ({ resetLibraryScroll, useLibraryScrollReset })", {
  document, window,
  useRef: () => ref,
  useLayoutEffect(callback, next) {
    if (!dependencies || next.some((value, index) => value !== dependencies[index])) {
      dependencies = next;
      effect = callback;
    }
  },
});
function commit(library) {
  assert.equal(useLibraryScrollReset(library), ref);
  if (effect) { const pending = effect; effect = null; pending(); effectCount++; }
}

commit("movies");
main.scrollTop = 9000;
posterRow.scrollLeft = 300;
commit("movies");
assert.equal(main.scrollTop, 9000, "same-library polls/renders must preserve scroll");
assert.equal(effectCount, 1);
for (const library of ["tv", "books", "music", "photos", "youtube", "adult", "home", "movies"]) {
  main.scrollTop = 9000; body.scrollTop = 400; html.scrollTop = 400;
  commit(library);
  assert.equal(main.scrollTop, 0, `${library} starts at the top of the shared panel`);
  assert.equal(html.scrollTop, 0, "mobile document scroll resets");
  assert.equal(body.scrollTop, 0);
  assert.equal(main.scrollLeft, 0);
}
for (const unrelated of [sidebar, posterRow, playerQueue]) {
  assert.equal(unrelated.scrollTop, 1500, "sidebar/rows/players are not reset");
  assert.equal(unrelated.calls.length, 0);
}
assert.equal(posterRow.scrollLeft, 300, "horizontal poster position is independent");
assert.equal(main.calls.at(-1).behavior, "instant", "no old-page smooth scrolling carries over");
assert.equal(html.calls.length, effectCount, "document targets are deduplicated");

const legacy = element(); legacy.scrollTo = () => { throw new Error("unsupported options"); };
resetLibraryScroll(legacy, document, { scrollTo() { throw new Error("unsupported options"); } });
assert.equal(legacy.scrollTop, 0);
assert.equal(legacy.scrollLeft, 0);
resetLibraryScroll(null, undefined, undefined);
assert.doesNotThrow(() => resetLibraryScroll(null, null, null));

// Verify the hook is wired to the actual shared shell, before conditional pages.
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const appRoot = app.slice(app.indexOf("function HomesteadApp("));
assert(app.includes('import useLibraryScrollReset from "./hooks/useLibraryScrollReset.js"'));
assert(appRoot.includes("const libraryScrollRef = useLibraryScrollReset(activeLibrary);"));
assert.match(appRoot, /<main\s+ref=\{libraryScrollRef\}\s+className=\{`main/);
assert.equal((appRoot.match(/useLibraryScrollReset\(activeLibrary\)/g) || []).length, 1);
assert(appRoot.indexOf("useLibraryScrollReset(activeLibrary)") < appRoot.indexOf("if (selectedSeerrMedia)"));
console.log("Library scroll: cross-library reset, stable same-page scroll, mobile fallback, sidebar/player isolation: PASSED");
