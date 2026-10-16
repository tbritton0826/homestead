const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeParts } = require('./profile-media-folders.cjs');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const kinds = { photos: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'], videos: ['mp4', 'mov', 'm4v', 'webm', 'mkv'], documents: ['pdf', 'txt', 'md', 'doc', 'docx', 'rtf'], poster: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'], banner: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] };
function createPetProfiles({ roots }) {
  function directory(root, relative = '', create = false) {
    let current = fs.realpathSync(root);
    for (const part of relativeParts(relative)) {
      current = path.join(current, part);
      if (!fs.existsSync(current) && create) fs.mkdirSync(current);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('Linked or unavailable pet folders cannot be used.', 403);
    }
    return current;
  }
  const availableRoots = () => roots().filter(root => { try { return fs.statSync(root).isDirectory(); } catch { return false; } });
  function resolve(id) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,119}$/.test(id) || id.includes('..')) throw fail('Invalid pet identity.');
    const found = availableRoots().filter(root => fs.existsSync(path.join(root, id)));
    if (found.length !== 1) throw fail('Pet folder is missing or ambiguous.', 404);
    return directory(found[0], id);
  }
  function metadata(folder) {
    const file = path.join(folder, 'metadata.json');
    if (!fs.existsSync(file)) return {};
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 1024 * 1024) throw fail('Pet metadata is unavailable.', 403);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  function writeMetadata(folder, data) {
    const temp = path.join(folder, `.metadata-${crypto.randomUUID()}.tmp`);
    try { fs.writeFileSync(temp, JSON.stringify(data, null, 2), { flag: 'wx' }); fs.renameSync(temp, path.join(folder, 'metadata.json')); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function record(id) {
    const folder = resolve(id), stored = metadata(folder), info = { ...stored, ...stored.metadata }, files = [];
    function visit(current, depth = 0) {
      if (depth > 12 || files.length >= 10000) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(current, entry.name), ext = path.extname(entry.name).slice(1).toLowerCase();
        if (entry.isDirectory() && !(depth === 0 && ['poster', 'banner'].includes(entry.name))) visit(full, depth + 1);
        else if (entry.isFile() && Object.values(kinds).some(values => values.includes(ext))) files.push({ path: full, name: entry.name, type: kinds.videos.includes(ext) ? 'video' : kinds.documents.includes(ext) ? 'document' : 'image' });
      }
    }
    visit(folder);
    return { id, name: info.name || id, sourcePath: folder, folderPath: folder, metadata: info, poster: info.poster, banner: info.banner, files };
  }
  function list() {
    const ids = new Set();
    for (const root of availableRoots()) for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) ids.add(entry.name);
    }
    return [...ids].sort().map(id => record(id));
  }
  function create(input) {
    const fields = {};
    for (const key of ['name', 'species', 'breed', 'sex', 'birthday', 'weight', 'description']) {
      if (input[key] != null && typeof input[key] !== 'string') throw fail('Pet details must be text.');
      fields[key] = String(input[key] || '').trim();
      if (fields[key].length > (key === 'description' ? 8000 : 160)) throw fail('A pet detail is too long.');
    }
    if (!fields.name) throw fail('A pet name is required.');
    const root = availableRoots()[0];
    if (!root) throw fail('Configure an existing Pets library folder first.', 409);
    const requestId = input.requestId || crypto.randomUUID();
    if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw fail('Invalid pet creation identity.');
    const id = `pet-${requestId}`;
    if (fs.existsSync(path.join(root, id))) {
      const saved = metadata(resolve(id));
      if (saved.creationRequestId === requestId && JSON.stringify(saved.metadata) === JSON.stringify(fields)) return record(id);
      throw fail('This creation may already have completed. Reload the pet list before trying again.', 409);
    }
    const folder = directory(root, id, true);
    writeMetadata(folder, { id, name: fields.name, metadata: fields, creationRequestId: requestId, createdAt: new Date().toISOString() });
    return record(id);
  }
  function folders(id, kind, parent = '', name) {
    if (!['photos', 'videos', 'documents'].includes(kind)) throw fail('Choose Photos, Videos, or Documents.');
    const profile = resolve(id), relative = [kind, ...relativeParts(parent)].join('/');
    let folder;
    if (name != null) {
      if (relativeParts(name).length !== 1) throw fail('Enter one folder name.');
      directory(profile, relative, true);
      const child = path.join(profile, relative, name);
      if (fs.existsSync(child)) throw fail('This folder already exists.', 409);
      fs.mkdirSync(child); folder = directory(profile, relative);
    } else {
      if (!fs.existsSync(path.join(profile, kind)) && !parent) return { ok: true, folders: [] };
      folder = directory(profile, relative);
    }
    return { ok: true, folders: fs.readdirSync(folder, { withFileTypes: true }).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => ({ name: item.name, path: [parent, item.name].filter(Boolean).join('/') })) };
  }
  function upload(id, input, bytes) {
    const kind = input.kind, ext = path.extname(String(input.name || '')).slice(1).toLowerCase();
    if (!kinds[kind]?.includes(ext)) throw fail('This file format does not match the selected pet media category.');
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 64 * 1024 * 1024) throw fail('Choose files up to 64 MB.', 413);
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw fail('An upload identity is required.');
    const profile = resolve(id), folder = String(input.folder || '');
    if (['poster', 'banner'].includes(kind) && folder) throw fail('Artwork cannot use a media subfolder.');
    // Custom destinations must exist already; defaults may be created here.
    const target = directory(profile, [kind, ...relativeParts(folder)].join('/'), !folder);
    const name = `${input.requestId}.${ext}`, destination = path.join(target, name);
    if (fs.existsSync(destination)) {
      if (fs.lstatSync(destination).isSymbolicLink() || !fs.readFileSync(destination).equals(bytes)) throw fail('Upload identity collision.', 409);
    } else fs.writeFileSync(destination, bytes, { flag: 'wx' });
    if (['poster', 'banner'].includes(kind)) { const info = metadata(profile); info[kind] = destination; info.metadata = { ...info.metadata, [kind]: destination }; writeMetadata(profile, info); }
    return { ok: true, requestId: input.requestId, folder, path: destination };
  }
  return { list, record, create, folders, upload };
}
function registerPetProfiles(app, { express, service, access, config, changed = () => {} }) {
  const gate = (write = false) => (req, res, next) => {
    const setup = config(), user = access.accessContext(req).user;
    if (setup.enabledLibraries?.family !== true || setup.familySublibraries?.pets === false || !(access.canAccessLibrary(req, 'pets') || access.canAccessLibrary(req, 'family'))) return res.status(403).json({ ok: false, message: 'Pets library is unavailable for this account.' });
    if (write && !['owner', 'admin'].includes(user?.role)) return res.status(403).json({ ok: false, message: 'This pet library is read-only.' });
    next();
  };
  const wrap = fn => (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(fn(req)); } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Pet operation failed.' }); } };
  const session = access.requireSession, feature = access.requireFeature('pets');
  app.get('/api/pets', session, feature, gate(), wrap(req => ({ ok: true, canEdit: ['owner', 'admin'].includes(access.accessContext(req).user?.role), records: service.list() })));
  app.post('/api/pets', session, feature, gate(true), wrap(req => { const record = service.create(req.body || {}); changed(); return { ok: true, record }; }));
  app.get('/api/pets/:id', session, feature, gate(), wrap(req => ({ ok: true, record: service.record(req.params.id) })));
  app.get('/api/pets/:id/folders', session, feature, gate(true), wrap(req => service.folders(req.params.id, req.query.kind, req.query.parent)));
  app.post('/api/pets/:id/folders', session, feature, gate(true), wrap(req => service.folders(req.params.id, req.body.kind, req.body.parent, req.body.name)));
  app.post('/api/pets/:id/media', session, feature, gate(true), express.raw({ type: 'application/octet-stream', limit: '64mb' }), wrap(req => { const receipt = service.upload(req.params.id, req.query, req.body); changed(); return receipt; }));
}
module.exports = { createPetProfiles, registerPetProfiles };
