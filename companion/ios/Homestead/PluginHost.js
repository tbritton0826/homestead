(() => {
  const nativePlugin = window.__homesteadNativePlugin;
  const frame = nativePlugin ? {
    dataset: { plugin: nativePlugin }, contentWindow: window,
    addEventListener: (name, callback) => window.addEventListener(name, callback)
  } : document.getElementById('plugin');
  const pluginId = frame.dataset.plugin;
  const prefix = '/api/plugins/' + encodeURIComponent(pluginId) + '/';
  window.sendPluginCommand = command => frame.contentWindow.postMessage({
    type: 'homestead:plugin-command', pluginId, command
  }, '*');
  frame.addEventListener('load', () => window.webkit.messageHandlers.pluginReady.postMessage(pluginId));
  window.addEventListener('message', async event => {
    const m = event.data;
    if (event.source !== frame.contentWindow || m?.pluginId !== pluginId || m?.type !== 'homestead:plugin-api-request') return;
    const requestId = String(m.requestId || '');
    if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(requestId)) return;
    const respond = (status, data) => frame.contentWindow.postMessage({
      type: 'homestead:plugin-api-response', pluginId, requestId, status, data
    }, '*');
    try {
      const method = String(m.method || 'GET').toUpperCase();
      const path = String(m.path || '');
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw Error('Unsupported method');
      if (!path.startsWith('/') || path.length > 2048 || path.includes('\\') || path.includes('#')) throw Error('Invalid path');
      const suffix = path.replace(/^\/+/, '');
      const decoded = decodeURIComponent(suffix.split('?')[0]);
      if (decoded.includes('\\') || decoded.split('/').some(x => x === '.' || x === '..')) throw Error('Invalid path');
      const url = new URL(prefix + suffix, window.location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith(prefix)) throw Error('Invalid namespace');
      const body = m.body === undefined || method === 'GET' ? undefined : typeof m.body === 'string' ? m.body : JSON.stringify(m.body);
      if (body && body.length > 32 * 1024 * 1024) throw Error('Request too large');
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(url, { method, headers, body, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(40000) });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text || '{}'); } catch { data = { ok: response.ok, message: text }; }
      respond(response.status, data);
    } catch (error) { respond(400, { ok: false, message: error.message }); }
  });
})();
