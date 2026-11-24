(() => {
  'use strict';
  const config = window.__homesteadBook;
  const notify = (kind, value = '') => window.webkit.messageHandlers.bookReader.postMessage({ kind, value, generation: config.generation || '' });
  if (/^#[0-9a-f]{6}$/i.test(config.accent || '')) document.documentElement?.style?.setProperty('--accent', config.accent);
  let closed = false;
  const abort = new AbortController();
  const fail = () => { if (!closed) notify('error', 'Unable to open this ebook. Check your connection, account access, and file format.'); };
  let book, rendition, opening = false;
  const limit = 64 * 1024 * 1024;
  async function download() {
    if (config.data !== undefined) {
      if (typeof config.data !== 'string' || config.data.length > Math.ceil(limit / 3) * 4) throw new Error('Book too large');
      const decoded = atob(config.data);
      if (decoded.length < 4 || decoded.length > limit || decoded.charCodeAt(0) !== 80 || decoded.charCodeAt(1) !== 75) throw new Error('Not an EPUB archive');
      const bytes = new Uint8Array(decoded.length);
      for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
      return bytes.buffer;
    }
    const url = new URL(config.url);
    if (url.origin !== config.origin) throw new Error('Off-server book');
    const response = await fetch(url, { credentials: 'include', redirect: 'error', signal: abort.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Book unavailable');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > limit) throw new Error('Book too large');
        chunks.push(chunk.value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result.buffer;
  }
  async function open() {
    if (opening) return;
    opening = true;
    try {
      const data = await download();
      if (closed) return;
      book = ePub(data, { replacements: 'blobUrl' });
      await book.ready;
      if (closed) return;
      let bounds = document.getElementById('reader').getBoundingClientRect();
      for (let attempt = 0; (bounds.width < 1 || bounds.height < 1) && attempt < 120; attempt++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (closed) return;
        bounds = document.getElementById('reader').getBoundingClientRect();
      }
      if (bounds.width < 1 || bounds.height < 1) throw new Error('Reader viewport unavailable');
      rendition = book.renderTo('reader', { width: bounds.width, height: bounds.height, spread: 'none', method: 'write', allowScriptedContent: false, allowPopups: false });
      rendition.themes?.default({ body: { color: '#171717', background: '#fafafa', 'line-height': '1.5' } });
      rendition.on('relocated', location => {
        if (location.start?.cfi) notify('position', location.start.cfi);
        document.getElementById('previous').disabled = Boolean(location.atStart);
        document.getElementById('next').disabled = Boolean(location.atEnd);
      });
      rendition.on('displayError', fail);
      rendition.on('keydown', event => {
        if (event.key === 'ArrowRight') rendition.next().catch(fail);
        if (event.key === 'ArrowLeft') rendition.prev().catch(fail);
      });
      let touch;
      rendition.on('touchstart', event => {
        touch = !closed && event.touches?.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      });
      rendition.on('touchcancel', () => { touch = null; });
      rendition.on('touchend', event => {
        const start = touch;
        touch = null;
        if (closed || !start || event.changedTouches?.length !== 1 || event.touches?.length) return;
        if (event.target?.closest?.('a,button,input,textarea,select')) return;
        const selection = event.target?.ownerDocument?.getSelection?.();
        if (selection && !selection.isCollapsed) return;
        const end = event.changedTouches[0];
        const dx = end.clientX - start.x, dy = end.clientY - start.y;
        if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const forward = rendition.settings?.direction === 'rtl' ? dx > 0 : dx < 0;
        (forward ? rendition.next() : rendition.prev()).catch(fail);
      });
      try { await rendition.display(config.resume || undefined); }
      catch (error) { if (!config.resume) throw error; await rendition.display(); }
      if (rendition.getContents) {
        const visible = () => rendition.getContents().some(content => {
          const doc = content.document;
          return doc?.body?.textContent?.trim() || doc?.querySelector('img,svg,image');
        });
        if (!visible()) { await rendition.next(); if (!visible()) throw new Error('No readable content rendered'); }
      }
      if (!closed) notify('ready');
    } catch (error) { fail(); }
  }
  document.getElementById('previous').onclick = () => rendition?.prev().catch(fail);
  document.getElementById('next').onclick = () => rendition?.next().catch(fail);
  window.addEventListener('resize', () => {
    const bounds = document.getElementById('reader').getBoundingClientRect();
    rendition?.resize(bounds.width, bounds.height);
  });
  window.__homesteadBookClose = () => { closed = true; abort.abort(); rendition?.destroy(); book?.destroy(); };
  window.addEventListener('pagehide', window.__homesteadBookClose);
  open();
})();
