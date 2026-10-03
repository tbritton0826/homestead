const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
// Keep edits made after a provisional list was published while filling untouched fields.
function mergeChangedFields(base, current, enriched) {
  if (Object.is(base, current)) return enriched;
  if (!isObject(base) || !isObject(current) || !isObject(enriched)) return current;
  const result = { ...enriched };
  for (const key of new Set([...Object.keys(base), ...Object.keys(current)])) {
    if (key === '_startupPending') continue;
    if (!(key in current)) delete result[key];
    else if (!Object.is(base[key], current[key])) result[key] = mergeChangedFields(base[key], current[key], enriched[key]);
  }
  return result;
}
export function mergeStartupProfileList(current, initial, incoming) {
  const bases = new Map(initial.map((profile) => [profile.id, profile]));
  const updates = new Map(initial.map((profile, index) => [profile.id, incoming[index]]));
  let changed = false;
  const next = current.map((profile) => {
    const base = bases.get(profile.id), loaded = updates.get(profile.id);
    if (!base || !loaded || loaded === base || !profile._startupPending) return profile;
    changed = true;
    return mergeChangedFields(base, profile, loaded);
  });
  return changed ? next : current;
}
export function initialStartupProfileList(current, incoming) {
  if (!current.length) return incoming;
  const ids = new Set(current.map((profile) => profile.id));
  return [...current, ...incoming.filter((profile) => !ids.has(profile.id))];
}
// One loader per mounted account: StrictMode subscribers share index/metadata requests.
export function createProfileStartupLoader({ loadIndex, prepare, concurrency = 6 }) {
  const listeners = new Set(), prioritized = new Set();
  let snapshot, lastPublished, queue = [], remaining = {}, running = false;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const publish = () => { if (snapshot === lastPublished) return; lastPublished = snapshot; for (const listener of listeners) listener(snapshot); };
  async function worker() {
    while (queue.length) {
      const job = queue.shift();
      let profile;
      try { profile = await job.hydrate(job.base.id); }
      catch (error) { console.warn('Profile enrichment unavailable', job.base.id, error); profile = { ...job.base }; }
      const ready = { ...profile }; delete ready._startupPending;
      snapshot = { ...snapshot, pending: snapshot.pending - 1, lists: { ...snapshot.lists, [job.library]: snapshot.lists[job.library].map((row, index) => index === job.position ? ready : row) } };
      // Publish each completed library, or a selected profile immediately. This
      // keeps enrichment from repeatedly rerendering an unrelated active page.
      remaining[job.library]--;
      if (prioritized.delete(`${job.library}:${job.base.id}`) || remaining[job.library] === 0) publish();
    }
  }
  async function start() {
    if (running) return;
    running = true;
    try {
      const index = await loadIndex();
      const prepared = prepare(index);
      const initial = Object.fromEntries(Object.entries(prepared).map(([library, group]) => [library, group.initial]));
      queue = Object.entries(prepared).flatMap(([library, group]) => group.initial.map((base, position) => ({ library, base, position, hydrate: group.hydrate })));
      remaining = Object.fromEntries(Object.entries(initial).map(([library, list]) => [library, list.length]));
      snapshot = { index, initial, lists: initial, pending: queue.length };
      publish();
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      publish(); finish(snapshot);
    } catch (error) { snapshot = { ...snapshot, error, pending: 0 }; publish(); finish(snapshot); }
  }
  return {
    subscribe(listener) { listeners.add(listener); if (snapshot) listener(snapshot); start(); return () => listeners.delete(listener); },
    prioritize(library, id) { prioritized.add(`${library}:${id}`); const position = queue.findIndex((job) => job.library === library && job.base.id === id); if (position > 0) queue.unshift(...queue.splice(position, 1)); },
    getProfile(library, id) { const index = snapshot?.initial?.[library]?.findIndex((profile) => profile.id === id); return index >= 0 ? snapshot.lists[library][index] : undefined; },
    finished,
  };
}
