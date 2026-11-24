const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Default app icon has a bundled opaque 1024-pixel PNG and no empty appearance slots', () => {
  const root = path.join(__dirname, '..');
  const folder = path.join(root, 'Homestead', 'Assets.xcassets', 'AppIcon.appiconset');
  const catalog = JSON.parse(fs.readFileSync(path.join(folder, 'Contents.json'), 'utf8'));
  assert.equal(catalog.images.length, 1);
  for (const image of catalog.images) {
    assert.equal(image.size, '1024x1024');
    assert.equal(image.platform, 'ios');
    assert.ok(image.filename);
    const png = fs.readFileSync(path.join(folder, image.filename));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 1024);
    assert.equal(png[25], 2, 'Default icon must be RGB without an alpha channel');
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset);
      assert.notEqual(png.toString('ascii', offset + 4, offset + 8), 'tRNS');
      offset += size + 12;
    }
  }
  const project = fs.readFileSync(path.join(root, 'Homestead.xcodeproj', 'project.pbxproj'), 'utf8');
  assert.equal((project.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g) || []).length, 2);
});
