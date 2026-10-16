const path = require('node:path');
function bookDirectory(row) {
  const folder = row.folderPath || row.profileDir || row.sourcePath;
  if (!folder || typeof folder !== 'string') return null;
  const normalized = path.resolve(folder);
  return /^(audio\s*books?|audio)$/i.test(path.basename(normalized)) ? path.dirname(normalized) : normalized;
}
function relatedBookRecords(index, recordId) {
  const libraries = index.libraries || index;
  const entries = ['books', 'audiobooks'].flatMap(key => Object.entries(libraries[key] || {}));
  const selected = entries.filter(([key, row]) => row && [key, row.id, row.localId].includes(recordId)).map(([, row]) => row);
  const explicit = row => row.editionGroupId || row.workId || row.metadata?.editionGroupId || row.metadata?.workId;
  return entries.filter(([, row]) => row && selected.some(book => {
    if (book === row) return true;
    const a = explicit(book), b = explicit(row);
    if (a || b) return Boolean(a && b && a === b);
    const folder = bookDirectory(book);
    const title = String(book.title || book.name || book.metadata?.title || '').trim().toLowerCase();
    const otherTitle = String(row.title || row.name || row.metadata?.title || '').trim().toLowerCase();
    return folder && folder === bookDirectory(row) &&
      [title, otherTitle].includes(path.basename(folder).toLowerCase());
  })).map(([, row]) => row);
}
function registerBookLocalFiles(app, { requireSession, authorizedIndex }) {
  app.get('/api/books/local-files', requireSession, (req, res) => {
    try {
      const recordId = String(req.query.recordId || '').replace(/^books:/, '');
      if (!recordId || recordId.length > 512) return res.status(400).json({ ok: false, message: 'A book identity is required.' });
      // Reuse the same live scanner and account filter as normal library browsing.
      // A caller-supplied folder or guessed filename never authorizes a file.
      const index = authorizedIndex(req);
      const records = relatedBookRecords(index, recordId);
      if (!records.length) return res.status(404).json({ ok: false, message: 'Book is unavailable for this account. Refresh its library.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, records });
    } catch { res.status(500).json({ ok: false, message: 'Available book formats could not be checked.' }); }
  });
}
module.exports = { registerBookLocalFiles, relatedBookRecords };
