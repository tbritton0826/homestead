const assert = require("assert");
const { SOURCE_PACKS, buildSourceRegistry, aggregatePersonCandidates } = require("../src/server/adult-source-packs.cjs");

assert(SOURCE_PACKS.some((pack) => pack.id === "public-people"));
assert(SOURCE_PACKS.some((pack) => pack.id === "adult-performer-metadata"));
assert(SOURCE_PACKS.some((pack) => pack.id === "adult-content-sources"));

const registry = buildSourceRegistry([
  { id: "wikidata", name: "Wikidata", role: "both", supports: ["identity", "birthday"] },
  { id: "thelordofporn", name: "The Lord of Porn", role: "performer", supports: ["identity", "measurements"] },
]);
assert(registry.some((source) => source.id === "tiny4k" && source.packId === "adult-content-sources"));
assert(registry.some((source) => source.id === "exxxtrasmall" && source.packId === "adult-content-sources"));
assert(registry.some((source) => source.id === "pornhub" && source.packId === "adult-content-sources"));

const aggregated = aggregatePersonCandidates("Elsa Jean", [
  { name: "Elsa Jean", profileType: "performer", provider: "thelordofporn", sourceCandidateId: "lop-1", confidence: 0.91, measurements: "32-24-34" },
  { name: "Elsa Jean", profileType: "performer", provider: "wikidata", sourceCandidateId: "wd-1", confidence: 0.88, birthday: "1996-09-01" },
  { name: "Elsa Jean", profileType: "celebrity", provider: "wikidata", sourceCandidateId: "wd-celeb", confidence: 0.4 },
], registry);

assert.equal(aggregated.length, 2, "performer and celebrity lanes must not be merged");
const performer = aggregated.find((item) => item.profileType === "performer");
assert.equal(performer.sourceCount, 2);
assert.equal(performer.sourceCandidates.length, 2);
assert(performer.sources.some((source) => source.name === "The Lord of Porn"));
assert(performer.sources.some((source) => source.name === "Wikidata"));
console.log("Adult source pack aggregation tests: PASSED");
