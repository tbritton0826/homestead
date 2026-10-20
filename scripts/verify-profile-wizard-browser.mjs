// Actual React wizard/card, isolated fixtures only. No production server requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const root = fileURLToPath(new URL('../', import.meta.url));
const app = await fs.readFile(path.join(root, 'src/App.jsx'), 'utf8');
const source = name => { const start = app.indexOf('function ' + name + '('); return app.slice(start, app.indexOf('\n}', start) + 2); };
const card = source('getProfilePosterCandidates') + '\n' + source('AdultBirthdayPoster');
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'profile-wizard-fixture',
  resolveId(id) { if (id === '/profile-fixture.jsx') return '\0profile-fixture.jsx'; },
  async load(id) {
    if (id !== '\0profile-fixture.jsx') return;
    const jsx = [
      "import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';",
      "import AddAdultProfileModal from '/src/components/adult/AddAdultProfileModal.jsx';",
      "const getProfileImageFolderCandidates=()=>[]; const normalizePosterCandidate=v=>v; const getProfileInitials=()=> 'FP';",
      card,
      "window.fixtureErrors=[];window.addEventListener('error',e=>window.fixtureErrors.push(e.message));",
      "const seed=[{id:'chosen',source:'url',url:'https://fixture.invalid/selected.png',previewUrl:'/selected.png',kind:'image',name:'Selected image',selected:true,roles:{poster:true},destination:'photos'}];",
      "function Fixture(){const [open,setOpen]=useState(true);window.reopen=()=>setOpen(true);return <><AdultBirthdayPoster person={{id:'fixture',name:'Fixture Profile',poster:'/selected.png',posterCandidates:['/default.png']}}/><AddAdultProfileModal open={open} defaultType='personal' initialMedia={seed} onClose={()=>{window.fixtureCloseCount=(window.fixtureCloseCount||0)+1;setOpen(false)}} onSubmit={async payload=>{window.saved=payload;await new Promise(resolve=>window.finishSave=resolve);setOpen(false)}}/></>}",
      "createRoot(document.getElementById('root')).render(<Fixture/>);"
    ].join('\n');
    return (await transformWithOxc(jsx, 'profile-fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/') { res.setHeader('Content-Type','text/html');res.end('<style>.adult-profile-modal-backdrop{position:fixed;inset:0;overflow:auto;padding:48px;background:#223a}.adult-profile-modal{background:#fff;padding:20px;max-width:900px;margin:auto}label{display:block}img{max-width:100px}</style><div id="root"></div><script type="module" src="/profile-fixture.jsx"></script>');return; }
      if (['/selected.png','/default.png'].includes(req.url)) {res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=','base64'));return;}
      if(req.url.startsWith('/api/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,results:[]}));return;}
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

  await until(()=>evaluate("!!document.querySelector('input[placeholder=\"Profile name\"]')"), 'wizard');
  const nameValue = () => evaluate("document.querySelector('input[placeholder=\"Profile name\"]')?.value");
  const clickText = text => evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(" + JSON.stringify(text) + ")&&!b.disabled).click()");
  const fill = async value => { await evaluate("(()=>{const el=document.querySelector('input[placeholder=\"Profile name\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()"); };
  const outside = async () => {
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x:4,y:4,button:'left',clickCount:1},sessionId);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:4,y:4,button:'left',clickCount:1},sessionId);
  };
  const escape = async () => {
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
  };
  await fill('Fixture Profile');
  await until(async()=>await nameValue()==='Fixture Profile','name retained');
  await outside();await escape();
  assert.equal(await nameValue(),'Fixture Profile','outside and Escape preserve the draft');
  assert.equal(await evaluate('window.fixtureCloseCount||0'),0);
  assert.equal(await evaluate("document.querySelector('.adult-birthday-poster img').getAttribute('src')"),'/selected.png','selected card poster wins over cached provider candidates');
  await clickText('Media & Folder');
  await evaluate("document.querySelector('.adult-profile-media-preview-button').click()");
  await until(()=>evaluate("!!document.querySelector('.adult-profile-photo-viewer')"),'photo preview');
  await escape();
  await until(()=>evaluate("!document.querySelector('.adult-profile-photo-viewer')"),'Escape closes preview only');
  assert.equal(await evaluate("!!document.querySelector('.adult-profile-modal')"),true);
  await clickText('General');
  assert.equal(await nameValue(),'Fixture Profile');
  await clickText('Summary');
  await clickText('Create Personal');
  await until(()=>evaluate('!!window.saved'),'submit');
  assert.equal(await evaluate('window.saved.artworkSelections.posterId'),'chosen');
  assert.equal(await evaluate("document.querySelector('[aria-label=\"Close profile wizard\"]').disabled"),true);
  await outside();await escape();
  assert.equal(await evaluate('window.fixtureCloseCount||0'),0,'saving cannot be dismissed implicitly');
  await evaluate('window.finishSave()');
  await until(()=>evaluate("!document.querySelector('.adult-profile-modal')"),'save completion');
  await evaluate('window.reopen()');
  await until(()=>evaluate("!!document.querySelector('.adult-profile-modal')"),'reopen');
  await evaluate("document.querySelector('[aria-label=\"Close profile wizard\"]').click()");
  await until(()=>evaluate('window.fixtureCloseCount===1'),'explicit close');
  await evaluate('window.reopen()');
  await until(()=>evaluate("!!document.querySelector('.adult-profile-modal')"),'reopen for Cancel');
  await clickText('Cancel');
  await until(()=>evaluate('window.fixtureCloseCount===2'),'explicit Cancel');
  assert.deepEqual(await evaluate('window.fixtureErrors'),[]);
  console.log('PASS: actual React wizard retains name/media through outside click and Escape, protects saving, submits chosen poster, and supports explicit Close/Cancel; actual card prefers selected artwork. Fixture data only.');
  await command('Browser.close').catch(()=>{});
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Only the absolute directory created by mkdtemp above is eligible for cleanup.
  assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
