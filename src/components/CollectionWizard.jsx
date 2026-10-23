import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus.js';
import { collectionDraftId, collectionRowLabel, memberKey, seasonRows, splitSeason, groupSeason, membersFromRows, watchOrderFromRows, matchImportedRows } from '../utils/collection-draft.js';

export default function CollectionWizard({ collection, catalog, onSave, onCancel, onDelete }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(collection?.name || '');
  const [description, setDescription] = useState(collection?.description || '');
  const [poster, setPoster] = useState(collection?.poster || '');
  const [sourceUrl, setSourceUrl] = useState(collection?.watchOrder?.sourceUrl || '');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(Boolean(collection?.id && !collection?.watchOrder));
  const [visible, setVisible] = useState(80);
  const dirty = useRef(false);
  const artworkDraftId = useRef(null);
  if (!artworkDraftId.current) artworkDraftId.current = collectionDraftId();
  const [rows, setRows] = useState(() => collection?.watchOrder ? matchImportedRows(collection.watchOrder, catalog) : (collection?.savedItems || collection?.items || []).flatMap(reference => {
    const item = catalog.find(candidate => memberKey(candidate) === memberKey(reference));
    return item ? seasonRows(item) : [{ ...reference, unit: 'title', unmatched: true }];
  }));
  const changeRows = action => { dirty.current = true; setRows(action); };
  const close = () => { if (!busy && (!dirty.current || window.confirm('Discard the unsaved collection changes?'))) onCancel(); };
  useDialogFocus({ selector: '.collection-wizard-overlay', onClose: close, canClose: !busy });
  useEffect(() => {
    const protectDraft = event => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, []);
  useEffect(() => {
    if (!collection?.id || collection.watchOrder) return;
    const controller = new AbortController();
    fetch(`/api/collections/watch-order/${encodeURIComponent(collection.id)}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw Error('Unable to load the saved playback order. Close and retry.');
      const data = await response.json();
      if (data.order?.sections?.length) { setRows(matchImportedRows(data.order, catalog)); setSourceUrl(data.order.sourceUrl || ''); }
      setLoadingOrder(false);
    }).catch(error => { if (error.name !== 'AbortError') setStatus(error.message); });
    return () => controller.abort();
  }, [collection?.id]);
  const selected = useMemo(() => new Set(rows.filter(row => row.sourceId).map(memberKey)), [rows]);
  const lookup = useMemo(() => new Map(catalog.map(item => [memberKey(item), item])), [catalog]);
  const newlyIndexed = useMemo(() => {
    const result = new Map(), inspected = new Set();
    for (const row of rows) {
      const key = memberKey(row), item = lookup.get(key);
      if (row.library !== 'tv' || !item || inspected.has(key)) continue;
      inspected.add(key);
      const selectedEpisodes = new Set(rows.filter(entry => memberKey(entry) === key).flatMap(entry => (entry.episodes || []).map(episode => `${entry.season}:${episode}`)));
      for (const season of seasonRows(item)) result.set(`${key}:${season.season}`, (season.episodes || []).filter(episode => !selectedEpisodes.has(`${season.season}:${episode}`)));
    }
    return result;
  }, [rows, lookup]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? catalog.filter(item => !selected.has(memberKey(item)) && `${item.title} ${item.author || ''}`.toLowerCase().includes(term)).slice(0, 40) : [];
  }, [catalog, query, selected]);
  const importOrder = async () => {
    if (!sourceUrl.trim()) return setStatus('Enter a watch-order URL.');
    setBusy(true); setStatus('Reading and matching the watch order…');
    try {
      const response = await fetch('/api/collections/watch-order/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preview: true, collectionId: collection?.id || 'draft', title: name || 'Collection', sourceUrl }) });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw Error(data.message || 'Import failed.');
      const next = matchImportedRows(data.order, catalog);
      if (!next.length) throw Error('No watch-order entries were found on that page.');
      if (rows.length && !window.confirm('Replace the draft order with this imported order?')) return;
      changeRows(next); setStatus(`${next.length} order entries imported. ${next.filter(row => row.unmatched).length} need matching or are unavailable.`);
    } catch (error) { setStatus(error.message); } finally { setBusy(false); }
  };
  const upload = async file => {
    if (!file) return;
    if (!name.trim()) return setStatus('Enter a name before choosing artwork.');
    setBusy(true);
    try {
      const response = await fetch(`/api/collections/${encodeURIComponent(artworkDraftId.current)}/artwork/poster`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Homestead-Content-Type': file.type }, body: await file.arrayBuffer() });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw Error(data.message || 'Artwork upload failed.');
      setPoster(data.url); dirty.current = true; setStatus('Artwork ready. Save to apply it.');
    } catch (error) { setStatus(error.message); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!name.trim()) { setStep(1); return setStatus('Enter a collection name.'); }
    setBusy(true); setStatus('Saving collection…');
    try {
      await onSave({ ...collection, id: collection?.id || artworkDraftId.current.replace(/^draft-/, 'custom-'), generatedCollectionId: collection?.generatedCollectionId || (collection?.source && collection.source !== 'custom' ? collection.id : ''), source: 'custom', name: name.trim(), description: description.trim(), poster, items: membersFromRows(rows), watchOrder: watchOrderFromRows(rows, name.trim(), sourceUrl) });
      dirty.current = false;
    } catch (error) { setStatus(error.message || 'Save failed. Your draft is still open.'); } finally { setBusy(false); }
  };
  const move = (index, direction) => changeRows(current => { const next = [...current], target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const remove = index => changeRows(current => current.filter((_, i) => i !== index));
  const deleteCollection = async () => {
    setBusy(true); setStatus('');
    try { await onDelete(collection); } catch (error) { setStatus(error.message || 'Unable to delete this collection.'); } finally { setBusy(false); }
  };
  return createPortal(<div className="collection-wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="collection-wizard-title">
    <div className="collection-wizard-backdrop" aria-hidden="true" />
    <section className="collection-wizard-card">
      <header><div><p className="eyebrow">{collection?.id ? 'Edit collection' : 'Create collection'} · Step {step} of 2</p><h2 id="collection-wizard-title">{step === 1 ? 'Details & titles' : 'Arrange your order'}</h2></div><button type="button" className="secondary-button" disabled={busy} onClick={close}>Close</button></header>
      <div className="collection-wizard-body" aria-busy={busy || loadingOrder}>
        {loadingOrder ? <p role="status">{status || 'Loading the saved order…'}</p> : step === 1 ? <>
          <div className="collection-wizard-fields"><label>Name<input value={name} onChange={event => { setName(event.target.value); dirty.current = true; }} /></label><label>Description<textarea value={description} rows={3} onChange={event => { setDescription(event.target.value); dirty.current = true; }} /></label>
          <label>Poster URL or media path<input value={poster} onChange={event => { setPoster(event.target.value); dirty.current = true; }} /></label>
          <div className="collection-wizard-art">{poster && <img src={poster} alt="Selected collection poster" />}<label className="secondary-button media-native-file-button">Browse image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
          <label>Import online watch-order URL <span className="small-muted">Optional</span><input type="url" value={sourceUrl} onChange={event => { setSourceUrl(event.target.value); dirty.current = true; }} placeholder="https://…" /></label><button type="button" className="secondary-button" disabled={busy} onClick={importOrder}>Import & review order</button></div>
          <label className="collection-wizard-search">Find Movies, TV, Books or authors<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your libraries…" /></label>
          <div className="collection-wizard-results">{results.map(item => <button type="button" key={memberKey(item)} onClick={() => { changeRows(current => [...current, ...seasonRows(item)]); setQuery(''); }}><span><strong>{item.title}</strong><small>{item.library === 'tv' ? 'TV · Adds seasons' : item.library === 'books' ? `Book${item.author ? ' · ' + item.author : ''}` : 'Movie'}</small></span><span aria-hidden="true">＋</span></button>)}{query.trim() && !results.length && <p className="small-muted">No unselected titles match.</p>}</div>
          <p>{selected.size} selected titles · {rows.length} order entries</p><div className="collection-wizard-selected">{[...selected].map(key => { const item = lookup.get(key), row = rows.find(row => memberKey(row) === key); return <button type="button" className="secondary-button" key={key} onClick={() => changeRows(current => current.filter(row => memberKey(row) !== key))}>{item?.title || row?.title} <span aria-label="Remove">×</span></button>; })}</div>
        </> : <><p className="small-muted">Move seasons as a group, or split a season into episodes for crossovers. Books open their details in the watch order.</p><ol className="collection-wizard-order">{rows.slice(0, visible).map((row, index) => <li key={`${memberKey(row)}:${row.season}:${row.episodes?.join(',')}:${index}`}><span className="collection-wizard-number">{index + 1}</span><span><strong>{row.title}</strong><small>{collectionRowLabel(row)}{row.unit === 'season' ? ` · ${row.episodes?.length || 0} indexed episodes` : ''}{row.unmatched ? ' · Unavailable / needs matching' : ''}</small></span><div className="collection-wizard-row-actions">
          {row.unit === 'series' && lookup.has(memberKey(row)) && <button type="button" className="secondary-button" onClick={() => changeRows(current => current.flatMap((entry, i) => i === index ? seasonRows(lookup.get(memberKey(row))) : [entry]))}>Arrange seasons</button>}
          {row.unit === 'season' && row.episodes?.length > 0 && <button type="button" className="secondary-button" onClick={() => changeRows(current => splitSeason(current, index))}>Order episodes</button>}
          {row.unit === 'season' && newlyIndexed.get(`${memberKey(row)}:${row.season}`)?.length > 0 && <button type="button" className="secondary-button" onClick={() => changeRows(current => current.map((entry, i) => i === index ? { ...entry, episodes: [...(entry.episodes || []), ...newlyIndexed.get(`${memberKey(row)}:${row.season}`)] } : entry))}>Add {newlyIndexed.get(`${memberKey(row)}:${row.season}`).length} new episodes</button>}
          {row.unit === 'episode' && <button type="button" className="secondary-button" onClick={() => { if (window.confirm('Group this season at its first episode position? Other titles keep their relative order.')) changeRows(current => groupSeason(current, index)); }}>Group season</button>}
          <button type="button" className="secondary-button" aria-label={`Move ${row.title} ${collectionRowLabel(row)} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="secondary-button" aria-label={`Move ${row.title} ${collectionRowLabel(row)} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="secondary-button" onClick={() => remove(index)}>Remove</button></div></li>)}</ol>{rows.length > visible && <button type="button" className="secondary-button" onClick={() => setVisible(value => value + 80)}>Show next {Math.min(80, rows.length - visible)}</button>}{!rows.length && <p>No entries yet. Go back to add titles.</p>}</>}
      </div>
      <footer><p role="status">{!loadingOrder && status}</p><div>{collection?.id && collection.source === 'custom' && onDelete && <button type="button" className="danger-button" disabled={busy} onClick={deleteCollection}>Delete collection</button>}{step === 2 && <button type="button" className="secondary-button" disabled={busy} onClick={() => setStep(1)}>Back</button>}<button type="button" className="primary-button" disabled={busy || loadingOrder} onClick={() => step === 1 ? name.trim() ? setStep(2) : setStatus('Enter a collection name.') : save()}>{busy ? 'Working…' : step === 1 ? 'Next: arrange order' : 'Save collection'}</button></div></footer>
    </section>
  </div>, document.body);
}
