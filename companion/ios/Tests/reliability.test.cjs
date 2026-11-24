const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'Homestead', name), 'utf8');

// Wiring guards complement the executable Swift model/concurrency/image tests.
// These checks do not compile or run the native application.
test('Saved connection restores on launch and rechecks on foreground/network recovery', () => {
  const model = source('CompanionModel.swift'), view = source('ContentView.swift');
  assert.match(model, /screen = saved == nil \? \.server : \.connecting/);
  assert.match(view, /\.task \{ await model\.restoreConnection\(\) \}/);
  assert.match(view, /phase == \.active.*model\.resumeConnection\(\)/);
  assert.match(view, /network\.available.*model\.resumeConnection\(force: true\)/);
  const expired = model.split('private func sessionExpired()')[1].split('var appearance')[0];
  assert.doesNotMatch(expired, /removeObject|disconnect\(/);
  assert.match(expired, /adultPrivacy\.reset\(\); screen = \.login/);
  assert.match(model, /activeUserID != session\.user\?\.id[\s\S]*?await client\.discardAccountData\(\)/);
  assert.match(view, /CompanionTabs\(model: model\)\.id\(model\.accountRevision\)/);
});

test('Persisted credentials stay in device Keychain and uploads never enter read retry loops', () => {
  const store = source('SessionCookieStore.swift'), client = source('HomesteadClient.swift');
  assert.match(store, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(store, /SHA256\.hash/);
  assert.doesNotMatch(store, /defaults\.set\((?:data|records|cookies|password|token)/);
  const upload = client.split('func uploadProfileMedia(')[1].split('func artwork(')[0];
  assert.equal((upload.match(/uploader\.upload\(/g) || []).length, 1);
  assert.doesNotMatch(upload, /ReadRetryPolicy|for attempt/);
  assert.match(upload, /invalidateIndex\(\)/);
});

test('Photo path uses bounded bulk downloads and original picker encoding', () => {
  const client = source('HomesteadClient.swift');
  const photos = client.split('func profileImage(')[1].split('var familySessionCookies')[0];
  assert.match(photos, /imagePool\.load/);
  assert.match(photos, /session\.download\(for: request, delegate: delegate\)/);
  assert.doesNotMatch(photos, /for try await byte/);
  assert.match(source('ProfileMediaPicker.swift'), /preferredItemEncoding: \.current/);
  assert.match(source('AdultMediaViews.swift'), /searchIndex\(force: true\)/);
  assert.match(source('AdultMediaViews.swift'), /Tap to retry/);
});

test('Media library loading uses one root overlay and package includes executable reliability tests', () => {
  const tabs = source('CompanionTabs.swift');
  assert.equal((tabs.match(/MediaLoadingCard\(\)/g) || []).length, 1);
  const inlineStatus = tabs.split('private struct MediaLoadStatus: View')[1].split('private struct MediaLoadingCard')[0];
  assert.doesNotMatch(inlineStatus, /ProgressView/);
  const manifest = fs.readFileSync(path.join(root, 'Package.swift'), 'utf8');
  for (const file of ['ConnectionModels.swift', 'ImageRequestPool.swift', 'NativeImageDecoder.swift']) {
    assert.ok(manifest.includes('"' + file + '"'), file);
  }
  const project = fs.readFileSync(path.join(root, 'Homestead.xcodeproj', 'project.pbxproj'), 'utf8');
  assert.equal((project.match(/MARKETING_VERSION = 3\.21;/g) || []).length, 2);
  assert.ok(fs.existsSync(path.join(root, 'Tests', 'ReliabilityTests.swift')));
});

test('collection details request the saved server order and expose an independent title grid', () => {
  const view = source('SharedCollectionsView.swift');
  assert.match(view, /showingOrder = true/);
  assert.match(view, /Text\("Watch Order"\)\.tag\(true\)/);
  assert.match(view, /Titles \(/);
  assert.match(view, /collection\.serverID/);
  assert.match(view, /client\.request\("api\/collections\/watch-order\/" \+ id\)/);
  assert.match(view, /CollectionWatchOrder\.decode\(response\["order"\], media: media\)/);
  assert.match(view, /Retry watch order/);
  assert.match(view, /No saved watch order/);
  assert.match(view, /Show next 100/);
  assert.match(view, /DisclosureGroup\("Episodes/);
  assert.match(view, /NativeMediaViewer\(initial: file, files: \[file\], client: client\)/);
  assert.doesNotMatch(view, /collection\.items\.enumerated\(\)/, 'the title grid must not masquerade as numbered watch order');
  assert.match(fs.readFileSync(path.join(root, 'Package.swift'), 'utf8'), /"CollectionWatchOrder.swift"/);
  assert.ok(fs.existsSync(path.join(root, 'Tests', 'CollectionWatchOrderTests.swift')));
});
