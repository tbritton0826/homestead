const path = require('node:path');
const crypto = require('node:crypto');

const pathKey = value => {
  if (!value) return '';
  const key = String(value).replaceAll('\\', '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? key.toLowerCase() : key;
};
const titleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function fileTitle(name) {
  return path.basename(name, path.extname(name)).replace(/\s+--\s+.+$/, '')
    .replace(/\s*\((?:ebook|audiobook)\)\s*$/i, '').replace(/_/g, ' ').trim();
}
function describeFile(file) {
  const raw = fileTitle(file.name);
  const sequence = raw.match(/\(([^()]+),\s*(?:Book\s*)?(\d+(?:\.\d+)?)\)/i);
  const alternateTitle = raw.match(/\(also published as\s+([^)]*)\)/i)?.[1];
  const title = raw.replace(/\s*\([^()]+,\s*(?:Book\s*)?\d+(?:\.\d+)?\)/gi, '')
    .replace(/\s*\((?:also published as|illustrated|deluxe|revised|anniversary)[^)]*\)/gi, '').trim();
  return {title: title || raw, alternateTitle, series: sequence?.[1] || '', seriesIndex: sequence?.[2] || ''};
}

// Shared by the CLI scanner and the live library. Folder membership is not work
// identity: a series folder can hold many distinct books without book subfolders.
function buildBookLibrary(discovered, existingLibrary = {}, matches = {}) {
  const folders = new Map();
  const seenFiles = new Set();
  for (const raw of discovered) {
    const absolute = raw.absolutePath || raw.sourcePath || raw.path;
    if (!absolute || !['ebook', 'audiobook'].includes(raw.type) || seenFiles.has(pathKey(absolute))) continue;
    seenFiles.add(pathKey(absolute));
    const parent = path.dirname(absolute);
    const formatContainer = /^(?:e\s*books?|audio\s*books?|audio)$/i.test(path.basename(parent));
    const folder = formatContainer ? path.dirname(parent) : parent;
    const segments = path.relative(raw.root, folder).split(path.sep).filter(Boolean);
    const description = describeFile(raw);
    if (formatContainer && /^(?:book|ebook|audiobook|text|unknown|untitled)$/i.test(description.title)) description.title = path.basename(folder);
    const file = {...raw, absolutePath: absolute, folder, segments, formatContainer, ...description};
    const key = pathKey(folder);
    if (!folders.has(key)) folders.set(key, []);
    folders.get(key).push(file);
  }
  const groups = [];
  for (const files of folders.values()) {
    const ebooks = files.filter(file => file.type === 'ebook');
    const works = new Map();
    for (const file of ebooks) {
      const key = titleKey(file.title);
      if (!works.has(key)) works.set(key, {title: file.title, series: file.series, seriesIndex: file.seriesIndex, files: []});
      works.get(key).files.push(file);
    }
    // Audio parts may join an identifiable book, but unrelated loose audiobooks
    // in an author/series directory must retain their own identities.
    const anchor = files[0], folderTitle = path.basename(anchor.folder);
    for (const file of files.filter(file => file.type === 'audiobook')) {
      let work;
      const audioTitle = titleKey(file.title.replace(/[- ]*(?:part|chapter|disc|track)\s*\d+.*$/i, ''));
      work = works.get(audioTitle);
      if (!work && works.size === 1 && ebooks.length && (file.formatContainer || titleKey(folderTitle) === [...works.keys()][0])) {
        work = works.values().next().value;
      }
      if (!work) {
        const audioName = file.title.replace(/[- ]*(?:part|chapter|disc|track)\s*\d+.*$/i, '').trim();
        const title = !ebooks.length ? audioName || (anchor.segments.length >= 2 ? folderTitle : file.title) : file.title;
        const key = titleKey(title);
        if (!works.has(key)) works.set(key, {title, files: []});
        work = works.get(key);
      }
      work.files.push(file);
    }
    for (const [key, work] of works) {
      const shared = works.size > 1 || anchor.segments.length < 2 || work.series;
      const title = !shared && anchor.formatContainer ? folderTitle : work.title;
      const series = work.series || (shared ? anchor.segments.slice(1) : anchor.segments.slice(1, -1)).join(' / ');
      groups.push({...work, title, series, author: anchor.segments[0] || 'Unknown Author', folder: anchor.folder,
        key: `${pathKey(anchor.folder)}|${key}`});
    }
  }
  const oldRecords = Object.entries(existingLibrary).map(([id, row]) => ({...row, id: row.id || id}));
  const fileOwners = new Map();
  for (const record of oldRecords) for (const file of record.files || []) {
    for (const value of [file.sourcePath, file.filePath, file.path].filter(Boolean)) {
      const key = pathKey(value);
      if (!fileOwners.has(key)) fileOwners.set(key, new Set());
      fileOwners.get(key).add(record);
    }
  }
  const groupRecords = new Map(), recordGroups = new Map();
  for (const group of groups) {
    const records = new Set();
    for (const file of group.files) for (const value of [file.absolutePath, file.path, `/media/books/${path.relative(file.root, file.absolutePath).replaceAll('\\', '/')}`]) {
      for (const record of fileOwners.get(pathKey(value)) || []) records.add(record);
    }
    groupRecords.set(group, [...records]);
    for (const record of records) {
      if (!recordGroups.has(record)) recordGroups.set(record, []);
      recordGroups.get(record).push(group);
    }
  }
  const output = {}, claimed = new Set();
  for (const group of groups) {
    const candidates = groupRecords.get(group).filter(record => {
      const targets = recordGroups.get(record);
      if (targets.length === 1) return true;
      const match = matches[`books:${record.localId || record.id}`];
      const title = match?.title || record.metadata?.title || record.title || record.name;
      const names = target => [target.title, ...target.files.map(file => file.alternateTitle)].filter(Boolean).map(titleKey);
      return names(group).includes(titleKey(title)) && targets.filter(target => names(target).includes(titleKey(title))).length === 1;
    });
    // No author/title fallback: it may claim a different book or another root.
    const available = candidates.filter(record => !claimed.has(record.id));
    const existing = available.length === 1 ? available[0] : {};
    const wasCollapsed = existing.id && recordGroups.get(existing)?.length > 1;
    if (existing.id) claimed.add(existing.id);
    const id = existing.id || `book-${crypto.createHash('sha1').update(group.key).digest('hex').slice(0, 20)}`;
    const previous = new Map(groupRecords.get(group).flatMap(record => (record.files || []).flatMap(file => [file.sourcePath, file.filePath, file.path].filter(Boolean).map(value => [pathKey(value), file]))));
    const files = group.files.map(file => {
      const old = previous.get(pathKey(file.absolutePath)) || {};
      const {root, absolutePath, folder, segments, formatContainer, title, alternateTitle, series, seriesIndex, ...original} = file;
      return {...old, ...original, name: file.name, path: absolutePath, sourcePath: absolutePath, filePath: absolutePath,
        parsed: {title: group.title, author: group.author, series: group.series || null, seriesIndex: group.seriesIndex || ''},
        id: old.id || crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 20),
        legacyPaths: [...new Set([...(old.legacyPaths || []), old.path, old.sourcePath, `/media/books/${path.relative(root, absolutePath).replaceAll('\\', '/')}`].filter(Boolean))],
        format: path.extname(file.name).slice(1).toUpperCase(), addedAt: old.addedAt || existing.addedAt || new Date().toISOString()};
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    const splitFromIds = groupRecords.get(group).filter(record => record.id !== existing.id).map(record => record.id);
    output[id] = {...existing, id, localId: existing.localId || id, library: 'books',
      title: wasCollapsed ? group.title : existing.title || existing.name || group.title,
      name: wasCollapsed ? group.title : existing.name || existing.title || group.title,
      author: existing.author || existing.metadata?.author || group.author,
      series: existing.series || existing.metadata?.series || group.series,
      metadata: {...(existing.metadata || {}), title: wasCollapsed ? group.title : existing.metadata?.title || group.title,
        author: existing.metadata?.author || group.author, series: existing.metadata?.series || group.series,
        seriesIndex: existing.metadata?.seriesIndex || group.seriesIndex || ''},
      folderPath: group.folder, sourcePath: group.folder, path: group.folder, files,
      ...(splitFromIds.length ? {splitFromIds} : {}),
      counts: {...(existing.counts || {}), ebooks: files.filter(file => file.type === 'ebook').length,
        audiobooks: files.filter(file => file.type === 'audiobook').length, total: files.length}};
  }
  // Keep unavailable records recoverable; only replace a collapsed record when
  // its actual files have been assigned to the new, distinct records above.
  for (const record of oldRecords) if (!recordGroups.has(record) && !output[record.id]) output[record.id] = record;
  return output;
}
module.exports = {buildBookLibrary, describeFile};
