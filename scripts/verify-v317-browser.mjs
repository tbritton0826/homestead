// Actual React wizard/card, isolated fixtures only. No production server requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'v317-fixture',
  resolveId(id) { if (id === '/fixture.jsx') return '\0fixture.jsx'; },
  async load(id) {
    if (id !== '\0fixture.jsx') return;
    const jsx = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {TcgPricingSettings} from '/src/components/TcgPricing.jsx';
      import {MediaFolderTabs,useMediaFolders} from '/src/components/MediaFolderTabs.jsx';
      import '/src/App.css';import '/src/V314Polish.css';
      window.fixtureErrors=[];window.addEventListener('error',e=>window.fixtureErrors.push(e.message));
      function Fixture(){const [files,setFiles]=useState([{path:'/media/photos/Album/main.jpg'},{path:'/media/photos/Album/Holiday/one.jpg'},{path:'/media/photos/Album/Holiday/Day 2/two.jpg'},{path:'/media/photos/Album/Holidays/three.mp4'}]);window.rename=()=>setFiles([{path:'/media/photos/Album/main.jpg'},{path:'/media/photos/Album/New folder/one.jpg'}]);const folders=useMediaFolders(files,'/media/photos/Album');return <main style={{padding:16}}><h1>Fixture integrations</h1><div className="settings-toggle-grid"><TcgPricingSettings/><button className="settings-toggle-card">Other integration</button></div><MediaFolderTabs folders={folders}/><output id="count">{folders.files.length}</output></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
    return (await transformWithOxc(jsx, 'fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(vite) {
    let configured = true, enabled = true;
    vite.middlewares.use((req, res, next) => {
      if(req.url === '/') {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.jsx"></script>');return;}
      if(req.url.startsWith('/api/')) {
        res.setHeader('Content-Type','application/json');
        if(req.method === 'POST') {let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{const body=JSON.parse(text||'{}');if(req.url.endsWith('/test')) {res.end(JSON.stringify({ok:true,message:'Fixture connection passed.'}));return;}configured=body.clearKey?false:body.apiKey?true:configured;enabled=body.enabled;res.end(JSON.stringify({ok:true,canEdit:true,configured,enabled}));});return;}
        res.end(JSON.stringify({ok:true,canEdit:true,configured,enabled}));return;
      }
      next();
    });
  }
}] });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-profile-wizard-browser-'));
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

  await until(()=>evaluate("!!document.querySelector('.settings-toggle-card')"),'integration card');
  const clickText = text => evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes("+JSON.stringify(text)+")&&!b.disabled).click()");
  const fill = value => evaluate("(()=>{const el=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  for(const width of [320, 390, 768, 1024, 1366]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    await clickText('TCG Price Lookup');
    await until(()=>evaluate("!!document.querySelector('[role=dialog]')"),'pricing dialog');
    const rect = await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()");
    assert(rect.left>=0 && rect.right<=width+1 && rect.top>=0 && rect.bottom<=1001,JSON.stringify({width,rect}));
    assert.equal(rect.overflow,false,'no document overflow at '+width);
    assert.equal(await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)"),true);
    await fill('fixture-unsaved-key');
    await clickText('Close / Cancel');
    await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'explicit close');
  }
  await clickText('TCG Price Lookup');
  await until(()=>evaluate("!!document.querySelector('[role=dialog]')"),'reopen');
  assert.equal(await evaluate("document.querySelector('input[type=password]').value"),'','cancel clears unsaved key');
  await clickText('Test saved connection');
  await until(()=>evaluate("document.querySelector('[role=status]')?.textContent.includes('passed')"),'test saved connection');
  await clickText('Remove saved key');
  await until(()=>evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test saved connection')?.disabled"),'remove key');
  await fill('fixture-new-key');
  await clickText('Save pricing settings');
  await until(()=>evaluate("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test saved connection')?.disabled"),'saved key');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'Escape close');
  assert.equal(await evaluate("document.activeElement.textContent.includes('TCG Price Lookup')"),true,'focus restored');
  await clickText('Holiday › Day 2');
  await until(()=>evaluate("document.querySelector('#count').textContent==='1'"),'nested folder');
  await clickText('Main folder');
  await until(()=>evaluate("document.querySelector('#count').textContent==='1'"),'root media');
  await clickText('All');
  await until(()=>evaluate("document.querySelector('#count').textContent==='4'"),'all media');
  await evaluate('window.rename()');
  await until(()=>evaluate("document.querySelector('.media-folder-tabs').textContent.includes('New folder')&&!document.querySelector('.media-folder-tabs').textContent.includes('Holiday')"),'rescan folder replacement');
  assert.deepEqual(await evaluate('window.fixtureErrors'),[]);
  console.log('PASS: actual pricing card/dialog save, cancel, key removal, test, Escape/focus and 320/390/768/1024/1366 layouts; actual folder tabs filter nested/root media and update on refresh. Fixture data only.');
  await command('Browser.close').catch(()=>{});
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Only the absolute directory created by mkdtemp above is eligible for cleanup.
  assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
