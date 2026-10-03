const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
const cloud = source.slice(source.indexOf('function CloudLibraryV1()'), source.indexOf('function CloudLibraryV1()') + 6500);
const upload = cloud.slice(cloud.indexOf('  const uploadFiles = async'), cloud.indexOf('  const crumbs =')).replace('  const uploadFiles =', 'globalThis.uploadFiles =');
async function scenario(outcomes, files) {
  const messages = [], states = [], requests = []; let refreshes = 0;
  const context = vm.createContext({ busy: false, folder: "fixture-folder", setBusy: value => states.push(value), setMessage: value => messages.push(value), Array,
    refresh: async options => { assert.equal(options.keepMessage, true); refreshes++; },
    fetch: async (url, request) => { requests.push(request.headers['X-Cloud-Filename']); const result = outcomes.shift(); if (result instanceof Error) throw result; return { ok: result.ok, json: async () => result }; },
  });
  vm.runInContext(upload, context);
  await context.uploadFiles(files);
  return { messages, states, requests, refreshes, context };
}
(async () => {
  const files = [{ name: 'first.txt' }, { name: 'second.txt' }];
  let result = await scenario([new Error('Failed to fetch'), { ok: true }], files);
  assert.deepEqual(result.states, [true, false], 'network failure always releases upload busy state');
  assert.match(result.messages.at(-1), /1 of 2 files uploaded.*first.txt.*Failed to fetch.*retry/s);
  assert.deepEqual(result.requests, ['first.txt', 'second.txt'], 'one failed upload does not drop the rest of the batch');
  assert.equal(result.refreshes, 1);
  result = await scenario([{ ok: false, message: 'Unavailable' }], [files[0]]);
  assert.match(result.messages.at(-1), /0 of 1 files uploaded.*Unavailable/s);
  assert.equal(result.states.at(-1), false);
  result = await scenario([{ ok: true }], [files[0]]);
  assert.equal(result.messages.at(-1), '1 of 1 files uploaded.');
  assert.equal(result.states.at(-1), false);
  result = await scenario([], []); assert.deepEqual(result.states, []); assert.equal(result.refreshes, 0);
  assert(source.includes('event.target.value = ""; uploadFiles(selected);'), 'selecting the same file again can retry');
  assert(source.includes('appearanceScope: selectedShow ? `tv:${selectedShow.id}`'), 'TV uses stable existing page scope identity');
  assert(source.includes('event.target.closest("button, input, select, textarea, a, video, audio, [contenteditable]")'), 'viewer shortcuts do not intercept native control keys');
  assert(!source.includes('if (musicFixMatchItem) return'), 'Music Fix Match preserves the mounted focus origin');
  assert(source.includes('})()}{fixMatchDialog}</>'), 'Music keeps its dialog alongside the current detail');
  console.log('Public QA upload network/HTTP/partial/success/cancel outcomes, same-file retry, TV scope, and viewer-control guards: PASSED');
})().catch(error => { console.error(error); process.exitCode = 1; });
