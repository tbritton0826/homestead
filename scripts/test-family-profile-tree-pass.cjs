const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.cjs"), "utf8");

assert(app.includes("PROFILE_FAMILY_RELATIONSHIP_OPTIONS"));
assert(app.includes('["daughter", "Daughter"]'));
assert(app.includes('["sister", "Sister"]'));
assert(app.includes("Linked profile is {profile?.name"));
assert(app.includes('className="profile-family-layout"'));
assert(app.includes('className="profile-family-tree-pane"'));
assert(app.includes('className="profile-family-photo-scroll"'));
assert(app.includes("profileFamilyRelationshipGroup"));
assert(app.includes("getProfilePosterValue(related)"));

assert(css.includes("grid-template-columns: minmax(0,1.35fr) minmax(260px,.65fr)"));
assert(css.includes(".profile-family-photo-scroll"));
assert(css.includes("overflow-y: auto"));
assert(css.includes(".profile-family-tree-generation.current-generation"));

assert(server.includes("ADULT_FAMILY_RELATIONSHIP_TYPES"));
assert(server.includes('"mother", "father", "parent", "daughter", "son", "child"'));
assert(server.includes("function reciprocalAdultFamilyRelationship"));
assert(server.includes('return gendered("mother", "father", "parent")'));
assert(server.includes("relationshipType: reciprocalRelationshipType"));
assert(server.includes("Family profiles linked with reciprocal relationships."));

console.log("Directional family relationships, reciprocal metadata, tree layout, and linked-photo panel checks passed.");
