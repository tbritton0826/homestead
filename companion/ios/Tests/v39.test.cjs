const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', 'Homestead', file), 'utf8');

test('Inventory is reachable natively from More and Add without depending on the plugins entitlement', () => {
  const more = source('MoreLibrariesView.swift');
  assert.match(more, /NativeInventoryPage\(client: client\)/);
  assert(more.indexOf('inventoryVisible = InventoryCatalog.visible') < more.indexOf('guard config["subscription"]?["features"]?["plugins"]'));
  const add = source('GlobalAddView.swift');
  assert.match(add, /Add Inventory item or Yu-Gi-Oh! card/);
  assert.match(add, /NativeInventoryWizard\(client: client\)/);
  assert.doesNotMatch(source('NativeInventoryViews.swift') + source('NativeInventoryWizard.swift'), /WKWebView|PluginBrowser|AsyncImage/);
});

test('Inventory uses shared authenticated APIs and separately addresses physical card printings', () => {
  const views = source('NativeInventoryViews.swift'), wizard = source('NativeInventoryWizard.swift');
  for (const token of ['api/inventory/native', 'canEdit', '.searchable', '.refreshable', 'InventorySection.allCases', 'homesteadInventoryChanged']) assert(views.includes(token), token);
  assert.match(views, /\/printings\//);
  assert.match(wizard, /api\/inventory\/native\/lookup/);
  assert.match(wizard, /api\/inventory\/native\/cards/);
  assert.match(wizard, /InventoryCardSearch\.queryItems/);
  assert.match(wizard, /draft\.applyCard\(match\)/);
  assert.match(wizard, /api\/inventory\/native\/recognize/);
  assert.match(wizard, /PhotosPicker\(selection: \$recognitionPhoto/);
  assert.match(wizard, /Button\("Save item"\)/);
});

test('wizard drafts survive step navigation and interrupted writes stay account-scoped and are not replayed', () => {
  const wizard = source('NativeInventoryWizard.swift');
  assert.match(wizard, /@State private var draft = NativeInventoryDraft/);
  assert.match(wizard, /AppearancePreferences\.storageKey\(server: client\.baseURL\.absoluteString, user: account\)/);
  assert.match(wizard, /UserDefaults\.standard\.set\(requestID\.uuidString/);
  assert.match(wizard, /if let pending = UserDefaults\.standard\.string/);
  const save = wizard.split('private func save()')[1].split('private func checkStatus()')[0];
  assert.equal((save.match(/method: "POST"/g) || []).length, 1);
  assert.doesNotMatch(save, /for attempt|ReadRetryPolicy/);
  assert.match(wizard, /response\["state"\]\?\.text == "complete"/);
  assert.match(wizard, /Check save status/);
});

test('camera scanner checks hardware and authorization and stops on selection, dismissal and background', () => {
  const camera = source('InventoryBarcodeScanner.swift');
  for (const token of ['AVCaptureDevice.authorizationStatus', 'AVCaptureDevice.requestAccess', 'DataScannerViewController.isSupported', 'DataScannerViewController.isAvailable', 'recognizedDataTypes: [.barcode()]', 'scenePhase == .active', 'dismantleUIViewController', 'scanner.stopScanning()', 'delivered = true']) assert(camera.includes(token), token);
  assert.match(camera, /guard active, !delivered/);
  assert.doesNotMatch(camera, /URLSession|https?:\/\/|method: "POST"/);
  const plist = fs.readFileSync(path.join(__dirname, '../Info.plist'), 'utf8');
  assert.match(plist, /NSCameraUsageDescription/);
});

test('Yu-Gi-Oh uses card-face capture and the same bounded recognition path as a chosen photo', () => {
  const wizard = source('NativeInventoryWizard.swift'), camera = source('InventoryCardCamera.swift');
  assert.match(wizard, /if !draft\.card \{ barcodeLookup \}/);
  assert.match(wizard, /Scan card with camera/);
  assert.match(wizard, /fullScreenCover\(isPresented: \$showCardCamera, onDismiss:/);
  assert.match(wizard, /InventoryCardCamera \{ data in capturedCardData = data; showCardCamera = false \}/);
  assert.match(wizard, /await recognizeCardData\(data\)/);
  assert.match(wizard, /NativeImageDecoder\.thumbnail\(data, maximumPixelSize: 2200\)/);
  assert.match(wizard, /jpeg\.count <= 2 \* 1024 \* 1024/);
  assert.match(camera, /AVCaptureDevice\.requestAccess/);
  assert.match(camera, /UIImagePickerController\.isSourceTypeAvailable\(\.camera\)/);
  assert.match(camera, /picker\.sourceType = \.camera/);
  assert.match(camera, /picker\.cameraCaptureMode = \.photo/);
  assert.match(camera, /info\[\.originalImage\]/);
  assert.match(camera, /guard !finished/);
  assert.match(camera, /controller\.delegate = nil/);
  assert.match(camera, /phase == \.background \{ dismiss\(\) \}/);
  assert.doesNotMatch(camera, /DataScanner|URLSession|method: "POST"/);
  assert.match(fs.readFileSync(path.join(__dirname, '../Package.swift'), 'utf8'), /"InventoryCardCamera.swift"/);
});

test('new Inventory files are in the automatic Xcode source group and portable model test target', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '../Package.swift'), 'utf8');
  assert.match(manifest, /sources: \["InventoryModels.swift"/);
  for (const file of ['NativeInventoryViews.swift', 'NativeInventoryWizard.swift', 'InventoryBarcodeScanner.swift']) assert(manifest.includes('"' + file + '"'));
  const project = fs.readFileSync(path.join(__dirname, '../Homestead.xcodeproj/project.pbxproj'), 'utf8');
  assert.equal((project.match(/MARKETING_VERSION = 3\.21;/g) || []).length, 2);
  assert.equal((project.match(/CURRENT_PROJECT_VERSION = 22;/g) || []).length, 2);
  assert.doesNotMatch(source('InventoryModels.swift'), /case \.null:/, 'IndexValue uses .other for JSON null');
});
