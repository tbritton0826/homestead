const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { registerAccountPlayback } = require('../src/server/account-playback.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'homestead-playback-test-'));
try {
  const routes = {};
  const app = { get: (url, handler) => routes.get = handler, put: (url, handler) => routes.put = handler };
  registerAccountPlayback({ app, directory, currentUser: req => req.user });
  const call = (method, user, body = {}) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, setHeader() {}, json(value) { this.body = value; return this; } };
    routes[method]({ user, body }, res); return res;
  };
  const a = { id: 'account-a' }, b = { id: 'account-b' };
  const id = crypto.createHash('sha256').update('/example/video.mp4').digest('hex');
  assert.equal(call('get', null).code, 401);
  assert.equal(call('put', null, { id, position: 1, duration: 100 }).code, 401);
  assert.equal(call('put', a, { id, position: 20, duration: 100, userId: b.id }).code, 200);
  assert.equal(call('get', a).body.entries[id].position, 20);
  assert.deepEqual(call('get', b).body.entries, {});
  for (const bad of [-1, NaN, Infinity, '20']) assert.equal(call('put', a, { id, position: bad, duration: 100 }).code, 400);
  assert.equal(call('put', a, { id: '../escape', position: 1, duration: 100 }).code, 400);
  assert.equal(call('put', a, { id, position: 150, duration: 100 }).body.entry.position, 100);
  assert.equal(call('get', a).body.entries[id].completed, true);
  // Reload the handlers to prove on-disk persistence.
  registerAccountPlayback({ app, directory, currentUser: req => req.user });
  assert.equal(call('get', a).body.entries[id].position, 100);
  assert.deepEqual(call('get', b).body.entries, {});
  for (let i = 0; i < 502; i++) call('put', b, { id: crypto.createHash('sha256').update(String(i)).digest('hex'), position: 10, duration: 100 });
  assert.equal(Object.keys(call('get', b).body.entries).length, 500);
  console.log('Account playback: authentication, isolation, validation, completion, persistence and bounds passed.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
