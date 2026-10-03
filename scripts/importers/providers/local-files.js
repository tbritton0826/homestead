import fs from "fs";
import path from "path";

const videoExtensions = [".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"];
const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

export function scanLocalFiles(performerDir) {
  const files = walkDir(performerDir);

  const scenes = files
    .filter((file) => file.includes(`${path.sep}scenes${path.sep}`))
    .filter((file) => videoExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => sceneFromPath(file, performerDir));

  const magazines = files
    .filter((file) => file.includes(`${path.sep}magazines${path.sep}`))
    .filter((file) => imageExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => magazineFromPath(file, performerDir));

  const photos = files
    .filter((file) => file.includes(`${path.sep}photos${path.sep}`))
    .filter((file) => imageExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => toPublicPath(file));

  return {
    provider: "Local Files",
    status: "complete",
    scenes,
    magazines,
    photos,
  };
}

function sceneFromPath(file, performerDir) {
  const relative = path.relative(performerDir, file);
  const parts = relative.split(path.sep);

  const scenesIndex = parts.indexOf("scenes");
  const studio = scenesIndex >= 0 ? parts[scenesIndex + 1] || "Unknown Studio" : "Unknown Studio";

  const title = cleanTitle(path.basename(file, path.extname(file)));

  return {
    title,
    studio,
    source: "local",
    path: toPublicPath(file),
    filename: path.basename(file),
  };
}

function magazineFromPath(file, performerDir) {
  return {
    title: cleanTitle(path.basename(file, path.extname(file))),
    source: "local",
    path: toPublicPath(file),
    filename: path.basename(file),
  };
}

function cleanTitle(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toPublicPath(file) {
  return "/" + file.replace(/^public[\\/]/, "").replaceAll("\\", "/");
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) return walkDir(fullPath);

    return fullPath;
  });
}
