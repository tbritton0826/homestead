const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const kinds = new Set(['binder', 'deck', 'box', 'loose', 'custom']);
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const failure = message => Object.assign(new Error(message), { status: 400 });
const validID = value => /^[a-zA-Z0-9_-]{1,150}$/.test(String(value || ''));

function createTcgOrganizations(inventoryRoot) {
  const root = path.resolve(inventoryRoot);
  function safe(target, create = false) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
      throw Object.assign(new Error('The Inventory share is unavailable. Check its writable container mapping.'), { status: 503 });
    }
    const relative = path.relative(root, path.resolve(target));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw failure('Invalid Inventory destination.');
    let current = root;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw failure('Linked Inventory destinations are not supported.');
    }
    if (create) fs.mkdirSync(path.dirname(target), { recursive: true });
    return target;
  }
  function write(target, value) {
    safe(target, true);
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function directory(location) {
    if (!kinds.has(location.kind) || !validID(location.id)) throw failure('Invalid location.');
    return path.join(root, 'tcg', 'locations', location.kind, location.id);
  }
  function readLocations(includeArchived = false) {
    const result = [], base = path.join(root, 'tcg', 'locations');
    if (!fs.existsSync(base)) return result;
    safe(base);
    for (const kind of kinds) {
      const dir = path.join(base, kind);
      if (!fs.existsSync(dir)) continue;
      safe(dir);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !validID(entry.name)) continue;
        const file = safe(path.join(dir, entry.name, 'metadata.json'));
        if (!fs.existsSync(file)) continue;
        const row = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (row.id === entry.name && row.kind === kind && (includeArchived || !row.archived)) result.push(row);
      }
    }
    return result;
  }
  function save(input, current = {}) {
    const kind = text(input.kind ?? current.kind);
    const name = text(input.name ?? current.name);
    if (!kinds.has(kind) || !name) throw failure('Choose a location type and enter a name.');
    const row = { ...current, id: current.id || crypto.randomUUID(), kind, name,
      description: text(input.description ?? current.description, 4000),
      pages: Math.max(1, Math.min(500, Number(input.pages ?? current.pages) || 20)),
      rows: Math.max(1, Math.min(8, Number(input.rows ?? current.rows) || 3)),
      columns: Math.max(1, Math.min(8, Number(input.columns ?? current.columns) || 3)),
      createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    write(path.join(directory(row), 'metadata.json'), { ...row, schemaVersion: 1 });
    return row;
  }
  function mirror(rows, kind) {
    for (const row of rows) save({ ...row, kind, archived: false }, { ...row, kind, archived: false });
    for (const row of readLocations().filter(row => row.kind === kind && !rows.some(item => item.id === row.id))) {
      write(path.join(directory(row), 'metadata.json'), { ...row, archived: true, updatedAt: new Date().toISOString() });
    }
  }
  function syncRecord(record, locations) {
    const byID = new Map(locations.map(row => [row.id, row]));
    const groups = new Map();
    for (const printing of record.tcg?.printings || []) {
      const id = printing.locationId || printing.binderId || 'loose';
      const location = byID.get(id) || (id === 'loose' ? { id: 'loose', kind: 'loose', name: 'Loose Cards' } : null);
      if (!location) throw failure('The selected card location no longer exists.');
      groups.set(id, { location, printings: [...(groups.get(id)?.printings || []), printing] });
    }
    for (const row of [...locations, { id: 'loose', kind: 'loose', name: 'Loose Cards' }]) if (!groups.has(row.id)) groups.set(row.id, { location: row, printings: [] });
    if (!validID(record.id)) throw failure('Invalid card identity.');
    for (const { location, printings } of groups.values()) {
      const saved = save(location, location);
      // Empty membership tombstones retain recovery history without counting copies.
      write(path.join(directory(saved), 'cards', record.id + '.json'), {
        schemaVersion: 1, type: 'tcg-location-card', cardId: record.id, cardName: record.title,
        providerCardId: record.tcg?.providerCardId || '', locationId: saved.id,
        quantity: printings.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        holdings: printings.map(item => ({ ...item, _canonicalDirectory: undefined, captures: undefined })),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  function wishlist() {
    const file = path.join(root, 'tcg', 'wishlist.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(safe(file), 'utf8'));
  }
  function writeWishlist(rows) { write(path.join(root, 'tcg', 'wishlist.json'), rows); }
  function saveCard(record) {
    if (!validID(record.id)) throw failure('Invalid card identity.');
    write(path.join(root, 'tcg', 'records', record.id + '.json'), { schemaVersion: 1, type: 'tcg-card', archived: !record.tcg?.printings?.length, record });
  }
  function readCards() {
    const directory = path.join(root, 'tcg', 'records');
    if (!fs.existsSync(directory)) return [];
    safe(directory);
    return fs.readdirSync(directory).filter(name => name.endsWith('.json') && validID(name.slice(0, -5))).map(name => {
      const saved = JSON.parse(fs.readFileSync(safe(path.join(directory, name)), 'utf8'));
      if (saved.type !== 'tcg-card' || saved.record?.id !== name.slice(0, -5)) throw failure('Invalid Inventory card metadata.');
      return saved;
    });
  }
  function receiptPath(identity) { return path.join(root, 'tcg', 'receipts', crypto.createHash('sha256').update(identity).digest('hex') + '.json'); }
  function confirm(record) {
    for (const identity of new Set([record.mobileRequestId, ...(record.mobileRequestIds || [])].filter(Boolean))) {
      write(receiptPath(identity), { recordId: record.id, identity, completedAt: new Date().toISOString() });
    }
  }
  function confirmed(record, identity) {
    try {
      const receipt = JSON.parse(fs.readFileSync(safe(receiptPath(identity)), 'utf8'));
      return receipt.identity === identity && receipt.recordId === record.id;
    } catch { return false; }
  }
  return { saveCard, readCards, readLocations, save, mirror, syncRecord, wishlist, writeWishlist, write, safe, confirm, confirmed };
}

function moveHolding(record, holdingID, quantity, destination, summarize) {
  if (!Number.isInteger(quantity) || quantity < 1 || !destination?.id) throw failure('Enter a valid move quantity and destination.');
  const list = (record.tcg?.printings || []).map(item => ({ ...item }));
  const index = list.findIndex(item => item.id === holdingID);
  if (index < 0 || quantity > list[index].quantity) throw failure('The selected copies are no longer available.');
  const original = list[index];
  if ((original.locationId || original.binderId || 'loose') === destination.id) throw failure('Choose a different location.');
  const moved = { ...original, id: quantity === original.quantity ? original.id : crypto.randomUUID(), quantity,
    locationId: destination.id, locationType: destination.kind, location: destination.name,
    binderId: destination.kind === 'binder' ? destination.id : '', binder: destination.kind === 'binder' ? destination.name : '',
    page: '', pocket: '', _canonicalDirectory: original._canonicalDirectory, _canonicalParentHoldingId: original.id,
    updatedAt: new Date().toISOString() };
  if (quantity === original.quantity) list[index] = moved;
  else { list[index].quantity -= quantity; list.push(moved); }
  return { ...record, tcg: summarize(record.tcg, list), updatedAt: new Date().toISOString() };
}
module.exports = { createTcgOrganizations, moveHolding };
