import { useEffect, useState } from "react";

export async function tcgRequest(route, body, method = "POST") {
  const response = await fetch("/api/inventory/native" + route, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || "Inventory could not be updated.");
  return data;
}
const kinds = [["deck", "Deck"], ["binder", "Binder"], ["box", "Bin / Box"], ["loose", "Loose Cards"], ["custom", "Custom"]];

export function TcgLocationFields({ value, onChange, locations, onCreated }) {
  const [create, setCreate] = useState(false);
  return <div className="tcg-storage-fields">
    <label>Physical location<select value={value || "loose"} onChange={event => onChange(event.target.value)}><option value="loose">Loose Cards</option>{locations.filter(row => row.id !== "loose").map(row => <option key={row.id} value={row.id}>{row.name} · {row.kind}</option>)}</select></label>
    <button type="button" className="secondary-button" onClick={() => setCreate(!create)}>Create location</button>
    {create && <TcgLocationForm onSaved={row => { onCreated(row); onChange(row.id, row); setCreate(false); }} />}
  </div>;
}
function TcgLocationForm({ current, initialKind = "custom", onSaved }) {
  const [name, setName] = useState(current?.name || "");
  const [kind, setKind] = useState(current?.kind || initialKind);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try { const data = await tcgRequest("/locations" + (current ? "/" + encodeURIComponent(current.id) : ""), { name, kind }, current ? "PATCH" : "POST"); onSaved(data.location); }
    catch (error) { setError(error.message + " Refresh locations before retrying if the connection failed."); }
    finally { setBusy(false); }
  }
  return <div className="intake-form-grid"><label>Name<input value={name} onChange={event => setName(event.target.value)} /></label><label>Type<select disabled={Boolean(current)} value={kind} onChange={event => setKind(event.target.value)}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" disabled={busy || !name.trim()} onClick={save}>{busy ? "Saving…" : "Save location"}</button>{error && <p role="alert">{error}</p>}</div>;
}
export function TcgHoldingMoves({ record, onUpdated }) {
  const [locations, setLocations] = useState([]), [canEdit, setCanEdit] = useState(false), [error, setError] = useState("");
  useEffect(() => { let active = true; tcgRequest("", null, "GET").then(data => { if (active) { setLocations(data.locations || []); setCanEdit(data.canEdit); } }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  const totals = new Map();
  for (const row of record.tcg?.printings || []) { const id = row.locationId || row.binderId || "loose"; const name = locations.find(item => item.id === id)?.name || row.location || "Loose Cards"; totals.set(name, (totals.get(name) || 0) + Number(row.quantity || 0)); }
  return <section className="inventory-tcg-detail"><h3>{record.tcg?.quantity || 0} owned · Locations</h3>{[...totals].map(([name, quantity]) => <p key={name}>{name}: {quantity}</p>)}{error && <p role="alert">{error}</p>}{canEdit && (record.tcg?.printings || []).map(row => <TcgMoveRow key={row.id + record.updatedAt} record={record} holding={row} locations={locations} onUpdated={onUpdated} />)}</section>;
}
function TcgMoveRow({ record, holding, locations, onUpdated }) {
  const [quantity, setQuantity] = useState(1), [destination, setDestination] = useState("loose"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestId] = useState(createTcgMoveRequestId);
  async function move() {
    setBusy(true); setError("");
    try { const result = await tcgRequest(`/items/${encodeURIComponent(record.id)}/holdings/${encodeURIComponent(holding.id)}/move`, { quantity, locationId: destination, requestId }); if (result.state !== "complete") throw new Error("Move is still unconfirmed. Refresh this card before changing the move."); onUpdated(result.record); }
    catch (error) { setError(error.message + " Refresh this card before trying another move."); }
    finally { setBusy(false); }
  }
  return <div className="intake-form-grid"><strong>{holding.setCode} · {holding.rarity} · {holding.condition}</strong><label>Move quantity<input type="number" min="1" max={holding.quantity} value={quantity} onChange={event => setQuantity(Number(event.target.value))} /></label><label>Destination<select value={destination} onChange={event => setDestination(event.target.value)}><option value="loose">Loose Cards</option>{locations.filter(row => row.id !== "loose").map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><button type="button" disabled={busy || quantity < 1 || quantity > holding.quantity || destination === (holding.locationId || holding.binderId || "loose")} onClick={move}>Move copies</button>{error && <p role="alert">{error}</p>}</div>;
}
function createTcgMoveRequestId() {
  // randomUUID needs HTTPS; getRandomValues also works on ordinary HTTP LANs.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function TcgLocationsPanel({ kind, records, onSelect, onChanged }) {
  const [locations, setLocations] = useState([]), [canEdit, setCanEdit] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState(null), [creating, setCreating] = useState(false), [editing, setEditing] = useState(false);
  async function load() { try { const data = await tcgRequest("", null, "GET"); setLocations(data.locations || []); setCanEdit(data.canEdit); } catch (error) { setError(error.message); } }
  useEffect(() => { let active = true; tcgRequest("", null, "GET").then(data => { if (active) { setLocations(data.locations || []); setCanEdit(data.canEdit); } }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  const all = locations.some(row => row.id === "loose") ? locations : [...locations, { id: "loose", kind: "loose", name: "Loose Cards" }];
  const visible = all.filter(row => !kind || row.kind === kind);
  const current = selected && all.find(row => row.id === selected);
  const holdings = record => (record.tcg?.printings || []).filter(row => (row.locationId || row.binderId || "loose") === selected);
  return <section><h3>Physical card storage</h3><p>Each location holds its own quantities. Deck build references remain separate from owned copies.</p>{error && <p role="alert">{error}</p>}{canEdit && <button type="button" onClick={() => setCreating(!creating)}>Create location</button>}{creating && <TcgLocationForm initialKind={kind || "custom"} onSaved={async row => { await load(); setSelected(row.id); setCreating(false); onChanged?.(); }} />}<div className="inventory-tcg-view-tabs">{visible.map(row => <button type="button" className={selected === row.id ? "active" : ""} key={row.id} onClick={() => { setSelected(row.id); setEditing(false); }}>{row.name}</button>)}</div>{current && <><h3>{current.name}</h3>{canEdit && <button type="button" onClick={() => setEditing(!editing)}>Edit location</button>}{editing && <TcgLocationForm key={current.id} current={current} onSaved={async () => { await load(); setEditing(false); onChanged?.(); }} />}{records.filter(record => holdings(record).length).map(record => <button className="tcg-deck-card" type="button" key={record.id} onClick={() => onSelect(record)}><strong>{record.title}</strong><em>{holdings(record).reduce((sum, row) => sum + Number(row.quantity || 0), 0)} copies here</em>{holdings(record).map(row => <small key={row.id}>{row.setCode} · {row.rarity} · {row.condition} · {row.quantity} copies</small>)}</button>)}</>}</section>;
}
export function TcgWishlistPanel() {
  const [wishes, setWishes] = useState([]), [canEdit, setCanEdit] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [matches, setMatches] = useState([]), [busy, setBusy] = useState(false);
  async function load() { const data = await tcgRequest("", null, "GET"); setWishes(data.wishlist || []); setCanEdit(data.canEdit); }
  useEffect(() => { let active = true; tcgRequest("", null, "GET").then(data => { if (active) { setWishes(data.wishlist || []); setCanEdit(data.canEdit); } }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  async function search() { setBusy(true); try { const data = await tcgRequest("/cards?name=" + encodeURIComponent(query), null, "GET"); setMatches(data.matches || []); setError(""); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  async function add(match) { setBusy(true); try { await tcgRequest("/wishlist", { title: match.cardName, tcg: { ...match, cardName: match.cardName, providerCardId: String(match.cardId || ""), selectedPrinting: match, selectedArtwork: match.image } }); await load(); setMatches([]); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  async function remove(id) { try { await tcgRequest("/wishlist/" + encodeURIComponent(id), null, "DELETE"); await load(); } catch (error) { setError(error.message); } }
  return <section><h3>Wishlist</h3><p>Wanted cards do not count as owned copies.</p>{error && <p role="alert">{error}</p>}{canEdit && <><label>Find a wanted card<input value={query} onChange={event => setQuery(event.target.value)} /></label><button type="button" disabled={busy || !query.trim()} onClick={search}>Search</button>{matches.map((match, index) => <button type="button" disabled={busy} key={index} onClick={() => add(match)}>{match.cardName} · {match.setCode} · {match.rarity} · Add wanted card</button>)}</>}{wishes.map(row => <p key={row.id}><strong>{row.title}</strong> · {row.tcg?.setCode} · {row.tcg?.rarity} {canEdit && <button type="button" onClick={() => remove(row.id)}>Remove</button>}</p>)}</section>;
}
