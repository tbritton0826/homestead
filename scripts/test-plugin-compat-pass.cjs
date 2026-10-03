"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "App.jsx"), "utf8");

assert.match(
  appSource,
  /plugin\.type === "full"[\s\S]{0,220}allow-same-origin allow-scripts/,
  "Trusted full plugins must receive same-origin iframe access."
);
assert.match(
  appSource,
  /: "allow-downloads allow-forms allow-modals allow-popups allow-scripts"/,
  "Client-only plugins must retain the restricted sandbox."
);
assert.match(
  appSource,
  /message\?\.type !== "homestead:plugin-api-request"/,
  "The restricted plugin API bridge must remain available."
);

console.log("Homestead 0.6.8.1 full-plugin compatibility checks: PASSED");
