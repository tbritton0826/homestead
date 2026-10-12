#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { createArtworkRecovery } = require("../src/server/artwork-recovery.cjs");

// Local, offline maintenance only. Never connect to a running server or production host.
try {
  const args = process.argv.slice(2);
  const [command, name] = args.filter(arg => arg !== "--apply");
  const apply = args.includes("--apply");
  if (!command || !["list", "protect", "unprotect", "prune", "restore"].includes(command) ||
      ((command === "protect" || command === "unprotect" || command === "restore") && !name) ||
      args.filter(arg => arg !== "--apply").length > (command === "list" || command === "prune" ? 1 : 2)) {
    console.error("Usage: npm run artwork:recovery -- list | protect NAME | unprotect NAME | prune [--apply] | restore NAME [--apply]");
    process.exitCode = 1;
  } else {
    const manager = createArtworkRecovery({ dataDir: process.env.HOMESTEAD_DATA_DIR || path.join(__dirname, "..", "data") });
    if (command === "list") console.log(JSON.stringify(manager.list(), null, 2));
    if (command === "protect" || command === "unprotect") manager.protect(name, command === "protect");
    if (command === "prune") console.log(JSON.stringify(manager.prune({ dryRun: !apply }), null, 2));
    if (command === "restore") console.log(JSON.stringify(manager.restore(name, { dryRun: !apply }), null, 2));
  }
} catch (error) {
  console.error(`[artwork-recovery] command-failed: ${error.code || "IO_ERROR"}`);
  process.exitCode = 1;
}
