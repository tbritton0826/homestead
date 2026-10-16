const fs = require('node:fs');
const path = require('node:path');

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function segment(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 120 ||
      value.startsWith('.') || /[\\/:]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw failure('Choose a folder name without separators, hidden names, or control characters.');
  return value;
}
function relativeParts(value = '') {
  if (typeof value !== 'string' || value.length > 1024 || value.split('/').length > 12) throw failure('Invalid folder path.');
  return value === '' ? [] : value.split('/').map(segment);
}

function createProfileFolderService({ findProfile, roots, typeFolders }) {
  function resolveProfile(library, profileId) {
    if (!['personal', 'performers', 'celebrities'].includes(library)) throw failure('Unsupported profile library.');
    segment(profileId);
    const profile = findProfile(library, profileId);
    if (!profile || !fs.existsSync(profile)) throw failure('Profile not found.', 404);
    const real = fs.realpathSync(profile);
    const allowed = roots(library).some(root => {
      try { const resolved = fs.realpathSync(root); return resolved !== real && inside(resolved, real); } catch { return false; }
    });
    if (!allowed || !fs.statSync(real).isDirectory()) throw failure('Profile is outside its configured library.', 403);
    return real;
  }
  function directory(profile, type, relative = '', create = false) {
    if (!['photo', 'photos', 'gallery', 'nude', 'nudes', 'adultSet', 'artwork', 'reference'].includes(type)) throw failure('This media category does not support photo folders.');
    const base = typeFolders[type];
    if (!base) throw failure('Unsupported photo category.');
    const parts = [segment(base), ...relativeParts(relative)];
    const root = fs.realpathSync(profile);
    if (root !== path.resolve(profile) || fs.lstatSync(profile).isSymbolicLink()) throw failure('Profile folder changed; refresh before continuing.', 403);
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      if (!inside(root, current)) throw failure('Folder is outside this profile.', 403);
      if (!fs.existsSync(current)) {
        if (!create) return null;
        fs.mkdirSync(current);
      }
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory() || !inside(root, fs.realpathSync(current))) throw failure('Linked or invalid profile folders cannot be used.', 403);
    }
    return current;
  }
  function list(profile, type, parent = '') {
    const folder = directory(profile, type, parent);
    if (!folder && parent) throw failure('Folder not found.', 404);
    const folders = folder ? fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .flatMap(entry => {
        try { segment(entry.name); return [{ name: entry.name, path: [parent, entry.name].filter(Boolean).join('/') }]; } catch { return []; }
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [];
    return { ok: true, version: 1, parent, folders };
  }
  function create(profile, type, parent, name) {
    segment(name); relativeParts(parent);
    const parentDir = directory(profile, type, parent, parent === '');
    if (!parentDir) throw failure('Parent folder not found.', 404);
    const relative = [parent, name].filter(Boolean).join('/');
    if (fs.existsSync(path.join(parentDir, name))) throw failure('A folder with this name already exists. Refresh and select it.', 409);
    directory(profile, type, relative, true);
    return { ok: true, version: 1, path: relative };
  }
  return { resolveProfile, directory, list, create };
}

function canEditProfileFolder(access, config, library, profileId) {
  const key = library === 'personal' ? 'personalProfiles' : library;
  if (!['personal', 'performers', 'celebrities'].includes(library) ||
      !['owner', 'admin'].includes(access.user?.role) || config.enabledLibraries?.adult !== true ||
      config.adultSublibraries?.[key] === false) return false;
  if (access.fullAdultAccess) return true;
  if (access.adultAccessMode === 'linked-profile') return library === 'personal' &&
    String(access.linkedAdultProfileId || '').toLowerCase() === String(profileId || '').toLowerCase() && Boolean(profileId);
  return access.adultSublibraryAccess?.[key] === true;
}

function registerProfileFolderRoutes(app, { service, requireAdmin, requireAdult, canEditProfile = () => false }) {
  function handler(create) {
    return (req, res) => {
      try {
        const values = create ? req.body || {} : req.query || {};
        if (!canEditProfile(req, values.library, values.profileId)) throw failure('This profile is read-only for your account.', 403);
        const profile = service.resolveProfile(values.library, values.profileId);
        res.setHeader('Cache-Control', 'no-store');
        res.json(create ? service.create(profile, values.type || 'photo', values.parent || '', values.name) :
          service.list(profile, values.type || 'photo', values.parent || ''));
      } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Profile folder operation failed.' }); }
    };
  }
  app.get('/api/adult/profile-folders', requireAdmin, requireAdult, handler(false));
  app.post('/api/adult/profile-folders', requireAdmin, requireAdult, handler(true));
}
module.exports = { createProfileFolderService, registerProfileFolderRoutes, canEditProfileFolder, relativeParts };
