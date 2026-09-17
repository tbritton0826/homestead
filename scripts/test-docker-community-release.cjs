const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const pkg = JSON.parse(read("package.json"));
const dockerfile = read("Dockerfile");
const compose = read("docker-compose.yml");
const buildCompose = read("docker-compose.build.yml");
const workflow = read(".github", "workflows", "docker-publish.yml");
const profile = read("community-apps-repository", "ca_profile.xml");
const template = read("community-apps-repository", "templates", "homestead.xml");

assert.equal(pkg.version, "0.6.8.64");
assert.match(dockerfile, /ARG HOMESTEAD_VERSION=0\.6\.8\.64/);
assert.match(dockerfile, /HOMESTEAD_DATA_DIR=\/app\/data/);
assert.match(dockerfile, /npm prune --omit=dev/);
assert.match(compose, /ghcr\.io\/tbritton0826\/homestead/);
assert.doesNotMatch(compose, /^\s*build:/m, "Default Compose install must pull instead of build.");
assert.match(buildCompose, /HOMESTEAD_VERSION:\s*"0\.6\.8\.64"/);
assert.match(workflow, /packages:\s*write/);
assert.match(workflow, /platforms:\s*linux\/amd64/);
assert.match(profile, /<CommunityApplications>/);
assert.match(profile, /<Profile>[^<]+<\/Profile>/);
assert.match(template, /<Container version="2">/);
assert.match(template, /<Repository>ghcr\.io\/tbritton0826\/homestead:latest<\/Repository>/);
assert.match(template, /<TemplateURL>https:\/\/raw\.githubusercontent\.com\/tbritton0826\/homestead-community-apps\/main\/templates\/homestead\.xml<\/TemplateURL>/);
assert.match(template, /Target="\/app\/data"/);
assert.match(template, /Target="7312"/);
assert(fs.existsSync(path.join(root, "community-apps-repository", "icon.svg")), "Community Apps icon is missing.");
assert(fs.existsSync(path.join(root, "community-apps-repository", "LICENSE")), "Community Apps metadata license is missing.");

console.log("Docker pull and Community Apps release checks passed.");
