const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'Homestead', name), 'utf8');

test('UI catch handlers never assign to the implicit immutable error variable', () => {
  const shadowedAssignment = /\bcatch\s*\{[^}]*?(?<![.\w])error\s*=(?!=)/;
  assert.match('catch { if !Task.isCancelled { error = error.localizedDescription } }', shadowedAssignment);
  assert.doesNotMatch('catch { self.error = error.localizedDescription }', shadowedAssignment);
  const directory = path.join(__dirname, '..', 'Homestead');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.swift'))) {
    assert.doesNotMatch(source(file), shadowedAssignment, file);
  }
});

const swift = spawnSync('swiftc', ['--version'], { encoding: 'utf8', timeout: 30000 });
test('All app Swift sources pass the Swift compiler syntax parser', {
  skip: swift.error?.code === 'ENOENT' ? 'Swift compiler unavailable; run this check on the Mac before building' : false,
}, () => {
  assert.equal(swift.status, 0, swift.error?.message || swift.stderr);
  const directory = path.join(__dirname, '..', 'Homestead');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.swift')).map(name => path.join(directory, name));
  const result = spawnSync('swiftc', ['-frontend', '-parse', ...files], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});

test('Family and the installed AI plugin never open embedded app pages', () => {
  for (const file of ['FamilyLibraryView.swift', 'MoreLibrariesView.swift', 'NativeAIView.swift', 'NativeSearchPage.swift']) {
    assert.doesNotMatch(source(file), /WKWebView|FamilyWebPage|FamilyBrowser|PluginBrowser\(|PluginSurface\(/);
  }
  assert.match(source('FamilyLibraryView.swift'), /NativeFamilyPage\(/);
  assert.match(source('MoreLibrariesView.swift'), /NativeAIView\(plugin: plugin, client: client\)/);
});
test('Native search keeps poster/status groups and rich request detail APIs', () => {
  assert.match(source('NativeSearchPage.swift'), /SearchPresentation\.groups\(search\.hits\)/);
  const view = source('NativeSearchDetails.swift');
  for (const token of ['NativeArtwork(path: hit.posterPath', 'Discover', 'detail["cast"]', 'detail["genres"]', 'detail["ratings"]', '/details']) {
    assert.ok((view + source('SearchPresentation.swift')).includes(token), token);
  }
  assert.match(source('MediaRequestViews.swift'), /NativeSearchDetails\(hit: SearchPresentation\.requestHit/);
  assert.match(source('MediaRequestViews.swift'), /lifecycle\["progress"\]/);
});
test('Book actions stay above the synopsis and work links come from the existing server API', () => {
  const detail = source('CompanionTabs.swift').split('struct MediaDetails: View')[1];
  assert.ok(detail.indexOf('BookDetailActions') < detail.indexOf('Text(item.overview)'));
  assert.match(source('HomesteadClient.swift'), /api\/books\/edition-links/);
  assert.match(source('MediaModels.swift'), /BookWorkCatalog\.merge\(result\)/);
  assert.match(source('MediaModels.swift'), /case \.books: return \["books", "audiobooks"\]/);
});
test('Native AI sends approvals only after explicit review and uses account-authenticated plugin APIs', () => {
  const view = source('NativeAIView.swift');
  assert.match(view, /confirmationDialog\("Execute the reviewed Homestead actions/);
  assert.match(view, /Button\("Approve & execute"\) \{ Task \{ await decide\(true\)/);
  assert.match(view, /guard !busy, pending == nil, !concealed/);
  assert.match(view, /client\.request\(AIContract\.root \+ suffix/);
  assert.doesNotMatch(view, /service\.url.*request|\/v1\/turn/);
  assert.match(view, /SecureField\("Shared secret"/);
  assert.doesNotMatch(view, /UserDefaults.*sharedSecret/);
});
test('Native document downloads are bounded and only owned temporary preview directories are removed', () => {
  const client = source('HomesteadClient.swift'), view = source('NativeDocumentView.swift');
  const download = client.split("func documentFile(")[1].split("func petProfilesIfAvailable")[0];
  assert.match(download, /readDownload\(session: session, request: request, limit: 64 \* 1024 \* 1024\)/);
  assert.doesNotMatch(download, /for try await byte/);
  assert.match(client, /Task\.checkCancellation\(\)/);
  assert.match(view, /hasPrefix\("homestead-document-"\)/);
  assert.match(view, /temporaryDirectory\.standardizedFileURL\.path/);
  assert.match(view, /QLPreviewController\.canPreview/);
});

test('Search restarts when privacy changes and hidden AI dismisses sensitive sheets', () => {
  assert.match(source('NativeSearchPage.swift'), /task\(id: NativeSearchScope\(query: query, adultHidden: adultHidden, hiddenPlugins: hiddenPlugins\)\)/);
  assert.match(source('NativeSearchPage.swift'), /session\["ok"\]\?\.flag == true/);
  const ai = source('NativeAIView.swift');
  assert.match(ai, /showHistory = false; showSettings = false; showFiles = false; approve = false/);
  assert.match(ai, /homesteadControl\(\)\.disabled\(concealed\)/);
  assert.match(ai, /try Task\.checkCancellation\(\)/);
});
