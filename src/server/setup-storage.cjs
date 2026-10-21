const fs = require("node:fs/promises");
const path = require("node:path");

const folderNames = { movies: "movies", tvshows: "tv", music: "music", books: "books", photos: "photos", youtube: "youtube", liveTV: "livetv/recordings", family: "family", cloud: "cloud", adult: "adult", inventory: "inventory", ai: "ai" };

function setupStorageInfo({ mediaRoot, dataDir, platform = process.platform }) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  return { platform, dataDirectory: dataDir, folderDefaults: Object.fromEntries(Object.entries(folderNames).map(([id, name]) => [id, paths.join(mediaRoot, ...name.split("/"))])) };
}

async function inspectSetupFolder(value, { create = false, platform = process.platform, io = fs } = {}) {
  const folder = String(value || "").trim();
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (/(?:^|[\\/])Network Shortcuts(?:[\\/]|$)/i.test(folder) || /\.(?:lnk|url)$/i.test(folder)) {
    throw new Error("This is a Windows shortcut. Open its target in File Explorer and enter the actual shared folder, such as \\\\server\\share\\Movies, or a mapped drive such as M:\\Movies.");
  }
  if (!paths.isAbsolute(folder) || (platform === "win32" && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(folder))) {
    throw new Error(platform === "win32" ? "Enter a full Windows folder path (C:\\Media\\Movies), mapped drive (M:\\Movies), or network share (\\\\server\\share\\Movies)." : "Enter an absolute folder path on the Homestead server.");
  }
  const network = platform === "win32" && /^[\\/]{2}/.test(folder);
  try {
    let stats;
    try { stats = await io.stat(folder); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stats && !stats.isDirectory()) throw new Error("The selected path is a file, not a media folder.");
    if (!stats) {
      if (network) throw new Error("The network folder is unavailable. Open this exact share in File Explorer using the same Windows account, sign in if needed, then retry. Homestead does not create missing network shares.");
      // Missing local folders may be created later, but the nearest existing parent
      // must be accessible. A disconnected mapped drive must never look ready.
      let parent = paths.dirname(folder);
      while (true) {
        try { await io.access(parent); break; } catch (error) {
          const next = paths.dirname(parent);
          if (error.code !== "ENOENT" || next === parent) throw error;
          parent = next;
        }
      }
      if (!create) return { path: folder, status: "missing", message: "Will create this local folder during setup." };
      await io.mkdir(folder, { recursive: true });
    }
    await io.readdir(folder);
    return { path: folder, status: stats ? "exists" : "created", message: "Folder is accessible." };
  } catch (error) {
    if (["EACCES", "EPERM", "ENOENT", "ENOTDIR", "ENETUNREACH", "EHOSTUNREACH", "UNKNOWN"].includes(error.code)) {
      throw new Error(`Homestead cannot read this folder. Check that the drive or share is connected and accessible to the Windows account running Homestead (${error.code}).`);
    }
    throw error;
  }
}

module.exports = { setupStorageInfo, inspectSetupFolder };
