import fs from "fs";
import path from "path";

import { importTiny4K } from "./providers/tiny4k.js";
import { importExxxtraSmall } from "./providers/exxxtrasmall.js";
import { importNubilesNet } from "./providers/nubiles-net.js";
import { scanLocalFiles } from "./providers/local-files.js";

const performerId = process.argv[2];

if (!performerId) {
  console.error("Usage: node scripts/performer-importer/import-performer.js presley\dawson");
  process.exit(1);
}

const performerDir = path.join("public", "media", "performers", performerId);
const metadataPath = path.join(performerDir, "metadata.json");
const candidatesPath = path.join(performerDir, "metadata-candidates.json");

if (!fs.existsSync(performerDir)) {
  console.error(`Performer folder not found: ${performerDir}`);
  process.exit(1);
}

const existing = fs.existsSync(metadataPath)
  ? JSON.parse(fs.readFileSync(metadataPath, "utf8"))
  : {};

const performerName =
  existing.name ||
  existing.stageName ||
  performerId;
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

async function run() {
  console.log(`Importing metadata for: ${performerName}`);

  const sources = {
    tiny4k: await importTiny4K(performerName),
    exxxtrasmall: await importExxxtraSmall(performerName),
    nubilesNet: await importNubilesNet(performerName),
    localFiles: scanLocalFiles(performerDir),
  };

  const mergedCandidate = mergeCandidates(sources);

  const output = {
    name: performerName,
    performerId,
    searchedAt: new Date().toISOString(),
    sources,
    mergedCandidate,
  };

  fs.writeFileSync(candidatesPath, JSON.stringify(output, null, 2));

  console.log(`Saved candidates to: ${candidatesPath}`);
}

function mergeCandidates(sources) {
  const allScenes = [
    ...(sources.tiny4k?.scenes || []),
    ...(sources.exxxtrasmall?.scenes || []),
    ...(sources.nubilesNet?.scenes || []),
    ...(sources.localFiles?.scenes || []),
  ];

  const allMagazines = [
    ...(sources.localFiles?.magazines || []),
  ];

  const studios = [...new Set(allScenes.map((scene) => scene.studio).filter(Boolean))];

  return {
    scenes: allScenes,
    magazines: allMagazines,
    studios,
    referenceLinks: [
      ...(sources.tiny4k?.referenceLinks || []),
      ...(sources.exxxtrasmall?.referenceLinks || []),
      ...(sources.nubilesNet?.referenceLinks || []),
    ],
  };
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});