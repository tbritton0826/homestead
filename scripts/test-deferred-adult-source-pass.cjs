const assert = require("assert");
const {
  DEFAULT_ADULT_SOURCES,
  getConfiguredAdultSources,
  discoverAdultBrowseMedia,
} = require("./metadata/adult-sources.cjs");
const { buildSourceRegistry } = require("../src/server/adult-source-packs.cjs");

const saved = DEFAULT_ADULT_SOURCES.find((source) => source.id === "justteensporn");
assert(saved, "JustTeensPorn should remain saved in the Adult source registry.");
assert.equal(saved.enabled, false, "The deferred subscription source must stay disabled by default.");
assert.equal(saved.requiresSession, true, "The source must be marked as subscription/session restricted.");
assert.equal(saved.status, "locked");
assert.equal(saved.discoveryScope, "browse");
assert(saved.notes.includes("must not attempt access or store credentials"));

const configured = getConfiguredAdultSources({});
assert(configured.some((source) => source.id === "justteensporn" && source.enabled === false));
const browse = discoverAdultBrowseMedia({ setupConfig: {} });
assert(!browse.sources.some((source) => source.id === "justteensporn"), "A locked deferred source must not be queried.");

const registry = buildSourceRegistry([saved]);
assert.equal(registry.find((source) => source.id === "justteensporn")?.packId, "adult-content-sources");

console.log("Deferred subscriber-only Adult source checks passed.");
