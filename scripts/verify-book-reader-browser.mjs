import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ios = process.env.HOMESTEAD_IOS_SOURCE || fileURLToPath(new URL('../../homestead-ios/Homestead/', import.meta.url));
const swift = await fs.readFile(path.join(ios, 'NativeBookReader.swift'), 'utf8');
const html = swift.match(/private static let html = """\s*([\s\S]*?)\s*"""/)[1];
const zipScript = await fs.readFile(path.join(ios, 'jszip.min.js'), 'utf8');
const epubScript = await fs.readFile(path.join(ios, 'epub.min.js'), 'utf8');
const readerScript = await fs.readFile(path.join(ios, 'BookReader.js'), 'utf8');
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
zip.file('OPS/package.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">generated-fixture</dc:identifier><dc:title>Reader fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
zip.file('OPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>');
for (const chapter of ['one', 'two']) zip.file(`OPS/${chapter}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${chapter}</title></head><body><h1>Homestead fixture chapter ${chapter}</h1><p>Generated EPUB content for reader verification.</p><script>parent.__epubScriptRan=true;</script></body></html>`);
const book = await zip.generateAsync({ type: 'nodebuffer' });
let port, downloads = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/book.epub') { downloads++; res.setHeader('Content-Type', 'application/epub+zip'); res.end(book); return; }
  const config = { url: `http://127.0.0.1:${port}/book.epub`, origin: `http://127.0.0.1:${port}`, resume: '', ...(req.url === '/native' ? { data: book.toString('base64') } : {}) };
  const scripts = `${zipScript}\n${epubScript}\nwindow.__homesteadBook=${JSON.stringify(config)};window.readerMessages=[];window.readerErrors=[];window.addEventListener('error',e=>readerErrors.push(e.message));window.webkit={messageHandlers:{bookReader:{postMessage:m=>readerMessages.push(m)}}};\n${readerScript}`;
  res.setHeader('Content-Type', 'text/html');
  res.end(html.replace('</body>', '<script>' + scripts.replace(/<\/script/gi, '<\\/script') + '</script></body>'));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'homestead-book-browser-'));
let browser, socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 20000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(80); } throw Error('Timed out: ' + label); }
try {
  browser = spawn(process.env.HOMESTEAD_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError; browser.on('error', error => { launchError = error; });
  const endpoint = await until(async () => { if (launchError) throw launchError; try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); } catch { return null; } }, 'browser launch');
  socket = new WebSocket(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map();
  socket.addEventListener('message', event => { const result = JSON.parse(event.data), call = pending.get(result.id); if (call) { pending.delete(result.id); clearTimeout(call.timer); result.error ? call.reject(Error(JSON.stringify(result.error))) : call.resolve(result.result); } });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(Error('Command timed out')); }, 22000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await command('Target.createTarget', { url: `http://127.0.0.1:${port}/native` });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  try { await until(() => evaluate(`window.readerMessages?.some(m=>m.kind==='ready')`), 'EPUB ready'); }
  catch (error) { console.error(await evaluate(`({messages:window.readerMessages,errors:window.readerErrors,frames:Array.from(document.querySelectorAll('iframe')).map(f=>({src:f.src,height:f.clientHeight}))})`)); throw error; }
  const bodyText = `Array.from(document.querySelectorAll('iframe')).map(f=>{try{return f.contentDocument?.body?.textContent||''}catch{return ''}}).join(' ')`;
  assert.match(await evaluate(bodyText), /Homestead fixture chapter one/);
  assert.equal(await evaluate('window.__epubScriptRan===true'), false);
  assert.equal(downloads, 0, 'native bytes must not cause a second browser download');
  assert(await evaluate(`document.getElementById('reader').getBoundingClientRect().height > 100`));
  await evaluate(`document.getElementById('next').click()`);
  await until(async () => /Homestead fixture chapter two/.test(await evaluate(bodyText)), 'next chapter');
  await evaluate(`document.getElementById('previous').click()`);
  await until(async () => /Homestead fixture chapter one/.test(await evaluate(bodyText)), 'previous chapter');
  console.log('PASS: actual bundled EPUB.js/JSZip/reader with generated EPUB: visible chapters, Next/Previous, nonzero viewport and disabled book scripts. WebKit/device verification remains separate.');
  await command('Browser.close').catch(() => {});
} finally {
  socket?.close(); browser?.kill(); await new Promise(resolve => server.close(resolve));
  assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
}
