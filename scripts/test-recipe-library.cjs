const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecipeLibrary } = require('../src/server/recipe-library.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-recipes-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'appdata');
  const libraryDir = path.join(root, 'Recipes');
  fs.mkdirSync(dataDir); fs.mkdirSync(libraryDir);
  const store = createRecipeLibrary({ dataDir, libraryDir });
  return { root, dataDir, libraryDir, store };
}
const recipe = { id: 'recipe-one', title: 'Soup', ingredients: ['Carrots'], directions: ['Simmer'],
  notes: 'Family recipe', categoryId: 'dinner', category: 'Dinner', favorite: true,
  image: '/api/recipes/artwork/recipe-one.png?v=1', quickSteps: [{ text: 'Wait', timerSeconds: 30 }] };

test('Legacy recipes, categories and artwork survive completely new appdata', t => {
  const { root, dataDir, libraryDir, store } = fixture(t);
  fs.writeFileSync(path.join(dataDir, 'recipes.json'), JSON.stringify({ recipes: [recipe] }));
  fs.writeFileSync(path.join(dataDir, 'recipe-categories.json'), JSON.stringify({ users: { owner: [{ id: 'dinner', name: 'Dinner' }] } }));
  fs.mkdirSync(path.join(dataDir, 'recipe-artwork'));
  fs.writeFileSync(path.join(dataDir, 'recipe-artwork/recipe-one.png'), 'artwork-bytes');
  assert.deepEqual(store.read().recipes, [recipe]);
  const restored = createRecipeLibrary({ dataDir: path.join(root, 'new-appdata'), libraryDir });
  assert.deepEqual(restored.read().recipes, [recipe]);
  assert.equal(restored.read().users.owner[0].name, 'Dinner');
  assert.equal(fs.readFileSync(path.join(restored.artworkRoot, 'recipe-one.png'), 'utf8'), 'artwork-bytes');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'recipes.json'))).recipes.length, 1);
});

test('Corrupt legacy data blocks migration and never becomes an empty library', t => {
  const { dataDir, store } = fixture(t);
  fs.writeFileSync(path.join(dataDir, 'recipes.json'), '{broken');
  assert.throws(() => store.read());
  assert.equal(fs.existsSync(store.metadataPath), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'recipes.json'), 'utf8'), '{broken');
});

test('Interrupted metadata write recovers previous snapshot and retains damaged file', t => {
  const { store, libraryDir } = fixture(t);
  store.update(s => ({ ...s, recipes: [recipe] }));
  store.update(s => ({ ...s, recipes: [...s.recipes, { id: 'recipe-two', title: 'Bread' }] }));
  fs.writeFileSync(store.metadataPath, '{truncated');
  assert.deepEqual(store.read().recipes, [recipe]);
  assert.equal(store.status().recoveredFromBackup, true);
  assert.equal(fs.readdirSync(libraryDir).filter(n => n.includes('.damaged-')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(store.metadataPath)).recipes[0].title, 'Soup');
});

test('Missing primary restores backup; corrupt primary and backup block all saves', t => {
  const { store } = fixture(t);
  store.update(s => ({ ...s, recipes: [recipe] }));
  store.update(s => s);
  fs.unlinkSync(store.metadataPath);
  assert.deepEqual(store.read().recipes, [recipe]);
  fs.writeFileSync(store.metadataPath, 'bad');
  fs.writeFileSync(`${store.metadataPath}.bak`, 'bad-backup');
  assert.throws(() => store.update(s => ({ ...s, recipes: [] })), /left in place/);
  assert.equal(fs.readFileSync(store.metadataPath, 'utf8'), 'bad');
});

test('Fresh reads during overlapping imports retain both saves across restart', async t => {
  const { store, dataDir, libraryDir } = fixture(t);
  const save = async (id) => {
    store.read(); // The route may wait for image download after its initial read.
    await Promise.resolve();
    store.update(s => { s.recipes.push({ id, title: id }); return s; });
  };
  await Promise.all([save('recipe-a'), save('recipe-b')]);
  assert.equal(createRecipeLibrary({ dataDir, libraryDir }).read().recipes.length, 2);
});

test('No 5000-recipe truncation and failed validation preserves committed files', t => {
  const { store } = fixture(t);
  store.update(s => ({ ...s, recipes: Array.from({ length: 5001 }, (_, i) => ({ id: `recipe-${i}`, title: `${i}` })) }));
  const before = fs.readFileSync(store.metadataPath, 'utf8');
  assert.equal(store.read().recipes.length, 5001);
  assert.throws(() => store.update(s => ({ ...s, recipes: [recipe, recipe] })));
  assert.equal(fs.readFileSync(store.metadataPath, 'utf8'), before);
});

test('Missing configured folder fails visibly instead of writing inside container', t => {
  const { dataDir, libraryDir } = fixture(t);
  const store = createRecipeLibrary({ dataDir, libraryDir: path.join(libraryDir, 'not-mounted') });
  assert.throws(() => store.read(), /folder is unavailable/);
  assert.equal(fs.existsSync(store.metadataPath), false);
});

test('Failed atomic replace leaves the committed file readable and cleans temporary files', t => {
  const { store, libraryDir } = fixture(t);
  store.update(s => ({ ...s, recipes: [recipe] }));
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === store.metadataPath) throw new Error('disk write failed'); return rename(from, to); };
  try {
    assert.throws(() => store.update(s => ({ ...s, recipes: [] })), /disk write failed/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(store.read().recipes, [recipe]);
  assert.equal(fs.readdirSync(libraryDir).some(n => n.endsWith('.tmp')), false);
});

test('Older Homestead never overwrites a newer metadata schema with its backup', t => {
  const { store } = fixture(t);
  const snapshot = store.read();
  fs.writeFileSync(store.metadataPath, JSON.stringify({ ...snapshot, version: 2 }));
  assert.throws(() => store.read(), /newer Homestead/);
  assert.equal(JSON.parse(fs.readFileSync(store.metadataPath)).version, 2);
});

test('Adding separate storage after an upgrade carries over newer default-folder saves', t => {
  const { dataDir, libraryDir } = fixture(t);
  fs.writeFileSync(path.join(dataDir, 'recipes.json'), JSON.stringify({ recipes: [] }));
  const fallback = createRecipeLibrary({ dataDir });
  fallback.update(s => ({ ...s, recipes: [recipe] }));
  fs.writeFileSync(path.join(fallback.artworkRoot, 'recipe-one.png'), 'new-artwork');
  const separate = createRecipeLibrary({ dataDir, libraryDir });
  assert.deepEqual(separate.read().recipes, [recipe]);
  assert.equal(fs.readFileSync(path.join(separate.artworkRoot, 'recipe-one.png'), 'utf8'), 'new-artwork');
});
