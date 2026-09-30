// Home needs artwork for a handful of progress cards, not fully enriched objects
// for every song. Index paths cheaply; resolve companion files only on a match.
export function createHomeMusicLookup(artists, normalize) {
  const paths = new Map();
  const records = [];
  const resolved = new Map();
  for (const artist of artists) {
    const files = Object.values(artist.files || {});
    for (const file of files) {
      if (!['audio', 'audiobook'].includes(file.type)) continue;
      const record = { file, artist, files };
      records.push(record);
      for (const path of [file.path, file.sourcePath]) {
        if (path && !paths.has(String(path).trim())) paths.set(String(path).trim(), record);
      }
    }
  }
  return (progress = {}) => {
    const path = String(progress.path || progress.sourcePath || progress.id || '').trim();
    const title = String(progress.title || progress.name || '').trim().toLowerCase();
    const artist = String(progress.artist || '').trim().toLowerCase();
    let record = paths.get(path);
    if (!record && title) {
      record = records.find((candidate) => {
        candidate.summary ||= normalize(candidate.file, candidate.artist, []);
        return String(candidate.summary.title || '').trim().toLowerCase() === title &&
          (!artist || String(candidate.summary.artist || '').trim().toLowerCase() === artist);
      });
    }
    if (!record) return null;
    if (!resolved.has(record)) resolved.set(record, {
      ...normalize(record.file, record.artist, record.files), artistFolder: record.artist,
    });
    return resolved.get(record);
  };
}

export function recentYouTubeEntries(creators, limit = 6) {
  // Preserve the existing display order without enriching every archived video.
  const entries = [];
  for (let i = creators.length - 1; i >= 0 && entries.length < limit; i--) {
    const creator = creators[i];
    const videos = Object.values(creator.videos || {});
    for (let j = videos.length - 1; j >= 0 && entries.length < limit; j--) {
      entries.push({ ...videos[j], creatorId: creator.id, creatorName: creator.name });
    }
  }
  return entries;
}

export async function mapWithConcurrency(items, mapper, concurrency = 4) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, worker));
  return results;
}

export function createSharedIndexLoader(load) {
  let current = null;
  return (refresh = false) => {
    if (refresh || !current) {
      const pending = Promise.resolve().then(load);
      current = pending;
      const clear = () => { if (current === pending) current = null; };
      pending.then((value) => { if (!value) clear(); }, clear);
    }
    return current;
  };
}
