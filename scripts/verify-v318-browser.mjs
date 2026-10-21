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
  name: 'v318-fixture',
  resolveId(id) { if (id === '/fixture.jsx') return '\0fixture.jsx'; },
  async load(id) {
    if (id !== '\0fixture.jsx') return;
    const jsx = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import Photos from '/src/components/PhotosLibraryPage.jsx';import Organizer from '/src/components/PetPhotoOrganizer.jsx';
      import '/src/App.css';import '/src/V314Polish.css';
      Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});
      window.fixtureErrors=[];const originalError=console.error;console.error=(...args)=>{window.fixtureErrors.push(args.join(' '));originalError(...args)};window.addEventListener('error',e=>window.fixtureErrors.push(e.message));
      function Fixture(){const [album,setAlbum]=useState('album'),[organize,setOrganize]=useState(false);return <main style={{padding:16}}>
        <header style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}><button onClick={()=>setAlbum('')}>Back to Albums</button><h1>Photos</h1><span>2 photos</span><button>Add</button><button>Move To</button></header>
        <Photos externalNavigation externalCount albumId={album} onAlbumChange={setAlbum} mediaIndex={{libraries:{photos:{album:{id:'album',name:'Generated fixture album',path:'/photos/album',files:[{name:'one.jpg',path:'/photos/album/one.jpg',type:'image'},{name:'two.jpg',path:'/photos/album/Event/two.jpg',type:'image'}]}}}}}/>
        <button onClick={()=>setOrganize(true)}>Organize pet photos</button>{organize&&<Organizer onClose={()=>setOrganize(false)} onChanged={()=>Promise.resolve()}/>}</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
    return (await transformWithOxc(jsx, 'fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(vite) {
    const records = [{id:'bella',name:'Bella',files:[]},{id:'cookie',name:'Cookie',files:[]}];
    const original = {name:'one.jpg',path:'/photos/album/one.jpg',type:'image'};
    vite.middlewares.use((req, res, next) => {
      if(req.url === '/') {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.jsx"></script>');return;}
      if(req.url.startsWith('/api/file')) {res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#2798be"/></svg>');return;}
      if(req.url.startsWith('/api/')) {
        res.setHeader('Content-Type','application/json');
        let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{
          const body=req.headers['content-type']==='application/json'?JSON.parse(text||'{}'):{};
          if(req.url==='/api/pets') {res.end(JSON.stringify({ok:true,canEdit:true,records}));return;}
          if(req.url==='/api/pets/photo-groups') {res.end(JSON.stringify({ok:true,groups:[{id:'group',name:'Bella + Unknown',petIds:['bella'],unresolved:['Unknown'],missingPetIds:[],confirmed:false,files:[original]}]}));return;}
          if(req.url==='/api/pets/photo-sources') {res.end(JSON.stringify({ok:true,files:[original]}));return;}
          if(req.url==='/api/pets/photo-moves') {res.end(JSON.stringify({ok:true,plan:{id:body.requestId,folder:'/pets/Shared Photos/Bella + Cookie',items:[{from:original.path,to:'/pets/Shared Photos/Bella + Cookie/one.jpg',done:false}]}}));return;}
          if(req.url.endsWith('/apply')) {res.end(JSON.stringify({ok:true,plan:{id:'saved',items:[{from:original.path,to:'/pets/Shared Photos/Bella + Cookie/one.jpg',done:true}]}}));return;}
          res.end(JSON.stringify({ok:true}));
        });return;
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

  await until(()=>evaluate("!!document.querySelector('.photos-album-heading')"),'Photos album');
  const clickText = text => evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSON.stringify(text)+"&&!b.disabled).click()");
  const select = (label,value) => evaluate("(()=>{const el=document.querySelector('select[aria-label=\""+label+"\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(const width of [320,390,768,1024,1366]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
    const album = await evaluate("(()=>{const r=document.querySelector('.photos-album-heading').getBoundingClientRect();return {height:r.height,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()),count:document.body.textContent.split('2 photos').length-1}})()");
    assert(album.height < 100,JSON.stringify({width,album}));assert.equal(album.buttons.filter(value=>value.includes('Albums')).length,1);assert.equal(album.count,1);
    await clickText('Organize pet photos');
    await until(()=>evaluate("document.querySelectorAll('.pet-choices input').length===2"),'pet choices');
    const rect = await evaluate("(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()");
    assert(rect.left>=0&&rect.right<=width+1&&rect.top>=0&&rect.bottom<=1001,JSON.stringify({width,rect}));assert.equal(rect.overflow,false);
    assert.equal(await evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)"),true);
    await clickText('Close');await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'close');
  }
  await clickText('Organize pet photos');await until(()=>evaluate("document.querySelectorAll('.pet-choices input').length===2"),'ready');
  await select('Photo action','move');
  await until(()=>evaluate("!!document.querySelector('.pet-photo-sources input')"),'original selector');
  await evaluate("document.querySelectorAll('.pet-choices input').forEach(el=>el.click());document.querySelector('.pet-photo-sources input').click()");
  await clickText('Review original moves');await until(()=>evaluate("!!document.querySelector('.photo-move-review')"),'move review');
  assert.equal(await evaluate("document.body.textContent.includes('Move originals once')"),true);
  await clickText('Move originals');await until(()=>evaluate("document.body.textContent.includes('Originals organized')"),'saved move');
  await clickText('Close');await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'close move');
  await clickText('Organize pet photos');await until(()=>evaluate("document.querySelectorAll('.pet-choices input').length===2"),'reopen');
  await select('Photo action','group');await select('Shared folder','group');
  await until(()=>evaluate("document.body.textContent.includes('Unknown or ambiguous names: Unknown')"),'unknown confirmation');
  await evaluate("document.querySelectorAll('.pet-choices input')[1].click()");await clickText('Save folder membership');
  await until(()=>evaluate("document.body.textContent.includes('Folder membership saved')"),'saved group');
  await clickText('Close');await until(()=>evaluate("!document.querySelector('[role=dialog]')"),'close group');
  await clickText('Organize pet photos');await until(()=>evaluate("document.querySelectorAll('.pet-choices input').length===2"),'upload ready');
  await evaluate("document.querySelectorAll('.pet-choices input').forEach(el=>el.click());const el=document.querySelector('input[type=file]'),dt=new DataTransfer();dt.items.add(new File(['generated bytes'],'fixture.jpg',{type:'image/jpeg'}));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));");
  await clickText('Import selected photos');await until(()=>evaluate("document.body.textContent.includes('Photos saved once')"),'saved upload over HTTP without randomUUID');
  assert.deepEqual(await evaluate('window.fixtureErrors'),[]);
  console.log('PASS: compact Photos header/navigation/count and organizer at 320/390/768/1024/1366; actual React multi-pet upload with HTTP UUID fallback, reviewed original move, ambiguous folder confirmation, explicit Close and focus. Generated fixtures only.');
  await command('Browser.close').catch(()=>{});
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Only the absolute directory created by mkdtemp above is eligible for cleanup.
  assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
