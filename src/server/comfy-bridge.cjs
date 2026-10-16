const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeParts } = require('./profile-media-folders.cjs');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
function endpoint(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw failure('Enter a valid ComfyUI server address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || /^(169\.254\.|metadata\.)/i.test(url.hostname)) throw failure('Use the ComfyUI server origin, without a path, credentials, or query.');
  return url.origin;
}
function validateConfiguration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Supply ComfyUI connection settings.');
  const url = endpoint(input.url), promptNode = String(input.promptNode || '');
  const workflow = input.workflow;
  if (workflow == null && !promptNode) return { url, promptNode: '', workflow: null };
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || workflow.nodes || JSON.stringify(workflow).length > 512000 ||
      typeof workflow[promptNode]?.inputs?.text !== 'string' || !workflow[promptNode]?.class_type) throw failure('Use an API-format workflow and the ID of its positive text-prompt node.');
  return { url, promptNode, workflow };
}
function createComfyBridge({ directory, fetchImpl = fetch }) {
  const configFile = path.join(directory, 'comfy-config.json'), jobsFile = path.join(directory, 'comfy-jobs.json');
  const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
  function write(file, value) {
    fs.mkdirSync(directory, { recursive: true }); const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  let jobs, storeError = false;
  try {
    jobs = read(jobsFile, {});
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) throw new Error('Invalid job store');
  } catch {
    jobs = {}; storeError = true;
    console.warn('[comfy] Image job storage is unreadable; image operations are disabled until repaired. Existing files were preserved.');
  }
  const healthy = () => { if (storeError) throw failure('Image job storage needs repair. Existing jobs were preserved; contact the server owner.', 503); };
  const config = () => read(configFile, null);
  const save = input => { const value = validateConfiguration(input); write(configFile, value); return value; };
  async function remote(url, route, options = {}, limit = 1024 * 1024) {
    let response;
    try { response = await fetchImpl(endpoint(url) + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw failure('Homestead cannot reach ComfyUI. Check its server address, container network, and whether ComfyUI is listening for connections.', 502); }
    if (!response.ok) throw failure(`ComfyUI returned HTTP ${response.status}. Check its workflow and server logs.`, 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) { await response.body.cancel().catch(() => {}); throw failure('ComfyUI response exceeded the size limit.', 502); } chunks.push(Buffer.from(chunk)); }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0] };
  }
  const json = async (url, route, options) => { const result = await remote(url, route, options); try { return JSON.parse(result.bytes); } catch { throw failure('The ComfyUI address returned an unexpected response.', 502); } };
  const job = (id, user) => { healthy(); const value = Object.hasOwn(jobs, id) && jobs[id]; if (!value || value.user !== user) throw failure('Image job is unavailable.', 404); return value; };
  async function status(id, user) {
    const value = job(id, user);
    const previousState = value.state;
    if (value.promptId && value.state !== 'complete' && value.state !== 'failed') {
      const history = await json(value.url, '/history/' + encodeURIComponent(value.promptId));
      const result = history[value.promptId];
      if (result?.status?.status_str === 'error') value.state = 'failed';
      else if (result?.status?.completed) {
        value.outputs = Object.values(result.outputs || {}).flatMap(row => row?.images || []).filter(image => {
          try { relativeParts(image.subfolder || ''); } catch { return false; }
          return image.type === 'output' && typeof image.filename === 'string' && image.filename.length <= 240 &&
            !/[\\/:]/.test(image.filename) && !image.filename.startsWith('.') &&
            ![...image.filename].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
        }).slice(0, 8);
        value.state = value.outputs.length ? 'complete' : 'failed';
      }
      if (value.state !== previousState) write(jobsFile, jobs);
    }
    return { ok: true, id, state: value.state, imageCount: value.outputs?.length || 0 };
  }
  async function generate(user, input) {
    healthy();
    const id = String(input.requestId || ''), text = String(input.prompt || '').trim();
    if (!/^[a-f0-9-]{36}$/i.test(id) || !text || text.length > 8000) throw failure('Enter a prompt up to 8,000 characters.');
    if (Object.hasOwn(jobs, id)) return status(id, user);
    if (Object.values(jobs).filter(value => value.user === user && !['complete', 'failed'].includes(value.state)).length >= 3 || Object.keys(jobs).length >= 1000) throw failure('Resolve existing image jobs before submitting more.', 409);
    const settings = config(); if (!settings) throw failure('Configure ComfyUI in Image Settings first.', 409);
    if (!settings.workflow) throw failure('Connection is configured. Add an API-format workflow in Image Settings before generating.', 409);
    const workflow = structuredClone(settings.workflow); workflow[settings.promptNode].inputs.text = text;
    // Persist before POST: an interrupted response must never auto-submit twice.
    const value = jobs[id] = { user, url: settings.url, state: 'uncertain', createdAt: new Date().toISOString() };
    write(jobsFile, jobs);
    const result = await json(settings.url, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: id }) });
    if (typeof result.prompt_id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(result.prompt_id) || result.error) throw failure('ComfyUI rejected this workflow. Check its nodes and model selections.', 502);
    value.promptId = result.prompt_id; value.state = 'queued'; write(jobsFile, jobs);
    return { ok: true, id, state: value.state, imageCount: 0 };
  }
  async function image(id, user, index) {
    const value = job(id, user), output = value.outputs?.[index];
    if (!output || value.state !== 'complete') throw failure('Image is not available yet.', 404);
    const params = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: 'output' });
    const result = await remote(value.url, '/view?' + params, {}, 16 * 1024 * 1024);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mime)) throw failure('This generated image format cannot be displayed.', 502);
    return result;
  }
  function forget(id, user) {
    healthy();
    if (!Object.hasOwn(jobs, id)) return { ok: true };
    const value = job(id, user);
    if (value.state === 'queued') throw failure('This job is still queued. Check ComfyUI before removing it.', 409);
    delete jobs[id]; write(jobsFile, jobs); return { ok: true };
  }
  return { config, save, generate, status, image, forget, test: async () => { const value = config(); if (!value) throw failure('Configure ComfyUI first.', 409); await json(value.url, '/system_stats'); return { ok: true, message: 'Homestead can reach ComfyUI.' }; } };
}
function registerComfyBridge(app, { service, access, pluginEnabled }) {
  const root = '/api/ai/comfy';
  const gate = (req, res, next) => {
    if (!pluginEnabled() || !['owner', 'admin'].includes(access.accessContext(req).user?.role)) return res.status(403).json({ ok: false, message: 'ComfyUI image generation requires an enabled Homestead AI plugin and an administrator account.' });
    next();
  };
  app.use(root, access.requireSession, access.requireFeature('ai'), access.requireFeature('plugins'), gate);
  const wrap = fn => async (req, res) => { try { res.set('Cache-Control', 'no-store'); res.json(await fn(req)); } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Image service operation failed.' }); } };
  const user = req => access.accessContext(req).user.id;
  app.get(root + '/config', wrap(req => ({ ok: true, userID: user(req), configured: Boolean(service.config()), workflowReady: Boolean(service.config()?.workflow), config: access.accessContext(req).user.role === 'owner' ? service.config() : null, canConfigure: access.accessContext(req).user.role === 'owner' })));
  app.put(root + '/config', access.requireOwner, wrap(req => ({ ok: true, config: service.save(req.body) })));
  app.post(root + '/test', wrap(() => service.test()));
  app.post(root + '/jobs', wrap(req => service.generate(user(req), req.body || {})));
  app.get(root + '/jobs/:id', wrap(req => service.status(req.params.id, user(req))));
  app.delete(root + '/jobs/:id', wrap(req => service.forget(req.params.id, user(req))));
  app.get(root + '/jobs/:id/images/:index', async (req, res) => { try { const value = await service.image(req.params.id, user(req), Number(req.params.index)); res.set('Cache-Control', 'no-store').type(value.mime).send(value.bytes); } catch (error) { res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : 'Image unavailable.' }); } });
}
module.exports = { createComfyBridge, registerComfyBridge, validateConfiguration };
