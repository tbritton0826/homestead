const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeParts } = require('./profile-media-folders.cjs');
const images = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif']);
const fail = (text, status = 400) => Object.assign(Error(text), { status });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const key = name => String(name).normalize('NFKC').trim().toLocaleLowerCase('en-US');
const groupContainer = name => key(name) === 'shared photos' || String(name).includes('+');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

function safe(root, target, create = false) {
  root = path.resolve(root); target = path.resolve(target);
  if (!inside(root, target) || fs.lstatSync(root).isSymbolicLink()) throw fail('Photo folder is outside the configured library.', 403);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    if (fs.lstatSync(current).isSymbolicLink()) throw fail('Linked photo folders cannot be used.', 403);
  }
  return current;
}
function read(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4 * 1024 * 1024) throw fail('Photo membership is unavailable.', 403);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function write(file, value) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw fail('Photo membership is unavailable.', 403);
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function photos(folder) {
  const files = [];
  function visit(current, depth) {
    if (depth > 12 || files.length >= 10000) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory() && !['poster', 'banner'].includes(key(entry.name))) visit(file, depth + 1);
      else if (entry.isFile() && images.has(path.extname(file).toLowerCase())) files.push({ path: file, sourcePath: file, name: entry.name, type: 'image' });
    }
  }
  visit(folder, 0); return files;
}

function createPetPhotoGroups({ roots, profiles, photoRoots = () => [] }) {
  const existingRoots = () => roots().filter(root => { try { return fs.lstatSync(root).isDirectory(); } catch { return false; } }).map(root => path.resolve(root));
  function members(ids) {
    if (!Array.isArray(ids) || ids.length > 30 || !ids.length || ids.some(id => typeof id !== 'string')) throw fail('Choose at least one existing pet.');
    const records = profiles(), unique = [...new Set(ids)].sort();
    if (unique.some(id => !records.some(pet => pet.id === id))) throw fail('A selected pet is missing. Refresh the pet list.', 409);
    return unique;
  }
  function groupRows() {
    const records = profiles(), result = [];
    for (const root of existingRoots()) {
      const candidates = [];
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !groupContainer(entry.name)) continue;
        const dir = safe(root, path.join(root, entry.name));
        if (key(entry.name) === 'shared photos') {
          for (const group of fs.readdirSync(dir, { withFileTypes: true })) if (group.isDirectory() && !group.name.startsWith('.')) candidates.push(safe(root, path.join(dir, group.name)));
        } else candidates.push(dir);
      }
      for (const folder of candidates) {
        const manifest = path.join(folder, '.pet-group.json');
        let data = read(manifest);
        const tokens = path.basename(folder).split('+').map(part => part.trim()).filter(Boolean);
        const unresolved = [];
        if (!data) {
          const ids = tokens.map(token => {
            const matches = records.filter(pet => key(pet.name) === key(token) || key(pet.id) === key(token));
            if (matches.length !== 1) { unresolved.push(token); return null; }
            return matches[0].id;
          }).filter(Boolean);
          data = { version: 1, id: crypto.randomUUID(), petIds: [...new Set(ids)], confirmed: tokens.length >= 2 && !unresolved.length && new Set(ids).size >= 2 };
          // Persist only exact, unambiguous matches. Unknown names require review.
          if (data.confirmed) write(manifest, data);
        }
        if (data.version !== 1 || !Array.isArray(data.petIds) || data.petIds.some(id => typeof id !== 'string') || !/^[a-f0-9-]{32,36}$/i.test(data.id || '')) throw fail('Photo folder membership needs repair. Existing files were preserved.', 409);
        const missingPetIds = (data.petIds || []).filter(id => !records.some(pet => pet.id === id));
        result.push({ id: data.confirmed ? data.id : hash(folder).slice(0, 32), name: path.basename(folder), folder,
          petIds: data.petIds || [], unresolved, missingPetIds, confirmed: data.confirmed === true, files: photos(folder) });
      }
    }
    if (new Set(result.map(group => group.id)).size !== result.length) throw fail('Two photo folders have the same membership identity. Review their metadata before editing.', 409);
    return result;
  }
  function setMembers(id, ids) {
    if (!Array.isArray(ids)) throw fail('Choose the pets in this folder.');
    const petIds = ids.length ? members(ids) : [];
    const group = groupRows().find(row => row.id === id);
    if (!group) throw fail('Photo folder is unavailable. Refresh its list.', 404);
    write(path.join(group.folder, '.pet-group.json'), { version: 1, id: group.id, petIds, confirmed: true });
    return { ok: true };
  }
  function destination(ids, subfolder = '') {
    const petIds = members(ids), records = profiles();
    let root, folder;
    if (petIds.length === 1) {
      const pet = records.find(row => row.id === petIds[0]);
      root = existingRoots().find(dir => inside(dir, pet.sourcePath));
      const existing = fs.readdirSync(pet.sourcePath).find(name => key(name) === 'photos');
      folder = safe(root, path.join(pet.sourcePath, existing || 'photos'), true);
    } else {
      const existing = groupRows().find(row => row.confirmed && JSON.stringify([...row.petIds].sort()) === JSON.stringify(petIds));
      root = existing ? existingRoots().find(dir => inside(dir, existing.folder)) : existingRoots()[0];
      if (!root) throw fail('Configure an existing Pets folder first.', 409);
      const names = petIds.map(id => records.find(row => row.id === id).name.replace(/[<>:"/\\|?*+]/g, '_').replace(/\p{Cc}/gu, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 50) || 'Pet');
      const fullName = names.join(' + ');
      const folderName = fullName.length <= 180 ? fullName : fullName.slice(0, 140) + ' + group-' + hash(JSON.stringify(petIds)).slice(0, 16);
      folder = existing?.folder || path.join(root, 'Shared Photos', folderName);
      if (!existing && fs.existsSync(folder)) throw fail('This shared folder needs its membership confirmed before import.', 409);
      safe(root, folder, true);
      if (!existing) write(path.join(folder, '.pet-group.json'), { version: 1, id: crypto.randomUUID(), petIds, confirmed: true });
    }
    return safe(root, path.join(folder, ...relativeParts(subfolder)), true);
  }
  function link(records) {
    const groups = groupRows();
    return records.map(pet => {
      const linked = groups.filter(group => group.confirmed && group.petIds.includes(pet.id)).flatMap(group => group.files.map(file => ({ ...file, groupId: group.id, shared: true })));
      const unique = new Map([...pet.files, ...linked].map(file => [file.sourcePath || file.path, file]));
      return { ...pet, files: [...unique.values()] };
    });
  }
  function journal(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id || '')) throw fail('A valid operation identity is required.');
    const root = existingRoots()[0]; if (!root) throw fail('Configure an existing Pets folder first.', 409);
    const dir = safe(root, path.join(root, '.pet-operations'), true);
    return path.join(dir, id + '.json');
  }
  function upload(input, bytes) {
    const ids = members(input.petIds), ext = path.extname(String(input.name || '')).toLowerCase();
    if (!images.has(ext) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 64 * 1024 * 1024) throw fail('Choose a photo up to 64 MB.');
    const receiptFile = journal(input.requestId), signature = hash(bytes), fingerprint = JSON.stringify([ids, input.folder || '', signature, input.name]);
    const saved = read(receiptFile);
    if (saved && saved.fingerprint !== fingerprint) throw fail('This upload identity was used with other details.', 409);
    if (saved?.receipt) {
      const root = existingRoots().find(root => inside(root, saved.receipt.path));
      if (!root || !fs.existsSync(saved.receipt.path)) throw fail('The previously imported original is missing. Restore it before retrying.', 409);
      safe(root, saved.receipt.path);
      if (hash(fs.readFileSync(saved.receipt.path)) !== signature) throw fail('The saved original changed. No replacement was written.', 409);
      return saved.receipt;
    }
    const folder = saved?.folder || destination(ids, input.folder);
    const destinationRoot = existingRoots().find(root => inside(root, folder));
    if (!destinationRoot) throw fail('The destination mapping changed. Review the saved operation.', 409);
    safe(destinationRoot, folder);
    const file = path.join(folder, signature + ext);
    // A content-addressed name also avoids duplicates when a caller retries with
    // a new identity. Different membership must be changed through Organize.
    const other = [...profiles().flatMap(pet => pet.files), ...groupRows().flatMap(group => group.files)].find(row => path.basename(row.path).split('.')[0] === signature && row.path !== file);
    if (other) throw fail('This photo is already filed. Use Organize existing photos to move its original.', 409);
    write(receiptFile, { fingerprint, folder });
    if (fs.existsSync(file)) {
      safe(existingRoots().find(root => inside(root, file)), file);
      if (hash(fs.readFileSync(file)) !== signature) throw fail('A destination photo conflicts with this import.', 409);
    } else fs.writeFileSync(file, bytes, { flag: 'wx' });
    const receipt = { ok: true, requestId: input.requestId, folder: input.folder || '', path: file, petIds: ids };
    write(receiptFile, { fingerprint, folder, receipt }); return receipt;
  }
  function source(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !images.has(path.extname(file).toLowerCase())) throw fail('Choose an existing library photo.');
    const root = [...existingRoots(), ...photoRoots()].map(dir => path.resolve(dir)).find(dir => inside(dir, path.resolve(file)));
    if (!root) throw fail('Photo is outside the configured libraries.', 403);
    safe(root, file);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 64 * 1024 * 1024) throw fail('Choose a photo up to 64 MB.');
    if (path.relative(root, file).split(path.sep).some(part => part.startsWith('.') || ['poster', 'banner'].includes(key(part))) || /^(poster|banner)\./i.test(path.basename(file))) throw fail('Choose a photo, not profile artwork or private metadata.', 403);
    return path.resolve(file);
  }
  function catalog(includePhotos) {
    const files = [...profiles().flatMap(pet => pet.files.filter(file => file.type === 'image')), ...groupRows().flatMap(group => group.files)];
    if (includePhotos) for (const root of photoRoots()) if (fs.existsSync(root) && fs.lstatSync(root).isDirectory()) files.push(...photos(root));
    return [...new Map(files.map(file => [file.sourcePath || file.path, file])).values()].slice(0, 20000);
  }
  function plan(input, allowPhotos) {
    const file = journal(input.requestId), petIds = members(input.petIds);
    if (!Array.isArray(input.paths) || !input.paths.length || input.paths.length > 100) throw fail('Choose 1–100 photos.');
    const paths = [...new Set(input.paths)];
    const fingerprint = JSON.stringify([paths, petIds, input.folder || '']);
    const prior = read(file);
    if (prior) { if (!allowPhotos && prior.items?.some(item => !existingRoots().some(root => inside(root, item.from)))) throw fail('Photos library access is required.', 403); if (prior.fingerprint !== fingerprint || prior.kind !== 'move') throw fail('Operation identity already used.', 409); return { ok: true, plan: prior }; }
    const folder = destination(petIds, input.folder);
    const items = paths.map(value => {
      const from = source(value);
      if (!allowPhotos && !existingRoots().some(root => inside(root, from))) throw fail('Photos library access is required.', 403);
      const to = path.join(folder, path.basename(from));
      if (from !== to && fs.existsSync(to)) throw fail('A destination filename already exists. No originals were moved.', 409);
      return { from, to, digest: hash(fs.readFileSync(from)), done: from === to };
    });
    if (new Set(items.map(item => item.to)).size !== items.length) throw fail('Two selected photos have the same filename. Organize them separately.', 409);
    const value = { id: input.requestId, kind: 'move', fingerprint, petIds, folder, items, createdAt: new Date().toISOString() };
    write(file, value); return { ok: true, plan: value };
  }
  function apply(id, allowPhotos) {
    const file = journal(id), value = read(file);
    if (value?.kind !== 'move') throw fail('Review a photo move first.', 404);
    members(value.petIds);
    for (const item of value.items) {
      if (!allowPhotos && !existingRoots().some(root => inside(root, item.from))) throw fail('Photos library access is required.', 403);
      const root = existingRoots().find(dir => inside(dir, item.to));
      if (!root) throw fail('The destination mapping changed; review a new move.', 409);
      safe(root, path.dirname(item.to));
      const check = target => {
        if (fs.lstatSync(target).isSymbolicLink() || hash(fs.readFileSync(target)) !== item.digest) throw fail('A photo changed since review. No conflicting file was replaced.', 409);
      };
      if (item.done) { if (!fs.existsSync(item.to)) throw fail('A previously moved original is missing.', 409); safe(root, item.to); check(item.to); continue; }
      // Persist move intent before touching bytes. On interruption a matching
      // destination can be verified and finished without a second original.
      if (fs.existsSync(item.from)) { source(item.from); check(item.from); }
      if (!item.started && fs.existsSync(item.to)) throw fail('A destination appeared after review.', 409);
      item.started = true; write(file, value);
      if (fs.existsSync(item.to)) check(item.to);
      else {
        if (!fs.existsSync(item.from)) throw fail('The original is missing. Restore it before retrying.', 409);
        try { fs.renameSync(item.from, item.to); }
        catch (error) {
          if (error.code !== 'EXDEV') throw error;
          const staged = item.to + '.' + id + '.tmp';
          if (fs.existsSync(staged)) { if (fs.lstatSync(staged).isSymbolicLink()) throw fail('Move staging is unavailable.', 403); fs.unlinkSync(staged); }
          fs.copyFileSync(item.from, staged, fs.constants.COPYFILE_EXCL); check(staged);
          fs.linkSync(staged, item.to); fs.unlinkSync(staged);
        }
        check(item.to);
      }
      if (item.from !== item.to && fs.existsSync(item.from)) { source(item.from); check(item.from); fs.unlinkSync(item.from); }
      item.done = true; write(file, value);
    }
    return { ok: true, plan: value };
  }
  return { groups: groupRows, setMembers, link, upload, catalog, plan, apply };
}
module.exports = { createPetPhotoGroups, groupContainer };
