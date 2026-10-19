// Run the actual intake component in an isolated browser with fixture-only APIs.
// Set HOMESTEAD_TEST_BROWSER to a Chromium/Edge executable on other platforms.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithOxc } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(path.join(root, 'src/App.jsx'), 'utf8');
const modal = source.slice(source.indexOf('const HOMESTEAD_INTAKE_LIBRARY_OPTIONS ='), source.indexOf('\nfunction ActivityCenter('));
const labelStart = source.indexOf('function tcgEstimateLabel(');
const priceLabel = source.slice(labelStart, source.indexOf('\n}', labelStart) + 2);
const quote = { cardId: '95515789', cardName: 'Blazing Cartesia, the Virtuous', setCode: 'MP23-EN162', rarity: 'Prismatic Secret Rare',
  marketValue: 0, priceAvailable: false, priceSourceType: 'unavailable', priceSource: 'Printing price unavailable' };
const requests = [], saved = new Map(), moveRequests = [];
let failMove = true;
let failNext = false;
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'isolated-intake-fixture',
  resolveId(id) { if (id === '/intake-fixture.jsx') return '\0intake-fixture.jsx'; },
  async load(id) {
    if (id !== '\0intake-fixture.jsx') return;
    const jsx = `import React, {useState,useEffect,useMemo,useRef,useCallback} from 'react';
      import {createRoot} from 'react-dom/client'; import {createPortal} from 'react-dom';
      import {prepareTcgPhotos} from '/src/utils/tcg-photos.js';
      import {TcgLocationFields,TcgHoldingMoves} from '/src/components/TcgStorage.jsx';
      import {TcgPriceCheck} from '/src/components/TcgPricing.jsx';
      const FeatureReloadButton=()=>null; const loadBarcodeReader=()=>Promise.reject(Error('Not used in fixture'));
      ${modal}\n${priceLabel}
      // Simulate a normal HTTP LAN browser even though localhost is trusted.
      Object.defineProperty(window.crypto, 'randomUUID', {value:undefined, configurable:true});
      window.fixtureErrors=[]; window.addEventListener('error', e=>window.fixtureErrors.push(e.message));
      const root=createRoot(document.getElementById('root'));
      function DetailFixture(){const [record,setRecord]=useState({id:'fixture-card',updatedAt:'initial',tcg:{quantity:2,printings:[{id:'fixture-print',setCode:'TEST-EN001',rarity:'Rare',condition:'Near Mint',quantity:2,locationId:'loose'}]}});return <aside className="inventory-v1-detail"><h2>Fixture card detail</h2><TcgHoldingMoves record={record} onUpdated={setRecord}/></aside>}
      window.openCardFixture=()=>root.render(<DetailFixture/>);
      root.render(<UniversalIntakeModal onClose={()=>{}} />);`;
    return (await transformWithOxc(jsx, 'intake-fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/intake-fixture.jsx"></script>'); return; }
      if (!req.url.startsWith('/api/')) return next();
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/api/inventory/native/pricing/quote')) return res.end(JSON.stringify({ ok: true, quote: { priceAvailable: false, pricingStatus: 'not-configured' } }));
      if (req.url.startsWith('/api/intake/tcg/yugioh/search')) return res.end(JSON.stringify({ ok: true, matches: [quote] }));
      if (req.url === '/api/inventory/native/batches') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); requests.push(body);
        assert.match(body.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
        if (failNext) { failNext = false; res.statusCode = 503; return res.end(JSON.stringify({ ok: false, message: 'Fixture share temporarily unavailable' })); }
        saved.set(body.requestId, body.entries[0]);
        return res.end(JSON.stringify({ ok: true, state: 'complete' }));
      }
      if (req.url.endsWith('/holdings/fixture-print/move')) {
        let raw=''; for await(const chunk of req) raw+=chunk; const body=JSON.parse(raw); moveRequests.push(body);
        if(failMove){failMove=false;res.statusCode=503;return res.end(JSON.stringify({ok:false,message:'Fixture move interrupted'}));}
        return res.end(JSON.stringify({ok:true,state:'complete',record:{id:'fixture-card',updatedAt:'moved',tcg:{quantity:2,printings:[{id:'fixture-print',quantity:2,locationId:'binder'}]}}}));
      }
      if (req.url === '/api/inventory/native') return res.end(JSON.stringify({ ok:true,canEdit:true,locations: [{ id: 'loose', kind: 'loose', name: 'Loose Cards' },{id:'binder',kind:'binder',name:'Fixture binder'}] }));
      res.end(JSON.stringify({ ok: true, decks: [], binders: [], session: { id: 'fixture-session' } }));
    });
  },
}] });

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-tcg-browser-'));
let browser, socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await pause(80); }
  throw Error('Timed out: ' + message);
}
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const executable = process.env.HOMESTEAD_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const endpoint = await until(async () => {
    if (launchError) throw launchError;
    try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); } catch { return null; }
  }, 'isolated browser launch');
  socket = new WebSocket(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let counter = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id); clearTimeout(call.timer);
    if (message.error) call.reject(Error(JSON.stringify(message.error))); else call.resolve(message.result);
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Browser command timed out: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await command('Target.createTarget', { url: `http://127.0.0.1:${port}/` });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text + ' ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const click = async text => {
    await until(() => evaluate(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled)`), 'button ' + text);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled).click()`);
  };
  const heading = text => until(() => evaluate(`document.querySelector('h2')?.textContent===${JSON.stringify(text)}`), 'heading ' + text);
  const fill = async (label, value) => evaluate(`(()=>{const el=Array.from(document.querySelectorAll('label')).find(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)})?.querySelector('input,select'); if(!el) throw Error('Missing field '+${JSON.stringify(label)}); Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  const prepare = async () => {
    await fill('Card name', quote.cardName); await click('Search catalog'); await heading('Confirm card match');
    await fill('Estimated value each', '8.75'); await fill('Quantity', '2'); await fill('Purchase price each', '1.25');
    await click('Add to Queue');
    await until(() => evaluate(`document.querySelector('.intake-tcg-printing-queue-list')?.textContent.includes('$17.50')`), 'queued manual total');
  };

  await click('Scan Trading Card'); await heading('Scan trading card'); await prepare();
  failNext = true;
  await click('scan next');
  await until(() => evaluate(`document.querySelector('.intake-status')?.textContent.includes('Fixture share temporarily unavailable')`), 'recoverable save failure');
  assert.equal(await evaluate(`document.querySelector('h2').textContent`), 'Confirm card match');
  await click('scan next'); await heading('Scan trading card');
  assert.equal(requests.length, 2); assert.equal(requests[0].requestId, requests[1].requestId); assert.equal(saved.size, 1);
  assert.equal(requests[1].entries[0].tcg.marketValue, 8.75); assert.equal(requests[1].entries[0].tcg.quantity, 2);
  assert.equal(requests[1].entries[0].tcg.priceSourceType, 'manual-override');

  await evaluate(`document.querySelector('.tcg-batch-toggle input').click()`);
  await prepare(); await click('Review 1 queued'); await heading('Review queued printings');
  assert.equal(await evaluate(`document.querySelector('.intake-review-step').textContent.includes('$8.75 each')`), true);
  assert.equal(await evaluate(`document.querySelector('.intake-review-step').textContent.includes('Manual estimate')`), true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('Estimated market value per card'))`), false);
  await click('Back to printing queue'); await heading('Confirm card match');
  await click('Edit');
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('label')).find(l=>l.querySelector('span')?.textContent==='Estimated value each').querySelector('input').value`), '8.75');
  await click('Add to Queue'); await click('Review 1 queued'); await click('Save queued printings'); await heading('Intake saved');
  assert.equal(saved.size, 2); assert.equal(requests[2].entries[0].tcg.marketValue, 8.75);
  assert.equal(requests[2].entries[0].tcg.purchasePrice, 1.25); assert.equal(requests[2].entries[0].tcg.manualPriceOverride, 8.75);
  await evaluate('window.openCardFixture()');
  await until(()=>evaluate(`document.body.textContent.includes('Move copies') || window.fixtureErrors.length`),'card detail on HTTP LAN');
  assert.deepEqual(await evaluate('window.fixtureErrors'), [],'opening card details must not crash without crypto.randomUUID');
  assert.equal(moveRequests.length,0,'opening details must not move cards');
  await evaluate(`(()=>{const el=document.querySelector('.inventory-v1-detail select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'binder');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('Move copies');
  await until(()=>evaluate(`document.body.textContent.includes('Fixture move interrupted')`),'recoverable move failure');
  await click('Move copies');
  await until(()=>evaluate(`document.body.textContent.includes('Fixture binder: 2')`),'confirmed move');
  assert.equal(moveRequests.length,2);assert.equal(moveRequests[0].requestId,moveRequests[1].requestId);
  assert.match(moveRequests[0].requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  assert.deepEqual(await evaluate('window.fixtureErrors'), []);
  console.log('PASS: actual React intake in Edge: HTTP UUID fallback, manual price/quantity/cost, scan-next failure/retry, single-mode review/back/edit/save; card detail HTTP opening and interrupted move retry. Fixture APIs only; no production data.');
  await command('Browser.close').catch(() => {});
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Only the absolute directory created by mkdtemp above is eligible for cleanup.
  assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
