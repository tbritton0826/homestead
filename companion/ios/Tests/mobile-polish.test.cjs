const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'Homestead', name), 'utf8').replace(/\r\n/g, '\n');

test('Photo pager explicitly sizes and clips every page and pager to the changing viewport', () => {
  const viewer = source('NativeMediaViewer.swift');
  assert.match(viewer, /GeometryReader \{ viewport in/);
  assert.equal((viewer.match(/frame\(width: viewport.size.width, height: viewport.size.height\)/g) || []).length, 2);
  assert.match(viewer, /\.clipped\(\)\.tag\(file.id\)/);
  assert.doesNotMatch(viewer, /\.ignoresSafeArea\(\)\s*\.overlay/);
  assert.match(viewer, /bounces = false; scroll.bouncesZoom = false/);
  assert.match(viewer, /alwaysBounceHorizontal = false/);
  assert.match(viewer, /zoomScale > 1.01/);
  assert.match(viewer, /PhotoViewportGeometry.fittedSize/);
  assert.match(viewer, /PhotoViewportGeometry.centering/);
  assert.match(viewer, /if !selected \{ scroll.resetToFit\(\) \}/);
  assert.match(viewer, /previousSize = .zero\s+setNeedsLayout/);
  assert.match(viewer, /contentOffset = CGPoint\(x: -contentInset.left, y: -contentInset.top\)/);
});
test('Profile pills keep their capsule/icons while biography expands inline in the header', () => {
  const view = source('AdultMediaViews.swift');
  assert.match(view, /Label\(item.value, systemImage: item.symbol\).homesteadLibraryPill/);
  assert.match(view, /Text\(tab.rawValue\).homesteadLibraryPill/);
  assert.match(view, /NativeProfileHeader\(/);
  assert.doesNotMatch(view, /DisclosureGroup\("About"/);
  assert.match(source('NativeProfileHeader.swift'), /biographyExpanded\.toggle\(\)/);
  assert.match(view, /!adultHidden && currentRecord.allowsIntimateMetadata && !authorizationRevoked/);
  assert.match(source('AdultLibraryView.swift'), /intimateMetadataSections.contains\(selected\)/);
  assert.match(source('ProfileMediaModels.swift'), /let sensitive = allowIntimate && !child/);
});
test('Recipe pencil opens the existing editor and updates details/library/search from the saved response', () => {
  const detail = source('ContentView.swift'), form = source('NativeAddForms.swift');
  assert.match(detail, /ToolbarItem\(placement: .topBarTrailing\)/);
  assert.match(detail, /Image\(systemName: "pencil"\)/);
  assert.match(detail, /NativeRecipeDraft.editing\(currentRecipe\)/);
  assert.match(detail, /savedRecipe = saved; onSaved\?\(saved\); editing = false/);
  assert.match(detail, /RecipeEditAccess.allowed/);
  assert.match(form, /recipe == nil \? "POST" : "PATCH"/);
  assert.match(form, /let result: RecipeMutationResponse/);
  assert.match(form, /interactiveDismissDisabled\(busy\)/);
  assert.match(form, /Button\("Cancel"\).*disabled\(busy\)/);
  assert.match(source('NativeSearchPage.swift'), /search.hits = search.hits.map/);
});
test('Native navigation reserves bottom clearance without duplicate web bars or fixed extra padding', () => {
  const add = source('GlobalAddView.swift');
  assert.match(add, /safeAreaInset\(edge: .bottom/);
  for (const file of ['AdultMediaViews.swift', 'AdultLibraryView.swift', 'CompanionTabs.swift']) assert.doesNotMatch(source(file), /padding\(.bottom, (?:60|70)\)/);
  assert.match(source('GlassTheme.swift'), /\.mobile-bottom-nav, .mobile-menu-button \{ display: none !important; \}/);
  assert.match(source('GlassTheme.swift'), /--homestead-mobile-bottom-clearance: 16px/);
});

test('Photo geometry guard uses plain ASCII comparisons and an explicit zero size', () => {
  const geometry = source('ProfileMediaModels.swift').split('enum PhotoViewportGeometry {')[1];
  assert.ok(geometry);
  assert.match(geometry, /guard image\.width > 0, image\.height > 0, viewport\.width > 0, viewport\.height > 0 else \{\s+return CGSize\(width: 0, height: 0\)/);
  assert.doesNotMatch(geometry, /[^\x00-\x7F]/);
  assert.doesNotMatch(geometry, /\$\$/);
});

test('Viewer background is an explicit Color and playback observer hands off an immutable session', () => {
  const viewer = source('NativeMediaViewer.swift');
  assert.ok(viewer.includes('.background(Color.black.ignoresSafeArea())'));
  assert.ok(!viewer.includes('.background(.black.ignoresSafeArea())'));
  assert.ok(viewer.includes('guard let session = self else { return }'));
  assert.ok(viewer.includes('Task { @MainActor in if session.openGeneration == generation { session.save() } }'));
  assert.ok(!viewer.includes('Task { @MainActor in self?.save() }'));
});
