const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'Homestead', name), 'utf8');

test('Book formats remain usable while additional authorized files load, and Listen keeps Read Along opt-in', () => {
  const book = source('NativeBookReader.swift');
  assert.match(book, /files \+ additionalFiles/);
  assert.match(book, /api\/books\/local-files/);
  assert.match(book, /readAlong = false; listening = first/);
  assert.match(book, /readAlong = true; listening = first/);
  assert.match(book, /BookWorkCatalog\.orderedAudio\(availableFiles\)/);
  assert.match(book, /if bookID != nil && !checkingFormats \{\s*Button\("Check formats again"\)/,
    'an empty successful format lookup must still allow a refresh after a server update or rescan');
  assert.match(source('CompanionTabs.swift'), /bookID: item\.id/);
  assert.match(source('NativeSearchDetails.swift'), /bookID: hit\.id/);
});
test('Native profile header uses inline expandable biography and authenticated muted video without playback-history writes', () => {
  const header = source('NativeProfileHeader.swift'), profile = source('AdultMediaViews.swift');
  assert.match(header, /biographyExpanded\.toggle\(\)/);
  assert.match(header, /lineLimit\(biographyExpanded \? nil : 3\)/);
  assert.match(header, /AVURLAssetHTTPCookiesKey: client\.familySessionCookies/);
  assert.match(header, /queue\.isMuted = true/);
  assert.match(header, /asset\?\.cancelLoading\(\)/);
  assert.match(header, /ImageLoadKey\(path: active \? path : nil/);
  assert.match(profile, /active: profileActive && viewing == nil && !showMediaPicker && tool == nil/);
  assert.doesNotMatch(header, /PlaybackSession|api\/account\/playback|WKWebView/);
  assert.doesNotMatch(profile, /DisclosureGroup\("About"/);
  assert.match(profile, /ToolbarItem\(placement: \.topBarTrailing\)/);
  assert.match(profile, /if canEdit \{ Button\("Edit Profile"/);
  assert.match(source('AdultLibraryView.swift'), /ProfileDetailRecord\.applyingToIndex/);
});
test('Profile appearance uses the explicit Section header and footer initializer', () => {
  const appearance = source('NativeProfileTools.swift').split('struct NativeProfileEditor:')[0];
  assert.match(appearance, /Section \{/);
  assert.match(appearance, /\} header: \{\s*Text\("Profile poster"\)\s*\} footer: \{/);
  assert.doesNotMatch(appearance, /Section\("Profile poster"\)/);
});
test('Biography files are separate from About text and downloaded through bounded authenticated transport', () => {
  const presentation = source('ProfileMediaModels.swift');
  assert.match(presentation, /\["biography", "description", "overview", "summary", "about", "bio"\]/);
  assert.match(presentation, /static func biographyFile/);
  const client = source('HomesteadClient.swift').split('func profileBiography(')[1].split('func documentFile(')[0];
  assert.match(client, /ProfileMediaFile\.url\(path: path, server: baseURL, preview: false\)/);
  assert.match(client, /readDownload\(session: session, request: request, limit: 1024 \* 1024\)/);
  assert.match(client, /stamp == authGeneration/);
  assert.match(client, /try validate\(response, data: data\)/);
  assert.match(client, /\["text\/plain", "text\/markdown", "text\/x-markdown", "application\/octet-stream"\]\.contains/);
  assert.match(source('AdultMediaViews.swift'), /client\.profileBiography\(path\)/);
});
test('Media loading never covers independent tabs, usable data, or a connection failure card', () => {
  const tabs = source('CompanionTabs.swift');
  assert.match(tabs, /MediaLoadingPresentation\.showsOverlay\(tab: tab, busy: model\.mediaBusy, loaded: model\.mediaLoaded,/);
  assert.match(tabs, /connectionFailed: model\.connectionError != nil/);
  assert.match(tabs, /model\.checkingSession \? "Checking your Homestead connection…" : message/);
  assert.match(tabs, /\.disabled\(model\.checkingSession\)/);
  assert.match(source('ConnectionModels.swift'), /\(tab == 0 \|\| tab == 1\) && busy && !loaded && !connectionFailed/);
});
test('Profile edits recheck access and send changed metadata only through the existing explicit save API', () => {
  const editor = source('NativeProfileTools.swift');
  assert.match(editor, /allowed = false; bodyAllowed = false/);
  assert.match(editor, /await checkAccess\(\)[\s\S]*guard allowed, !Task\.isCancelled/);
  assert.match(editor, /draft\.patch\(includeBody: includeBody && bodyAllowed\)/);
  assert.match(editor, /api\/metadata\/adult\/edit", method: "POST"/);
  assert.match(editor, /interactiveDismissDisabled\(busy\)/);
});
test('Custom destinations use their own server endpoint and confirmed responses, with no silent legacy fallback', () => {
  const client = source('HomesteadClient.swift');
  const upload = client.split('func uploadProfileMedia(')[1].split('func artwork(')[0];
  assert.match(upload, /destinationFolder\.isEmpty \? "api\/adult\/import-upload" : "api\/adult\/profile-media-upload"/);
  assert.match(upload, /result\["destinationFolder"\]\?\.text != destinationFolder/);
  assert.doesNotMatch(upload, /ReadRetryPolicy|for attempt|fallback/);
  assert.match(source('ProfileUploadModels.swift'), /try ProfileFolderPath\.validate\(destinationFolder\)/);
  assert.match(source('NativeProfileFolders.swift'), /response\.version == 1/);
  assert.match(source('ProfileMediaPicker.swift'), /destinationFolder: item\.video \? "" : photoFolder/);
});
