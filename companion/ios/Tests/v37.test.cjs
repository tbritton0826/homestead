const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', 'Homestead', file), 'utf8');
test('native pets reuse the media queue with dedicated Family APIs, folder selection and stable creation/upload identities', () => {
  const view = source('NativePetViews.swift'), queue = source('ProfileMediaPicker.swift');
  assert.match(source('FamilyLibraryView.swift'), /NativePetsPage\(client: client\)/);
  for (const token of ['ProfileMediaQueue()', 'Create pet and continue', 'ProfileFolderPath.child', 'preferredItemEncoding: .current', 'requestID: creationID', 'destinationLocked = true']) assert.ok(view.includes(token), token);
  assert.match(view, /PetCatalog\.Folders/);
  assert.match(queue, /for index in items\.indices where !items\[index\]\.uploaded/);
  assert.match(queue, /requestID: item\.id/);
  const upload = source('HomesteadClient.swift').split('func uploadPetMedia(')[1].split('func generatedImage(')[0];
  assert.doesNotMatch(upload, /for attempt|ReadRetryPolicy/);
  assert.match(upload, /receipt\["requestId"\]\?\.text == requestID\.uuidString/);
  assert.doesNotMatch(view + source('PetModels.swift'), /braSize|pantySize|nudes|keepsakes|WKWebView/);
});
test('older servers retain read-only pet browsing while access failures do not use fallback data', () => {
  const client = source('HomesteadClient.swift').split('func petProfilesIfAvailable(')[1].split('func uploadPetMedia(')[0];
  assert.match(client, /statusCode == 404 \{ return nil \}/);
  assert.match(client, /try validate\(response, data: data\)/);
  assert.match(source('NativePetViews.swift'), /records = FamilyCatalog\.records\(index, library: "pets"\); canEdit = false/);
});
test('ComfyUI is a separate native mode using the authenticated server gateway and explicit workflow setup', () => {
  assert.match(source('NativeAIView.swift'), /NativeComfyView\(client: client\)/);
  const view = source('NativeComfyView.swift');
  for (const token of ['api/ai/comfy', 'Save and test connection', 'promptNode', 'JSONSerialization.jsonObject', 'scenePhase == .active', 'jobID + ":" + state', 'Check the ComfyUI queue', 'AppearancePreferences.storageKey']) assert.ok(view.includes(token), token);
  assert.doesNotMatch(view, /WKWebView|URLSession|http:\/\/10\./);
  assert.match(source('HomesteadClient.swift'), /func generatedImage[\s\S]*limit: 16 \* 1024 \* 1024/);
});
test('chat discovery failures do not skip history/config loading and provider warnings stay visible', () => {
  const view = source('NativeAIView.swift');
  assert.match(view, /do \{ catalog = try await request\("\/models"\) \}/);
  assert.match(view, /failures\.append\("Models: "/);
  assert.match(view, /failures\.append\("History: "/);
  assert.match(view, /failures\.append\("Configuration: "/);
  assert.match(view, /catalog\["warnings"\]/);
});
