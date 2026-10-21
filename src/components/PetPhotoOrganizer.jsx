import { clientRequestId } from "../utils/client-request-id.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useDialogFocus from "../hooks/useDialogFocus.js";
import { photoUrl } from "./PhotoLibraryPicker.jsx";

async function api(url, options) {
  const response = await fetch(url, options), data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message || "Pet photos could not be saved.");
  return data;
}
const json = body => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export default function PetPhotoOrganizer({ initialPetId, onClose, onChanged }) {
  const [pets, setPets] = useState([]), [ids, setIds] = useState(initialPetId ? [initialPetId] : []);
  const [groups, setGroups] = useState([]), [groupId, setGroupId] = useState("");
  const [sources, setSources] = useState([]), [paths, setPaths] = useState([]), [query, setQuery] = useState("");
  const [uploads, setUploads] = useState([]), [folder, setFolder] = useState("");
  const [mode, setMode] = useState("upload"), [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const requestId = useRef(null), committed = useRef(false);
  if (!requestId.current) requestId.current = clientRequestId();
  const locked = busy || committed.current || !!plan || uploads.some(file => file.attempted);
  useDialogFocus({ selector: ".pet-photo-organizer", onClose, canClose: !busy });
  async function load() {
    const [catalog, shared, photos] = await Promise.all([api("/api/pets"), api("/api/pets/photo-groups"), api("/api/pets/photo-sources")]);
    if (!catalog.canEdit) throw new Error("This pet library is read-only.");
    setPets(catalog.records); setGroups(shared.groups); setSources(photos.files); setReady(true);
  }
  useEffect(() => { let active = true; load().catch(err => { if (active) setError(err.message); }); return () => { active = false; }; }, []);
  const group = groups.find(value => value.id === groupId);
  const destination = ids.length > 1 ? `Shared Photos / ${ids.map(id => pets.find(pet => pet.id === id)?.name || id).join(" + ")}` : `${pets.find(pet => pet.id === ids[0])?.name || "Choose a pet"} / Photos`;
  async function run(action) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function refresh() {
    await load();
    try { await onChanged?.(); } catch { setNotice("Saved. Pet galleries could not refresh; reopen Pets without resending files."); }
  }
  return createPortal(<div className="image-viewer-overlay">
    <section className="pet-photo-organizer" role="dialog" aria-modal="true" aria-label="Organize pet photos" tabIndex={-1}>
      <header><h2>Organize pet photos</h2><button className="secondary-button" disabled={busy} onClick={onClose}>Close</button></header>
      <p>One original, linked to each selected pet. Shared folders do not create extra pet profiles.</p>
      {error && <p role="alert">{error}{!ready && <button onClick={() => run(load)}>Retry</button>}</p>}{notice && <p role="status">{notice}</p>}
      <fieldset disabled={locked || !ready}><legend>Action</legend><select aria-label="Photo action" value={mode} onChange={event => { setMode(event.target.value); setIds(initialPetId ? [initialPetId] : []); setGroupId(""); }}>
        <option value="upload">Import photos</option><option value="move">Organize existing photos</option><option value="group">Pets in a shared folder</option>
      </select></fieldset>
      {mode === "group" && <fieldset disabled={busy || !ready}><legend>Shared folder</legend><select aria-label="Shared folder" value={groupId} onChange={event => { const value = groups.find(row => row.id === event.target.value); setGroupId(event.target.value); setIds(value?.petIds || []); }}>
        <option value="">Choose a folder</option>{groups.map(row => <option key={row.id} value={row.id}>{row.name}{!row.confirmed || row.missingPetIds?.length ? " · Needs confirmation" : ""}</option>)}
      </select>{group && <p>{group.files.length} photos · Unknown or ambiguous names: {group.unresolved.join(", ") || "none"}. Changing membership keeps originals in place.</p>}</fieldset>}
      <fieldset disabled={locked || !ready}><legend>{mode === "group" ? "Pets in this folder" : "Pets in these photos"}</legend><div className="pet-choices">
        {pets.map(pet => <label key={pet.id}><input type="checkbox" checked={ids.includes(pet.id)} onChange={event => setIds(event.target.checked ? [...ids, pet.id] : ids.filter(id => id !== pet.id))} />{pet.name}</label>)}
      </div></fieldset>
      {mode !== "group" && <>
        <fieldset disabled={locked || !ready}><legend>Destination</legend><p>{destination}</p><label>Optional event/date subfolder <input value={folder} onChange={event => setFolder(event.target.value)} placeholder="2026 / Summer" /></label></fieldset>
        {mode === "upload" ? <fieldset key="upload" disabled={busy || !ready}><legend>Choose photos</legend><input aria-label="Choose pet photos" type="file" multiple accept="image/*,.heic,.heif" disabled={locked} onChange={event => setUploads(Array.from(event.target.files || []).map(file => ({ file, id: clientRequestId(), done: false, attempted: false })))} />
          {uploads.map(row => <p key={row.id}>{row.file.name} · {row.done ? "Saved" : row.attempted ? "Ready to retry" : "Ready"}</p>)}
        </fieldset> : <fieldset key="existing" disabled={locked || !ready}><legend>Choose existing originals (up to 100)</legend><input aria-label="Search existing pet photos" placeholder="Search name or folder" value={query} onChange={event => setQuery(event.target.value)} />
          <p>{paths.length} selected</p><div className="pet-photo-sources">{sources.filter(file => `${file.name} ${file.sourcePath || file.path}`.toLowerCase().includes(query.toLowerCase())).slice(0, 120).map(file => {
            const value = file.sourcePath || file.path;
            return <label key={value}><input type="checkbox" checked={paths.includes(value)} disabled={!paths.includes(value) && paths.length >= 100} onChange={event => setPaths(event.target.checked ? [...paths, value] : paths.filter(item => item !== value))} /><img src={photoUrl(file)} alt="" loading="lazy" /><span>{file.name}<small>{value}</small></span></label>;
          })}</div><small>Search to narrow large libraries. Only the first 120 matches are shown.</small>
        </fieldset>}
      </>}
      {plan && <div className="photo-move-review"><h3>Review original moves</h3>{plan.items.map(item => <p key={item.from}>{item.from}<br />→ {item.to}{item.done ? " · Saved" : ""}</p>)}<p>Move originals once. Each selected pet will reference the destination; the old Photos album will no longer contain these files.</p></div>}
      <footer>
        {mode === "group" ? <button className="primary-button" disabled={busy || !groupId || !ready} onClick={() => run(async () => { await api(`/api/pets/photo-groups/${groupId}`, { method: "PUT", ...json({ petIds: ids }) }); await refresh(); setNotice("Folder membership saved. Originals were kept."); })}>Save folder membership</button>
        : mode === "upload" ? <button className="primary-button" disabled={busy || !ids.length || !uploads.some(row => !row.done) || !ready} onClick={() => run(async () => {
          for (const row of uploads.filter(value => !value.done)) {
            row.attempted = true; setUploads([...uploads]);
            const query = new URLSearchParams({ kind: "photos", petIds: JSON.stringify(ids), folder, name: row.file.name, requestId: row.id });
            await api(`/api/pets/${encodeURIComponent(ids[0])}/media?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: row.file });
            row.done = true; setUploads([...uploads]);
          }
          await refresh(); setNotice("Photos saved once and linked to the selected pets.");
        })}>{busy ? "Saving…" : "Import selected photos"}</button>
        : <button className="primary-button" disabled={busy || !ready || (!plan && (!ids.length || !paths.length))} onClick={() => run(async () => {
          if (!plan) { const data = await api("/api/pets/photo-moves", { method: "POST", ...json({ requestId: requestId.current, paths, petIds: ids, folder }) }); setPlan(data.plan); }
          else { const data = await api(`/api/pets/photo-moves/${plan.id}/apply`, { method: "POST", ...json({}) }); setPlan(data.plan); committed.current = true; await refresh(); setNotice("Originals organized. No per-pet copies were made."); }
        })}>{busy ? "Working…" : !plan ? "Review original moves" : committed.current ? "Verify saved move" : "Move originals"}</button>}
      </footer>
    </section>
  </div>, document.body);
}
