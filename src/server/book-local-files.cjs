function registerBookLocalFiles(app, { requireSession, authorizedIndex }) {
  app.get('/api/books/local-files', requireSession, (req, res) => {
    try {
      const recordId = String(req.query.recordId || '').replace(/^books:/, '');
      if (!recordId || recordId.length > 512) return res.status(400).json({ ok: false, message: 'A book identity is required.' });
      // Reuse the same live scanner and account filter as normal library browsing.
      // A caller-supplied folder or guessed filename never authorizes a file.
      const index = authorizedIndex(req);
      const libraries = index.libraries || index;
      const records = ['books', 'audiobooks'].flatMap(key => {
        const collection = libraries[key] || {};
        return Object.entries(collection).filter(([key, row]) => row && [key, row.id, row.localId].includes(recordId)).map(([, row]) => row);
      });
      if (!records.length) return res.status(404).json({ ok: false, message: 'Book is unavailable for this account. Refresh its library.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, records });
    } catch { res.status(500).json({ ok: false, message: 'Available book formats could not be checked.' }); }
  });
}
module.exports = { registerBookLocalFiles };
