import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ItemFixMatchModal({ library, item, onClose, onSaved }) {
  const [query, setQuery] = useState([item.title || item.name || item.artist, library === 'books' ? item.author : ''].filter(Boolean).join(' '));
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const localId = String(item.localId || item.originalItem?.id || item.id || '');
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !busy) { event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [busy, onClose]);
  useEffect(() => () => { generation.current++; }, []);
  async function search(event) {
    event?.preventDefault(); if (busy) return;
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/${library}/auto-match/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localId, query }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Owner/admin access is required to change matches.');
      if (generation.current === token) { setCandidates(data.candidates || []); setSearched(true); }
    } catch (err) { if (generation.current === token) setError(err.message); }
    finally { if (generation.current === token) setBusy(false); }
  }
  async function save(candidate) {
    if (busy) return;
    if (candidate.compatibility?.compatible === false && !window.confirm(`${candidate.compatibility.reason}. Replace this item's identity with ${candidate.title} by ${(candidate.authors || candidate.artists || []).join(', ')}?`)) return;
    const token = ++generation.current; setBusy(true); setError('');
    try {
      const { compatibility, ...metadata } = candidate;
      const response = await fetch('/api/metadata/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryType: library, localId, metadata: { ...metadata, manualOverride: true, matchLocked: true }, localItem: { id: localId }, manualOverride: true }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Match could not be saved.');
      if (generation.current !== token) return;
      window.dispatchEvent(new Event('homestead-metadata-match-updated'));
      onSaved?.(data.match); onClose();
    } catch (err) { if (generation.current === token) setError(err.message); }
    finally { if (generation.current === token) setBusy(false); }
  }
  return createPortal(<div className="item-picker-overlay" onClick={() => !busy && onClose()}>
    <section className="item-picker-modal" role="dialog" aria-modal="true" aria-label="Fix Match" onClick={(event) => event.stopPropagation()}>
      <header><div><h2>Fix Match</h2><p>{item.title || item.name || item.artist}</p></div><button className="secondary-button" disabled={busy} onClick={onClose}>Close</button></header>
      <p>Search {library === 'books' ? 'by title, author, or ISBN (isbn:978…)': 'for the correct artist'}. Confirmed matches stay locked; media files are not renamed or moved.</p>
      <form className="item-match-search" onSubmit={search}><input autoFocus aria-label="Title, author or identifier" value={query} onChange={(event) => setQuery(event.target.value)} /><button className="primary-button" disabled={busy || !query.trim()}>{busy ? 'Working…' : 'Search'}</button></form>
      {error && <p role="alert">{error}</p>}
      {searched && !candidates.length && <p>No candidates found. Keep this item for review—no substitute has been applied.</p>}
      <div className="item-match-results">{candidates.map((candidate) => <article key={`${candidate.provider}:${candidate.providerId}`}>
        {candidate.poster && <img src={candidate.poster} alt="" loading="lazy" />}
        <div><strong>{candidate.title}</strong><p>{(candidate.authors || candidate.artists || []).join(', ')} · {candidate.year}</p><small>{candidate.description} · {candidate.provider} · {candidate.providerId}</small><p className={candidate.compatibility?.compatible ? 'match-compatible' : 'match-review'}>{candidate.compatibility?.reason}</p><button className="secondary-button" disabled={busy} onClick={() => save(candidate)}>Confirm Match</button></div>
      </article>)}</div>
    </section>
  </div>, document.body);
}
