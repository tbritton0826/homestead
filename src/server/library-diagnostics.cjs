const fs = require('node:fs');
const path = require('node:path');
const supported = /\.(?:mp4|mkv|m4v|mov|avi|webm)$/i;
const disc = /\.(?:iso|img)$/i;
const source = file => typeof file === 'string' ? file : file?.sourcePath || file?.path || '';

async function inspectNonVideoFolder(directory) {
  let files = 0, images = 0, discs = 0, videos = 0, inspected = 0;
  const pending = [directory], extensions = new Set();
  while (pending.length) {
    if (++inspected > 10000) throw Error('Folder inspection limit reached; result is incomplete.');
    const current = pending.pop();
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
      else if (entry.isFile()) { extensions.add(path.extname(entry.name).toLowerCase() || "(none)"); files++; if (disc.test(entry.name)) discs++; if (supported.test(entry.name)) videos++; if (/\.(?:jpe?g|png|webp|gif|nfo|json|xml|txt)$/i.test(entry.name)) images++; }
    }
  }
  return { files, discs, videos, extensions: [...extensions].sort(), status: videos ? 'Supported video not indexed' : discs ? 'Disc image â€” playback unsupported' : files === 0 ? 'No media found' : images === files ? 'Artwork / metadata only' : 'No supported video found' };
}

async function libraryDiagnostics({ roots, library = {}, lastScan = null }) {
  const problems = [], rootResults = [], sourceToRecord = new Map();
  const records = Object.entries(library);
  const withVideo = records.filter(([, item]) => Object.values(item.files || {}).some(file => file.type === 'video' || supported.test(source(file))));
  for (const [id, item] of records) {
    const sources = [...new Set([item.sourcePath, ...(item.sourcePaths || []), ...(item.mergedFrom || [])].filter(Boolean).map(value => path.resolve(value)))];
    for (const directory of sources) { if (!sourceToRecord.has(directory)) sourceToRecord.set(directory, []); sourceToRecord.get(directory).push({ id, item }); }
    if (sources.length > 1) problems.push({ kind: 'merged', title: item.name || id, detail: `${sources.length} folders combined into one record`, paths: sources, indexedVideos: Object.values(item.files || {}).filter(file => file.type === 'video' || supported.test(source(file))).length, extensions: [...new Set(Object.values(item.files || {}).map(file => path.extname(source(file)).toLowerCase()).filter(Boolean))] });
  }
  let folderCount = 0, unavailable = 0;
  for (const root of [...new Set(roots.map(value => path.resolve(value)))]) {
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      const folders = entries.filter(entry => entry.isDirectory());
      folderCount += folders.length; rootResults.push({ path: root, folders: folders.length, status: 'Available' });
      const found = new Set(folders.map(entry => path.join(root, entry.name)));
      for (const entry of entries.filter(entry => entry.isSymbolicLink())) problems.push({ kind: 'skipped-link', title: entry.name, detail: 'Link at library root; scanner may skip it', paths: [path.join(root, entry.name)] });
      for (const entry of folders) {
        const directory = path.join(root, entry.name), matches = sourceToRecord.get(directory) || [];
        if (!matches.length) problems.push({ kind: 'unindexed', title: entry.name, detail: 'Folder not linked to an index record', paths: [directory] });
        if (!matches.length || matches.every(({ item }) => !Object.values(item.files || {}).some(file => file.type === 'video' || supported.test(source(file))))) {
          try { const result = await inspectNonVideoFolder(directory); problems.push({ kind: result.videos ? 'unindexed-video' : result.discs ? 'disc' : result.files === 0 ? 'empty' : 'no-video', title: entry.name, detail: result.status, indexedVideos: 0, extensions: result.extensions, paths: [directory] }); }
          catch (error) { unavailable++; problems.push({ kind: 'unavailable', title: entry.name, detail: error.message, paths: [directory] }); }
        }
      }
      for (const directory of sourceToRecord.keys()) if (path.dirname(directory) === root && !found.has(directory)) problems.push({ kind: 'stale', title: path.basename(directory), detail: 'Index references a folder not present in this available root', paths: [directory] });
    } catch (error) { unavailable++; rootResults.push({ path: root, status: 'Unavailable', error: error.message }); problems.push({ kind: 'unavailable', title: root, detail: 'Storage unavailable; missing/empty counts cannot be inferred', paths: [root] }); }
  }
  return { generatedAt: new Date().toISOString(), lastScan, complete: unavailable === 0, roots: rootResults, counts: { folders: folderCount, records: records.length, withVideo: withVideo.length, mergedGroups: problems.filter(row => row.kind === 'merged').length, discOnly: problems.filter(row => row.kind === 'disc').length, empty: problems.filter(row => row.kind === 'empty').length, unavailable }, problems };
}
module.exports = { libraryDiagnostics, inspectNonVideoFolder };
