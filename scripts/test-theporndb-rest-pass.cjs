const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  fetchThePornDb,
  mapThePornDbPerformer,
  parseThePornDbBraSize,
  thePornDbBearerToken,
  thePornDbPerformersUrl,
} = require("../src/server/adult-recommendations.cjs");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

assert(serverSource.includes('type: "theporndb-rest"'));
assert(serverSource.includes('endpoint: "https://api.theporndb.net"'));
assert(!serverSource.includes('id: "theporndb",\n    name: "ThePornDB",\n    type: "stash-box"'));
assert(serverSource.includes('/api/discovery/adult/providers/:providerId/test'));
assert(appSource.includes("ThePornDB API Tokens ↗"));
assert(appSource.includes("Homestead adds the Bearer prefix securely."));

assert.equal(thePornDbBearerToken("  Bearer abc123  "), "abc123");
assert.equal(thePornDbBearerToken("abc123"), "abc123");
assert.deepEqual(parseThePornDbBraSize({ cupsize: "34C" }), { braBand: 34, cupSize: "C" });

const url = thePornDbPerformersUrl(
  { endpoint: "https://api.theporndb.net/" },
  { gender: "female" },
  2,
  25,
);
assert.equal(url.origin + url.pathname, "https://api.theporndb.net/performers");
assert.equal(url.searchParams.get("page"), "2");
assert.equal(url.searchParams.get("per_page"), "25");
assert.equal(url.searchParams.has("orderBy"), false);
assert.equal(url.searchParams.has("gender"), false);

const mapped = mapThePornDbPerformer({
  id: "performer-1",
  slug: "example-performer",
  name: "Example Performer",
  aliases: ["Example Alias"],
  bio: "Example biography",
  image: "https://cdn.example.test/full.jpg",
  thumbnail: "https://cdn.example.test/thumb.jpg",
  posters: [{ url: "https://cdn.example.test/poster.jpg" }],
  extras: {
    gender: "Female",
    birthday: "2000-04-05",
    height: "160cm",
    weight: "50kg",
    cupsize: "34C",
    waist: "24",
    hips: "34",
    ethnicity: "Caucasian",
    nationality: "American",
    hair_colour: "Blonde",
    eye_colour: "Green",
    fake_boobs: false,
    tattoos: "Right arm",
    piercings: "Navel",
    career_start_year: 2019,
  },
}, { id: "theporndb", name: "ThePornDB", profileType: "performer" });

assert.equal(mapped.name, "Example Performer");
assert.equal(mapped.gender, "female");
assert.equal(mapped.heightCm, 160);
assert(Math.abs(mapped.weightLb - 110.231) < 0.01);
assert.equal(mapped.braBand, 34);
assert.equal(mapped.cupSize, "C");
assert.deepEqual(mapped.breastShapes, ["natural"]);
assert.equal(mapped.ethnicity, "Caucasian");
assert.equal(mapped.eyeColor, "Green");
assert.deepEqual(mapped.tattoos, ["Right arm"]);
assert.equal(mapped.imageUrl, "https://cdn.example.test/full.jpg");
assert(mapped.images.includes("https://cdn.example.test/poster.jpg"));
assert.equal(mapped.sourceName, "ThePornDB");

async function run() {
  const calls = [];
  const pages = [
    { data: Array.from({ length: 10 }, (_, index) => ({ id: `one-${index}`, name: `One ${index}`, extras: { gender: "Female" } })), meta: { current_page: 1, last: 2 } },
    { data: [{ id: "two", name: "Two", extras: { gender: "Female" } }], meta: { current_page: 2, last: 2 } },
  ];
  const results = await fetchThePornDb({
    id: "theporndb",
    name: "ThePornDB",
    type: "theporndb-rest",
    endpoint: "https://api.theporndb.net",
    apiKey: "Bearer secret-token",
    perPage: 10,
    pages: 3,
  }, { gender: "female" }, async (requestUrl, options) => {
    calls.push({ requestUrl: String(requestUrl), options });
    return { ok: true, status: 200, json: async () => pages[calls.length - 1] };
  });

  assert.equal(results.length, 11);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  assert(!("ApiKey" in calls[0].options.headers));
  assert.equal(new URL(calls[1].requestUrl).searchParams.get("page"), "2");

  await assert.rejects(
    () => fetchThePornDb({ endpoint: "https://api.theporndb.net", apiKey: "bad", pages: 1 }, {}, async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthenticated" }),
    })),
    /rejected this API token/i,
  );

  console.log("ThePornDB REST provider tests: PASSED");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
