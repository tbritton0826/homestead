const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function registerAccountPlayback({ app, directory, currentUser }) {
  fs.mkdirSync(directory, { recursive: true });
  const location = user => path.join(directory, crypto.createHash('sha256').update(String(user.id)).digest('hex') + '.json');
  function read(user) {
    try { return JSON.parse(fs.readFileSync(location(user), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  app.get('/api/account/playback', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: 'Sign in to Homestead.' });
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ ok: true, userId: user.id, entries: read(user) }); }
    catch { res.status(500).json({ ok: false, message: 'Playback history could not be read.' }); }
  });
  app.put('/api/account/playback', (req, res) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ ok: false, message: 'Sign in to Homestead.' });
    const { id, position, duration } = req.body || {};
    if (!/^[a-f0-9]{64}$/.test(id || '') || typeof position !== 'number' || typeof duration !== 'number' ||
        !Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0 || duration > 31536000) {
      return res.status(400).json({ ok: false, message: 'Invalid playback position.' });
    }
    try {
      const entries = read(user);
      entries[id] = { position: Math.min(position, duration), duration, completed: position >= duration * 0.95, updatedAt: new Date().toISOString() };
      const bounded = Object.fromEntries(Object.entries(entries).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt))).slice(0, 500));
      const file = location(user);
      fs.writeFileSync(file + '.tmp', JSON.stringify(bounded));
      fs.renameSync(file + '.tmp', file);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, userId: user.id, entry: entries[id] });
    } catch { res.status(500).json({ ok: false, message: 'Playback position could not be saved.' }); }
  });
}
module.exports = { registerAccountPlayback };
