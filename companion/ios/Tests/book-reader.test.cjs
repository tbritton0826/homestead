const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'Homestead');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

async function runReader(options = {}) {
  const messages = [], displays = [], listeners = {};
  const buttons = { previous: {}, next: {}, reader: { getBoundingClientRect: () => ({ width: 390, height: 640 }) } };
  let fetched = 0, cancelled = false, destroyed = 0, resized, settings, resolveReady, accent;
  const ready = options.delayed ? new Promise(resolve => { resolveReady = resolve; }) : Promise.resolve();
  const chunks = options.chunks || [new Uint8Array([80, 75, 3, 4])];
  const rendition = {
    settings: { direction: options.direction || 'ltr' },
    on: (name, callback) => { listeners[name] = callback; },
    display: async value => { displays.push(value); if (value === 'bad-cfi') throw Error('stale'); },
    next: async () => { displays.push('next'); },
    prev: async () => { displays.push('previous'); },
    resize: (...size) => { resized = size; },
    destroy: () => { destroyed++; },
    getContents: () => options.empty ? [] : [{ document: { body: { textContent: 'Readable fixture chapter' } } }],
  };
  const events = {};
  const context = {
    URL, Uint8Array, AbortController, atob: value => Buffer.from(value, 'base64').toString('binary'),
    document: { getElementById: id => buttons[id], documentElement: { style: { setProperty: (key, value) => { assert.equal(key, '--accent'); accent = value; } } } },
    window: {
      __homesteadBook: { url: options.url || 'https://homestead.local/api/file?path=%2Fbooks%2Ftitle.epub', origin: 'https://homestead.local', resume: options.resume || '', generation: 'fixture-generation', accent: options.accent, ...(options.data !== undefined ? { data: options.data } : {}) },
      webkit: { messageHandlers: { bookReader: { postMessage: value => messages.push(value) } } },
      addEventListener: (name, callback) => { events[name] = callback; },
    },
    fetch: async (url, config) => {
      fetched++; assert.equal(config.credentials, 'include'); assert.equal(config.redirect, 'error');
      let index = 0;
      return { ok: options.ok !== false, headers: { get: () => String(options.length || 4) }, body: { getReader: () => ({
        read: async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true },
        cancel: async () => { cancelled = true; },
      }) } };
    },
    ePub: buffer => {
      assert.ok(buffer.byteLength);
      return { ready, renderTo: (id, config) => { settings = config; return rendition; }, destroy: () => { destroyed++; } };
    },
  };
  vm.runInNewContext(source('BookReader.js'), context);
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
  return { messages, displays, buttons, listeners, events, fetched, settings, resolveReady,
    get accent() { return accent; }, get cancelled() { return cancelled; }, get destroyed() { return destroyed; }, get resized() { return resized; } };
}

test('EPUB opens with authenticated fetch, restored position and script-disabled content', async () => {
  const reader = await runReader({ resume: 'epubcfi(/6/2)' });
  assert.equal(reader.messages.at(-1).kind, 'ready');
  assert.deepEqual(reader.displays, ['epubcfi(/6/2)']);
  assert.equal(reader.settings.allowScriptedContent, false);
  assert.equal(reader.settings.allowPopups, false);
  assert.equal(reader.settings.method, 'write');
  reader.listeners.relocated({ start: { cfi: 'epubcfi(/6/4)' }, atStart: true, atEnd: false });
  assert.equal(reader.messages.at(-1).value, 'epubcfi(/6/4)');
  assert.equal(reader.buttons.previous.disabled, true);
  await reader.buttons.next.onclick(); assert.equal(reader.displays.at(-1), 'next');
  reader.events.resize(); assert.deepEqual(reader.resized, [390, 640]);
  reader.events.pagehide(); assert.equal(reader.destroyed, 2);
});

test('An empty rendered book reports an error instead of presenting a ready blank page', async () => {
  const reader = await runReader({ empty: true });
  assert.equal(reader.messages.at(-1).kind, 'error');
  assert.equal(reader.messages.some(message => message.kind === 'ready'), false);
});

test('Closing while the book is opening prevents late rendering and callbacks', async () => {
  const reader = await runReader({ delayed: true });
  reader.events.pagehide(); reader.resolveReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reader.displays.length, 0);
  assert.equal(reader.messages.length, 0);
});
test('Stale reading location falls back to the first page', async () => {
  const reader = await runReader({ resume: 'bad-cfi' });
  assert.deepEqual(reader.displays, ['bad-cfi', undefined]);
  assert.equal(reader.messages.at(-1).kind, 'ready');
});

test('Native EPUB bytes bypass browser authentication/origin fetch and reject invalid archives', async () => {
  const reader = await runReader({ data: Buffer.from([80, 75, 3, 4]).toString('base64') });
  assert.equal(reader.fetched, 0); assert.equal(reader.messages.at(-1).kind, 'ready');
  assert.equal(reader.messages.at(-1).generation, 'fixture-generation');
  assert.equal(reader.settings.width, 390); assert.equal(reader.settings.height, 640);
  const invalid = await runReader({ data: Buffer.from('<html>Sign in</html>').toString('base64') });
  assert.equal(invalid.fetched, 0); assert.equal(invalid.messages.at(-1).kind, 'error');
});
test('Horizontal swipes turn EPUB pages, while vertical scrolling, pinching and selection do not', async () => {
  const reader = await runReader();
  function swipe(start, end, target) {
    reader.listeners.touchstart({ touches: start });
    reader.listeners.touchend({ changedTouches: end, touches: [], target });
  }
  swipe([{ clientX: 300, clientY: 100 }], [{ clientX: 100, clientY: 110 }]);
  assert.equal(reader.displays.at(-1), 'next');
  swipe([{ clientX: 100, clientY: 100 }], [{ clientX: 300, clientY: 110 }]);
  assert.equal(reader.displays.at(-1), 'previous');
  const count = reader.displays.length;
  swipe([{ clientX: 300, clientY: 100 }], [{ clientX: 290, clientY: 300 }]);
  swipe([{ clientX: 300, clientY: 100 }, { clientX: 10, clientY: 10 }], [{ clientX: 100, clientY: 110 }]);
  swipe([{ clientX: 300, clientY: 100 }], [{ clientX: 100, clientY: 110 }], { ownerDocument: { getSelection: () => ({ isCollapsed: false }) } });
  swipe([{ clientX: 300, clientY: 100 }], [{ clientX: 100, clientY: 110 }], { closest: () => ({}) });
  assert.equal(reader.displays.length, count);
});

test('EPUB swipes respect right-to-left books, cancellation and closing the reader', async () => {
  const reader = await runReader({ direction: 'rtl' });
  const start = { touches: [{ clientX: 100, clientY: 100 }] };
  const end = { changedTouches: [{ clientX: 300, clientY: 110 }], touches: [] };
  reader.listeners.touchstart(start);
  reader.listeners.touchend(end);
  assert.equal(reader.displays.at(-1), 'next');
  const count = reader.displays.length;
  reader.listeners.touchstart(start);
  reader.listeners.touchcancel();
  reader.listeners.touchend(end);
  assert.equal(reader.displays.length, count);
  reader.listeners.touchstart(start);
  reader.events.pagehide();
  reader.listeners.touchend(end);
  assert.equal(reader.displays.length, count);
});
test('Off-server files, denied responses and oversized content never open a book', async () => {
  for (const options of [{ url: 'https://elsewhere.example/book.epub' }, { ok: false }, { length: 70 * 1024 * 1024 }]) {
    const reader = await runReader(options);
    assert.equal(reader.messages.at(-1).kind, 'error'); assert.equal(reader.displays.length, 0);
    if (options.url) assert.equal(reader.fetched, 0);
  }
  const streamed = await runReader({ chunks: [{ length: 65 * 1024 * 1024 }] });
  assert.equal(streamed.messages.at(-1).kind, 'error'); assert.equal(streamed.cancelled, true);
});
test('Book details and owned search expose Read/Listen with opt-in Read Along and bundled reader resources', () => {
  const actions = source('NativeBookReader.swift');
  assert.ok(actions.includes('readAlong = false; listening = first'));
  assert.ok(actions.includes('readAlong = true; listening = first'));
  assert.ok(source('CompanionTabs.swift').includes('item.category == .books { BookDetailActions'));
  assert.ok(source('NativeSearchDetails.swift').includes('if hit.isBook { BookDetailActions'));
  assert.ok(source('MediaModels.swift').includes('includeBooks: category == .books'));
  assert.ok(source('ProfileMediaModels.swift').includes('"ebookFiles"'));
  assert.ok(source('ProfileMediaModels.swift').includes('"audiobookFiles"'));
  assert.ok(source('NativeBookReader.swift').includes('BookWorkCatalog.orderedAudio(availableFiles)'));
  assert.ok(actions.includes('configuration.websiteDataStore = .nonPersistent()'));
  assert.ok(actions.includes('session.user?.id ?? (session.authEnabled ? nil : "local-owner")'));
  assert.ok(actions.includes('for cookie in client.familySessionCookies'));
  assert.ok(actions.includes('message.frameInfo.isMainFrame'));
  assert.ok(actions.includes('url.absoluteString == "about:srcdoc" && action.targetFrame?.isMainFrame == false'));
  assert.ok(source('NativeMediaViewer.swift').includes('if !PlaybackPresentation.needsChoice(resume: resumeAt) { play(resume: false) }'));
  assert.ok(!source('NativeMediaViewer.swift').includes('if autoPlay && !Task.isCancelled { playback.play(resume: true) }'));
  assert.ok(source('NativeMediaViewer.swift').includes('startReadAlong: Bool = false'));
  assert.ok(source('NativeMediaViewer.swift').includes('if showReadAlong {'));
  assert.ok(source('NativeMediaViewer.swift').includes('BookReadingView(files: readAlongFiles, client: client)'));
  for (const asset of ['epub.min.js', 'jszip.min.js', 'BOOK-READER-LICENSES.txt']) assert.ok(source(asset).length > 100);
});


test('Reader accepts the app accent color and rejects arbitrary CSS values', async () => {
  const themed = await runReader({ accent: '#ac7fea' });
  assert.equal(themed.accent, '#ac7fea');
  assert.equal(themed.messages.at(-1).kind, 'ready');
  const invalid = await runReader({ accent: 'url(https://untrusted.example/)' });
  assert.equal(invalid.accent, undefined);
  assert.equal(invalid.messages.at(-1).kind, 'ready');
});
