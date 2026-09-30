const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// One authoritative snapshot keeps recipes and categories together. Legacy
// appdata is imported once and retained, never silently replaced with [].
function createRecipeLibrary({ dataDir, libraryDir }) {
  const root = path.resolve(libraryDir || path.join(dataDir, 'recipe-library'));
  const metadataPath = path.join(root, 'homestead-recipes.json');
  const artworkRoot = path.join(root, 'artwork');
  const backupPath = `${metadataPath}.bak`;
  let recovered = false;

  function atomicWrite(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, contents);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  function validate(value) {
    if (value?.format === 'homestead-recipes' && value.version !== 1) {
      const error = new Error('This recipe metadata needs a newer Homestead version. Your files were not changed.');
      error.code = 'UNSUPPORTED_RECIPE_VERSION';
      throw error;
    }
    if (value?.format !== 'homestead-recipes' || value.version !== 1 ||
        !Array.isArray(value.recipes) || !value.users || typeof value.users !== 'object' || Array.isArray(value.users) ||
        value.recipes.some(r => !r || typeof r.id !== 'string' || !r.id || typeof r.title !== 'string') ||
        new Set(value.recipes.map(r => r.id)).size !== value.recipes.length ||
        Object.values(value.users).some(categories => !Array.isArray(categories))) {
      throw new Error('Invalid or unsupported recipe metadata. Restore a valid metadata file before saving.');
    }
    return value;
  }

  function readFile(file) {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  function migrate() {
    const readLegacy = (name, fallback) => {
      const file = path.join(dataDir, name);
      // Missing is different from corrupt or inaccessible: never erase either.
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    };
    const fallbackRoot = path.resolve(dataDir, 'recipe-library');
    const fallbackMetadata = path.join(fallbackRoot, 'homestead-recipes.json');
    const fromFallback = root !== fallbackRoot && (fs.existsSync(fallbackMetadata) || fs.existsSync(`${fallbackMetadata}.bak`));
    let snapshot;
    if (fromFallback) {
      // Adding a separate mount after upgrading must carry over newer saves
      // from the default location, not re-import an obsolete legacy file.
      snapshot = readFile(fs.existsSync(fallbackMetadata) ? fallbackMetadata : `${fallbackMetadata}.bak`);
    } else {
      const legacy = readLegacy('recipes.json', { recipes: [] });
      const categories = readLegacy('recipe-categories.json', { users: {} });
      snapshot = validate({ format: 'homestead-recipes', version: 1,
        updatedAt: new Date().toISOString(), recipes: legacy.recipes, users: categories.users });
    }
    fs.mkdirSync(artworkRoot, { recursive: true });
    const oldArtwork = fromFallback ? path.join(fallbackRoot, 'artwork') : path.join(dataDir, 'recipe-artwork');
    if (fs.existsSync(oldArtwork)) {
      for (const name of fs.readdirSync(oldArtwork)) {
        if (!/^recipe-[a-z0-9-]+\.(?:jpe?g|png|webp|gif)$/i.test(name)) continue;
        const destination = path.join(artworkRoot, name);
        if (!fs.existsSync(destination)) atomicWrite(destination, fs.readFileSync(path.join(oldArtwork, name)));
      }
    }
    const json = JSON.stringify(snapshot, null, 2) + '\n';
    atomicWrite(backupPath, json);
    atomicWrite(metadataPath, json);
    return snapshot;
  }

  function read() {
    if (libraryDir && (!fs.existsSync(root) || !fs.statSync(root).isDirectory())) {
      throw new Error('The configured recipe folder is unavailable. Restore its folder mapping before saving recipes.');
    }
    try { return readFile(metadataPath); }
    catch (error) {
      if (error.code === 'UNSUPPORTED_RECIPE_VERSION') throw error;
      if (error.code === 'ENOENT' && !fs.existsSync(backupPath)) return migrate();
      try {
        const backup = readFile(backupPath);
        // Preserve the damaged original for recovery; avoid a silent reset.
        if (fs.existsSync(metadataPath)) fs.copyFileSync(metadataPath, `${metadataPath}.damaged-${crypto.randomUUID()}`);
        atomicWrite(metadataPath, JSON.stringify(backup, null, 2) + '\n');
        recovered = true;
        return backup;
      } catch (backupError) {
        throw new Error(`Recipe metadata could not be read. Your files have been left in place; restore a valid homestead-recipes.json or .bak before saving. ${error.message}`);
      }
    }
  }

  function update(mutator) {
    const previous = read();
    const next = validate(mutator(structuredClone(previous)));
    next.updatedAt = new Date().toISOString();
    // Validate before touching either file. A failed save propagates to the API.
    atomicWrite(backupPath, JSON.stringify(previous, null, 2) + '\n');
    atomicWrite(metadataPath, JSON.stringify(next, null, 2) + '\n');
    return next;
  }

  return { read, update, artworkRoot, metadataPath,
    status: () => ({ metadataFile: metadataPath, separateFolder: Boolean(libraryDir), recoveredFromBackup: recovered }) };
}

module.exports = { createRecipeLibrary };
