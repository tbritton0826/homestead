const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../Homestead/PluginHost.js'), 'utf8');
function host(native = false) {
  const sent = [], requests = [], listeners = {};
  const frame = { dataset: { plugin: 'panty-archive' }, contentWindow: { postMessage: m => sent.push(m) }, addEventListener() {} };
  const location = { origin: 'https://homestead.test' };
  const window = { location, addEventListener: (name, fn) => listeners[name] = fn };
  if (native) { window.__homesteadNativePlugin = 'panty-archive'; window.postMessage = m => sent.push(m); }
  vm.runInNewContext(source, { document: { getElementById: () => frame }, window, location, URL, AbortSignal,
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return { status: 200, ok: true, text: async () => '{"ok":true}' }; } });
  const send = (path, source = native ? window : frame.contentWindow) => listeners.message({ source, data: { type: 'homestead:plugin-api-request', pluginId: 'panty-archive', requestId: '1', path } });
  return { sent, requests, send, window };
}
test('routes plugin commands and authenticated API calls to the selected plugin', async () => {
  const h = host();
  h.window.sendPluginCommand({ command: 'add-item', section: 'archive' });
  assert.equal(h.sent[0].command.command, 'add-item');
  await h.send('/items');
  assert.equal(h.requests[0].url, 'https://homestead.test/api/plugins/panty-archive/items');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
});
test('direct native plugin mode handles the same commands and API without an iframe', async () => {
  const h = host(true);
  h.window.sendPluginCommand({ command: 'add-item', section: 'archive' });
  assert.equal(h.sent[0].type, 'homestead:plugin-command');
  await h.send('/items');
  assert.equal(h.requests[0].url, 'https://homestead.test/api/plugins/panty-archive/items');
  assert.equal(h.sent[1].type, 'homestead:plugin-api-response');
});
test('rejects namespace traversal and messages from other frames', async () => {
  const h = host();
  for (const path of ['/../auth', '/%2e%2e/auth', '/%2e%2e%2fauth', '/bad\\path']) await h.send(path);
  await h.send('/items', {});
  assert.equal(h.requests.length, 0);
  assert.equal(h.sent.length, 4);
  assert.ok(h.sent.every(m => m.status === 400));
});
