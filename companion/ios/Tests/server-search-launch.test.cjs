const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const source = readFileSync(join(__dirname, '../Homestead/ServerSearchLaunch.js'), 'utf8');

function launch({ available = true, dialog = false, hidden = false, disabled = false } = {}) {
  const state = { available, dialog, hidden, disabled, clicks: 0, disconnected: false, cleared: false };
  let mutate, expire, leave;
  const listeners = {};
  state.messages = [];
  const button = {
    get disabled() { return state.disabled; },
    getClientRects: () => state.hidden ? [] : [{}],
    click: () => { state.clicks++; }
  };
  runInNewContext(source, {
    document: {
      createElement: () => ({}),
      head: { appendChild() {} },
      addEventListener: (name, callback) => { listeners[name] = callback; },
      documentElement: {},
      querySelector: selector => selector.includes('spotlight-search-overlay')
        ? (state.dialog ? {} : null) : (state.available ? button : null)
    },
    MutationObserver: class {
      constructor(callback) { mutate = callback; }
      observe() {}
      disconnect() { state.disconnected = true; }
    },
    setTimeout: callback => { expire = callback; return 1; },
    clearTimeout: () => { state.cleared = true; },
    window: {
      webkit: { messageHandlers: { homesteadSearch: { postMessage: message => state.messages.push(message) } } },
      addEventListener: (_event, callback) => { leave = callback; }
    }
  });
  return { state, listeners, mutate: () => mutate(), expire: () => expire(), leave: () => leave() };
}

test('opens existing search once without reopening when results change', () => {
  const app = launch();
  app.mutate(); app.mutate();
  assert.equal(app.state.clicks, 1);
  assert.equal(app.state.disconnected, true);
  assert.equal(app.state.cleared, true);
});

test('Close and backdrop route to native without dismissing into the website', () => {
  for (const backdrop of [false, true]) {
    const app = launch({ dialog: true });
    let prevented = false, stopped = false;
    const button = {
      closest: selector => selector === '.spotlight-search-overlay' || (!backdrop && selector === '.spotlight-search-topbar'),
      getAttribute: () => backdrop ? 'Close global search' : null,
      textContent: backdrop ? '' : 'Close'
    };
    app.listeners.click({ target: { closest: () => button },
      preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
    assert.deepEqual(app.state.messages, ['close']);
    assert.equal(prevented && stopped, true);
  }
});

test('result selection is not treated as Close', () => {
  const app = launch({ dialog: true });
  const button = { closest: selector => selector === '.spotlight-search-overlay', getAttribute: () => null, textContent: 'Movie result' };
  app.listeners.click({ target: { closest: () => button }, preventDefault: () => assert.fail('blocked result') });
  assert.deepEqual(app.state.messages, []);
});

test('Escape closes only an open search overlay', () => {
  const app = launch({ dialog: true });
  const event = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} };
  app.listeners.keydown(event);
  app.state.dialog = false;
  app.listeners.keydown(event);
  assert.deepEqual(app.state.messages, ['close']);
});
test('waits for the authenticated app and visible enabled search control', () => {
  const app = launch({ available: false, hidden: true, disabled: true });
  app.state.available = true; app.mutate();
  app.state.hidden = false; app.mutate();
  assert.equal(app.state.clicks, 0);
  app.state.disabled = false; app.mutate();
  assert.equal(app.state.clicks, 1);
});
test('does not click when the search dialog is already open', () => {
  const app = launch({ dialog: true });
  assert.equal(app.state.clicks, 0);
  assert.equal(app.state.disconnected, true);
});
test('timeout and page exit prevent late unexpected opening', () => {
  for (const stop of ['expire', 'leave']) {
    const app = launch({ available: false });
    app[stop](); app.state.available = true; app.mutate();
    assert.equal(app.state.clicks, 0);
    assert.equal(app.state.disconnected, true);
  }
});
