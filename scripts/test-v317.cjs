const { test } = require('node:test');
const assert = require('node:assert/strict');
const folders = () => import('../src/utils/media-folder-tabs.js');

test('Detected folders retain names, nesting, root files and sibling boundaries', async () => {
  const { mediaFolders } = await folders();
  const files = ['main.jpg', 'Holiday/one.jpg', 'Holiday/Day 2/two.jpg', 'Holidays/three.mp4'].map(name => ({ path: '/media/photos/Album/' + name }));
  const catalog = mediaFolders(files, { rootHint: '/media/photos/Album' });
  assert.deepEqual(catalog.tabs.map(tab => tab.id), ['__all__', '', 'Holiday', 'Holiday/Day 2', 'Holidays']);
  assert.equal(catalog.filter('').length, 1);
  assert.equal(catalog.filter('Holiday').length, 2);
  assert.equal(catalog.filter('Holiday/Day 2').length, 1);
  assert.equal(catalog.filter('__all__').length, 4);
});
test('A single populated profile subfolder stays visible and refresh replaces renamed folders', async () => {
  const { mediaFolders } = await folders();
  for (const category of ['photos', 'videos']) {
    const files = [{ path: `/media/personal/fixture/${category}/Old name/one.jpg` }];
    assert.equal(mediaFolders(files, { profileCategory: true }).tabs.at(-1).title, 'Old name');
    files[0] = { path: `/media/personal/fixture/${category}/New name/one.jpg` };
    const refreshed = mediaFolders(files, { profileCategory: true });
    assert.equal(refreshed.tabs.at(-1).title, 'New name');
    assert(!refreshed.tabs.some(tab => tab.id === 'Old name'));
  }
});
test('Authorized raw-file URLs preserve path identity without query revision folders', async () => {
  const { mediaFolders, mediaPath } = await folders();
  const file = { path: '/api/file?path=%2Fmedia%2Fphotos%2FAlbum%2FSet%20A%2Fone.jpg&v=2' };
  assert.equal(mediaPath(file), 'media/photos/Album/Set A/one.jpg');
  const catalog = mediaFolders([file], { rootHint: '/media/photos/Album' });
  assert.equal(catalog.tabs.at(-1).title, 'Set A');
  assert.equal(catalog.filter('Set A').length, 1);
  assert.equal(mediaFolders([]).tabs.length, 0);
});
test('Windows paths and raw-file URLs use the same folder identity', async () => {
  const { mediaFolders } = await folders();
  const values = [{ path: 'C:\\Photos\\Album\\Set A\\one.jpg' }, { path: '/api/file?path=C%3A%5CPhotos%5CAlbum%5CSet%20B%5Ctwo.jpg' }];
  const catalog = mediaFolders(values, { rootHint: 'C:\\Photos\\Album' });
  assert.deepEqual(catalog.tabs.slice(2).map(tab => tab.title), ['Set A', 'Set B']);
  assert.equal(catalog.filter('Set A').length, 1);
});
