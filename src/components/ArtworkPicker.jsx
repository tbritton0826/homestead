import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ArtworkPicker({ library, item, slot, label, localId, onClose, onSaved }) {
  const [options, setOptions] = useState([]), [selection, setSelection] = useState('');
  const [upload, setUpload] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [warnings, setWarnings] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/media/artwork/options?${new URLSearchParams({ library, localId, slot })}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Artwork unavailable'); return data;
    }).then((data) => { setOptions(data.options || []); setSelection(data.options?.[0]?.url || ''); setWarnings(data.warnings || []); }).catch((err) => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [library, localId, slot]);
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy) onClose(); } };
    window.addEventListener('keydown', close, true); return () => window.removeEventListener('keydown', close, true);
  }, [busy, onClose]);
  async function chooseFile(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12000000) { setError('Choose a JPEG, PNG, or WebP smaller than 12 MB.'); return; }
    setBusy(true); setError('');
    try {
      const value = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      setUpload(value); setSelection(value);
    } catch { setError('Could not read this image.'); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/media/artwork/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ library, localId, slot, ...(selection === upload && upload ? { imageData: upload } : { url: selection }) }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || 'Artwork could not be saved');
      window.dispatchEvent(new Event('homestead-metadata-match-updated')); onSaved?.(data); onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return createPortal(<div className="item-picker-overlay" onClick={() => !busy && onClose()}><section className="item-picker-modal artwork-picker" role="dialog" aria-modal="true" aria-label={`Choose ${label}`} onClick={(event) => event.stopPropagation()}>
    <header><div><h2>Choose {label}</h2><p>{item.title || item.name || item.artist}</p></div><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button></header>
    {loading && <p role="status">Loading artwork…</p>}{error && <p role="alert">{error}</p>}{warnings.map((warning) => <p key={warning} className="small-muted">{warning}</p>)}
    <div className={`artwork-picker-grid ${slot === 'banner' ? 'wide' : ''}`}>{[...(upload ? [{ url: upload, label: 'Your upload (not yet saved)' }] : []), ...options].map((option) => <button key={option.url} type="button" aria-pressed={selection === option.url} className={selection === option.url ? 'selected' : ''} onClick={() => setSelection(option.url)}><img src={option.url} alt={option.label} loading="lazy" onError={(event) => { event.currentTarget.style.opacity = '.2'; }} /><span>{selection === option.url ? '✓ ' : ''}{option.label}</span></button>)}</div>
    {!loading && !options.length && !upload && <p>No alternate images were returned. You can upload your own below.</p>}
    <footer><label className="secondary-button">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => chooseFile(event.target.files?.[0])} /></label><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !selection} onClick={save}>{busy ? 'Saving…' : 'Save Changes'}</button></footer>
  </section></div>, document.body);
}
