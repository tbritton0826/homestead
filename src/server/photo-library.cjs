const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif']);
const failure = (message, status = 400) => Object.assign(Error(message), { status });
const identity = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
function photoRoots(config) {
  const mapped = config.folderMappings?.photos;
  const values = Array.isArray(mapped) ? mapped : typeof mapped === 'string' ? [mapped] : mapped?.paths || mapped?.folders || (mapped?.path ? [mapped.path] : mapped?.folder ? [mapped.folder] : []);
  return [...new Set((values.length ? values : [path.join(process.env.MEDIA_ROOT || config.mediaRoot || '/media', 'photos')]).map(value => path.resolve(value)))];
}
function separatePhotoLibraries(index, config) {
  // Repair the old scanner's implicit Photos -> Adult Photos alias in responses;
  // keep intentional explicit mappings and every file on disk untouched.
  if (config.folderMappings?.adultPhotos || config.folderMappings?.['adult-photos']) return index;
  const publicRoots = photoRoots(config);
  const base = config.folderMappings?.adult;
  const adultRoots = (Array.isArray(base) ? base : typeof base === 'string' ? [base] : [path.join(process.env.MEDIA_ROOT || config.mediaRoot || '/media', 'adult')]).map(root => path.resolve(root, 'photos'));
  const inside = (root, value) => value === root || value.startsWith(root + path.sep);
  const keep = row => {
    const source = row?.sourcePath || row?.folderPath;
    if (!source) return true;
    const value = path.resolve(source);
    return !publicRoots.some(root => inside(root, value)) || adultRoots.some(root => inside(root, value));
  };
  const filter = rows => Array.isArray(rows) ? rows.filter(keep) : Object.fromEntries(Object.entries(rows || {}).filter(([, row]) => keep(row)));
  const result = { ...index, libraries: { ...(index.libraries || {}) } };
  if (result.libraries.adultPhotos) result.libraries.adultPhotos = filter(result.libraries.adultPhotos);
  if (result.adultPhotos) result.adultPhotos = filter(result.adultPhotos);
  return result;
}
function createPhotoLibrary({ config, changed = () => {} }) {
  const locks = new Set();
  function roots() { return photoRoots(config()).filter(root => { try { return fs.statSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(); } catch { return false; } }); }
  function safe(root, target) {
    const base = fs.realpathSync(root), real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(base + path.sep)) throw failure('Photo destination is unavailable.', 403);
    return real;
  }
  function albums() {
    const rows = [];
    for (const root of roots()) {
      rows.push({ id: identity(root), name: 'Unsorted Photos', path: root });
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const directory = path.join(root, entry.name);
        safe(root, directory);
        rows.push({ id: identity(directory), name: entry.name, path: directory });
      }
    }
    return rows;
  }
  function list() {
    return albums().map(album => {
      const files = [];
      const root = roots().find(root => album.path === root || album.path.startsWith(root + path.sep));
      function walk(directory, depth = 0) {
        if (depth > 12 || files.length >= 5000) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const file = path.join(directory, entry.name);
          if (entry.isDirectory() && album.path !== root) walk(safe(root, file), depth + 1);
          else if (entry.isFile() && images.has(path.extname(entry.name).toLowerCase())) {
            files.push({ path: file, name: entry.name, type: 'image' });
          }
          if (files.length >= 5000) break;
        }
      }
      walk(album.path);
      return { ...album, title: album.name, files, poster: files[0]?.path || '', truncated: files.length >= 5000, counts: { total: files.length } };
    });
  }
  function create(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[<>:"/\\|?*]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32) || name.startsWith('.') || /[. ]$/.test(name)) throw failure('Enter a simple album name without slashes.');
    const root = roots()[0];
    if (!root) throw failure('The Photos folder is not mounted or writable. Check the server folder mapping.', 503);
    const folder = path.join(root, name.trim());
    if (fs.existsSync(folder)) throw failure('An album with that name already exists. Select the existing album.', 409);
    fs.mkdirSync(folder); safe(root, folder); changed();
    return { id: identity(folder), name: name.trim(), path: folder };
  }
  async function upload(albumID, requestID, name, data) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestID || '') || !/^[a-f0-9]{32}$/i.test(albumID || '')) throw failure('Invalid photo upload identity.');
    const album = albums().find(row => row.id === albumID);
    if (!album) throw failure('Select an available photo album.', 404);
    if (!Buffer.isBuffer(data) || !data.length || data.length > 32 * 1024 * 1024) throw failure('Choose photos up to 32 MB.', 413);
    const ext = path.extname(String(name || '')).toLowerCase();
    if (!images.has(ext)) throw failure('Choose a supported photo format.');
    const lock = albumID + ':' + requestID.toLowerCase();
    if (locks.has(lock)) throw failure('This photo is still being saved. Retry shortly.', 409);
    locks.add(lock);
    try {
      const destination = path.join(album.path, requestID.toLowerCase() + ext);
      const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
      if (fs.existsSync(destination)) {
        if (fs.lstatSync(destination).isSymbolicLink() || digest(fs.readFileSync(destination)) !== digest(data)) throw failure('The upload identity already belongs to another photo.', 409);
      } else {
        // Sharp may lack HEIC decoding on some installations; validate its file signature there.
        if (['.heic', '.heif'].includes(ext)) {
          if (data.length < 12 || data.toString('ascii', 4, 8) !== 'ftyp' || !/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(data.toString('ascii', 8, 12))) throw failure('The selected file is not a HEIC photo.');
        } else { try { await sharp(data, { limitInputPixels: 100000000 }).metadata(); } catch { throw failure('The selected file is not a readable photo.'); } }
        const temporary = path.join(album.path, '.upload-' + crypto.randomUUID());
        try { fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 }); fs.linkSync(temporary, destination); }
        finally { fs.rmSync(temporary, { force: true }); }
      }
      changed(); return { ok: true, albumId: albumID, requestId: requestID, path: destination };
    } finally { locks.delete(lock); }
  }
  return { list, create, upload };
}
function registerPhotoLibrary(app, { express, service, access, config, feature }) {
  const guard = write => (req, res, next) => {
    const context = access(req), user = context.user;
    const allowed = config().enabledLibraries?.photos !== false && (context.authEnabled === false || user?.role === 'owner' || user?.allowedLibraries?.includes('*') || user?.allowedLibraries?.includes('photos'));
    if (!allowed || write && (user?.readOnly || !['owner', 'admin'].includes(user?.role))) return res.status(403).json({ ok: false, message: 'This account cannot access or change Photos.' });
    res.setHeader('Cache-Control', 'private, no-store'); next();
  };
  const run = action => async (req, res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 503).json({ ok: false, message: error.status ? error.message : 'The Photos folder is unavailable. Check the server mapping and retry.' }); } };
  app.get('/api/photos/native', feature, guard(false), run(req => ({ ok: true, albums: service.list(), canEdit: !access(req).user?.readOnly && ['owner', 'admin'].includes(access(req).user?.role) })));
  app.post('/api/photos/native/albums', feature, guard(true), run(req => ({ ok: true, album: service.create(req.body?.name) })));
  app.post('/api/photos/native/albums/:albumID/media', feature, guard(true), express.raw({ type: 'application/octet-stream', limit: '32mb' }), run(req => service.upload(req.params.albumID, req.query.requestId, req.query.name, req.body)));
}
module.exports = { photoRoots, separatePhotoLibraries, createPhotoLibrary, registerPhotoLibrary };
