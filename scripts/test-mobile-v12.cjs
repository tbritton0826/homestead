const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createRecipeLibrary } = require('../src/server/recipe-library.cjs');
const { recipeEditable, recipeEditSupplement } = require('../src/server/recipe-edit.cjs');
const load = file => import(pathToFileURL(path.join(__dirname, '..', file)).href);
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');

test('Mobile profile pills follow data, preserve formatting and include icons only for available fields', async () => {
  const { profileMetadataPills } = await load('src/utils/mobile-polish.js');
  const profile = { library: 'personal', metadata: { biography: 'Biography', pantySize: 'XS/S', birthday: '1989-04-03', everydayCut: 'Thong', seamless: true, periodCut: 'Cheeky', bodyDetails: { braSize: '34B' } } };
  const pills = profileMetadataPills(profile, { allowIntimate: true, formatBirthday: () => 'Apr 3, 1989' });
  assert.deepEqual(pills.map(pill => pill.text), ['Bio', 'XS/S', '34B', 'Apr 3, 1989', 'Thong / Seamless', 'Cheeky']);
  assert(pills.every(pill => pill.icon && pill.label));
  assert.deepEqual(profileMetadataPills({ library: 'personal', metadata: {} }), []);
});
test('Pills never expose intimate fields on children or in unauthorized contexts', async () => {
  const { profileMetadataPills } = await load('src/utils/mobile-polish.js');
  const metadata = { braSize: '34B', pantySize: 'S', periodCut: 'Cheeky', clothingSize: 'S', birthday: '2015-04-03' };
  for (const profile of [{ library: 'children', metadata }, { library: 'personal', metadata }, { library: 'personal', metadata: { ...metadata, birthday: '1989-04-03', role: 'child', profileType: 'adult' } }]) {
    assert.equal(profileMetadataPills(profile, { allowIntimate: true }).some(pill => pill.intimate), false);
  }
  assert.equal(profileMetadataPills({ library: 'personal', metadata: { ...metadata, birthday: '1989-04-03' } }).some(pill => pill.intimate), false);
});
test('Recipe editor populates the existing recipe without converting its type or resetting saved attributes', async () => {
  const { recipeEditorDraft, recipeEditingAllowed } = await load('src/utils/mobile-polish.js');
  const recipe = { id: 'recipe-one', title: 'Soup', ingredients: ['Water', 'Salt'], directions: ['Boil'], tags: ['family'], image: '/api/recipes/artwork/recipe-one.png', favorite: true, householdVisible: false, sourceUrl: 'https://example.com/soup', totalTime: '15 min' };
  const draft = recipeEditorDraft(recipe);
  assert.equal(draft.ingredients, 'Water\nSalt'); assert.equal(draft.tags, 'family');
  assert.equal(draft.image, recipe.image); assert.equal(draft.imageUrl, '');
  assert.equal(draft.favorite, true); assert.equal(draft.householdVisible, false);
  assert.equal(draft.totalTime, '15 min'); assert.equal(draft.sourceUrl, recipe.sourceUrl);
  const config = { subscription: { features: { recipes: true } } };
  assert.equal(recipeEditingAllowed({ role: 'owner' }, config), true);
  assert.equal(recipeEditingAllowed({ role: 'adult', allowedLibraries: ['movies'] }, config), false);
  assert.equal(recipeEditingAllowed({ role: 'owner', readOnly: true }, config), false);
});
function routeFixture(t, record = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-mobile-v12-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createRecipeLibrary({ dataDir: root });
  const recipe = { id: 'recipe-one', title: 'Soup', entryType: 'recipe', categoryId: 'dinner', category: 'Dinner', tags: ['family'], ingredients: ['Water'], directions: ['Boil'], favorite: true, householdVisible: false, image: '/api/recipes/artwork/recipe-one.png', updatedAt: 'original', ...record };
  store.update(snapshot => ({ ...snapshot, recipes: [recipe] }));
  const server = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8');
  const start = server.indexOf('app.patch("/api/recipes/:recipeId"');
  const end = server.indexOf('app.get("/api/recipes/artwork/', start);
  let handler;
  const context = {
    app: { patch: (route, auth, callback) => { handler = callback; } }, homesteadAccess: { requireSession() {} },
    readRecipes: () => store.read().recipes, recipeLibrary: store,
    recipeEditable, recipeEditSupplement,
    recipeCategoriesForRequest: () => [{ id: 'lunch', name: 'Lunch' }],
    cleanRecipeValue: (value, limit) => String(value ?? '').trim().slice(0, limit),
    cleanRecipeLines: (value, max = 240) => (Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/)).map(String).map(line => line.trim()).filter(Boolean).slice(0, max),
    saveRecipeArtwork: async () => { throw Error('Existing artwork must not be downloaded again'); },
    Date, Object, String, Number, Math, Array,
  };
  vm.runInNewContext(server.slice(start, end), context);
  const save = async (body, user = { role: 'owner' }) => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
    await handler({ params: { recipeId: recipe.id }, body, homesteadAccess: { user } }, response);
    return response;
  };
  return { store, root, recipe, save };
}
test('Existing PATCH route persists full recipe edits and restores detail data after reopening storage', async t => {
  const { recipeEditorDraft } = await load('src/utils/mobile-polish.js');
  const f = routeFixture(t);
  const draft = recipeEditorDraft(f.recipe);
  const response = await f.save({ ...draft, title: 'Updated Soup', categoryId: 'lunch', tags: ['family', '#lunch'], sourceUrl: 'https://example.com/soup', totalTime: '15 min', ingredients: ['Water', 'Salt'], directions: ['Boil', 'Serve'] });
  assert.equal(response.code, 200);
  const saved = createRecipeLibrary({ dataDir: f.root }).read().recipes[0];
  assert.equal(saved.title, 'Updated Soup'); assert.equal(saved.category, 'Lunch');
  assert.deepEqual(saved.tags, ['family', 'lunch']); assert.equal(saved.favorite, true);
  assert.equal(saved.householdVisible, false); assert.equal(saved.image, f.recipe.image);
  assert.equal(saved.totalTime, '15 min'); assert.equal(saved.sourceUrl, 'https://example.com/soup');
});
test('Unauthorized/read-only edits and invalid categories leave persisted recipes unchanged', async t => {
  const f = routeFixture(t);
  assert.equal((await f.save({ title: 'Changed' }, { role: 'adult', allowedLibraries: ['movies'] })).code, 403);
  assert.equal((await f.save({ title: 'Changed' }, { role: 'owner', readOnly: true })).code, 403);
  assert.equal((await f.save({ title: 'Changed', categoryId: 'unknown' })).code, 400);
  assert.equal(f.store.read().recipes[0].title, 'Soup');
  assert.equal(recipeEditable({ readOnly: true }, { role: 'owner' }), false);
  assert.equal(recipeEditable({ canEdit: false }, { role: 'owner' }), false);
});
test('Existing foreign category IDs are preserved when not changed, and favorite-only PATCH stays narrow', async t => {
  const f = routeFixture(t);
  assert.equal((await f.save({ ...f.recipe, title: 'Updated' })).code, 200);
  assert.equal(f.store.read().recipes[0].categoryId, 'dinner');
  assert.equal((await f.save({ favorite: false })).code, 200);
  assert.equal(f.store.read().recipes[0].title, 'Updated');
  assert.equal(f.store.read().recipes[0].favorite, false);
});
test('TV background preview uses the existing tokens and preserves explicit zero opacity and blur', async () => {
  const { appearanceNumericVariables } = await load('src/utils/appearance-preview.js');
  const variables = appearanceNumericVariables({ backgroundImage: '/fixture.svg', backgroundOpacity: 0, backgroundBlur: 0, backgroundPosition: 'top', backgroundFit: 'contain', detailPanelOpacity: 0, detailPosterWidth: 240 });
  assert.equal(variables['--tv-detail-background-opacity'], 0);
  assert.equal(variables['--tv-detail-background-blur'], '0px');
  assert.equal(variables['--tv-detail-background-fit'], 'contain');
  assert.equal(variables['--tv-detail-panel-opacity'], 0);
  assert.equal(variables['--tv-detail-poster-width'], '240px');
  assert.equal(appearanceNumericVariables({})['--tv-detail-background-opacity'], 1, 'Default TV banner remains unchanged');
});
test('TV page/device scope overrides persist without mutating the inherited library settings', async () => {
  const { appearanceScope, withScopedAppearanceOverrides, getScopedAppearanceOverrides } = await load('src/utils/appearance-state.js');
  const original = { libraries: { tv: { backgroundImage: '/library.jpg', backgroundOpacity: .4 } }, pages: {}, devices: {} };
  const scope = appearanceScope('tv', 'tv:one', 'page');
  const next = withScopedAppearanceOverrides(original, scope, { backgroundImage: '/item.jpg', detailPanelOpacity: 0, detailPosterWidth: 240 }, 'phone');
  const refreshed = JSON.parse(JSON.stringify(next));
  assert.equal(refreshed.libraries.tv.backgroundImage, '/library.jpg');
  assert.equal(getScopedAppearanceOverrides(refreshed, scope, 'phone').detailPosterWidth, 240);
  assert.equal(getScopedAppearanceOverrides(refreshed, scope, 'desktop').detailPosterWidth, undefined);
  assert.equal(getScopedAppearanceOverrides(refreshed, scope, 'desktop').detailPanelOpacity, 0);
  assert.match(source, /tvLibraryAppearance=\{mediaLibraryAppearance\}/);
  assert.match(source, /tvLibraryAppearance\?\.backgroundImage \|\| displayShow.banner/);
});
