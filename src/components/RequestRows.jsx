import { formatHomesteadDateTime, formatHomesteadDate } from '../utils/display-format.js';
import React, { useRef } from 'react';

export const REQUEST_TYPES = [['movies', 'Movies'], ['tv', 'TV'], ['books', 'Books'], ['music', 'Music'], ['youtube', 'YouTube']];
export const REQUEST_LABELS = { discovery: 'Available to Request', requested: 'Requested', pending: 'Pending Approval', approved: 'Requested', processing: 'Processing', downloading: 'Downloading', importing: 'Importing', scanning: 'Scanning', available: 'Available', partial: 'Partially Available', 'needs-attention': 'Needs Attention', failed: 'Needs Attention', declined: 'Declined' };
export function RequestStatePill({ row = {} }) {
  const state = row.status || 'requested';
  return <span className={`request-state-pill state-${state}`} title={row.message || REQUEST_LABELS[state]}>
    <span aria-hidden="true">{state === 'available' ? '✓' : ['needs-attention', 'failed'].includes(state) ? '!' : '•'}</span>
    {REQUEST_LABELS[state] || state}{state === 'downloading' && row.percent != null ? ` · ${Math.round(row.percent)}%` : ''}
  </span>;
}
function canSearchAgain(row = {}) {
  return ['movies', 'tv'].includes(row.library) && ['needs-attention', 'failed'].includes(String(row.status || '').toLowerCase());
}
function RequestRow({ library, label, items, onSelect, onSearchAgain, searchAgainBusy = '' }) {
  const scroller = useRef(null);
  return <section className="request-media-section" aria-label={`${label} requests`}>
    <header><h2>{label} <span className="request-type-count">{items.length}</span></h2>
      {items.length > 0 && <div className="request-row-controls">
        <button type="button" aria-label={`Scroll ${label} left`} onClick={() => scroller.current?.scrollBy({ left: -600, behavior: 'smooth' })}>‹</button>
        <button type="button" aria-label={`Scroll ${label} right`} onClick={() => scroller.current?.scrollBy({ left: 600, behavior: 'smooth' })}>›</button>
      </div>}
    </header>
    <div className="request-poster-scroller" ref={scroller} tabIndex={items.length ? 0 : -1} aria-label={`${label} request cards`}>
      {items.map((row) => <article key={row.id} className={`request-poster-card-shell request-kind-${library}`}>
        <button className="request-poster-card" type="button" onClick={() => onSelect(row)}>
          <span className="request-poster-image"><span aria-hidden="true">{library === 'music' ? '♫' : library === 'books' ? '▤' : '▶'}</span>
            {row.poster && <img key={row.poster} src={row.poster} loading="lazy" alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
          </span>
          <strong className="request-card-title">{row.title || row.name || 'Untitled'}</strong>
          <RequestStatePill row={row} />
          {row.createdAt && <time dateTime={row.createdAt} title={formatHomesteadDateTime(row.createdAt)}>{formatHomesteadDate(row.createdAt)}</time>}
        </button>
        {canSearchAgain(row) && onSearchAgain && <button className="request-search-again-button" type="button" disabled={searchAgainBusy === row.id} onClick={() => onSearchAgain(row)}>{searchAgainBusy === row.id ? 'Searching…' : 'Search Again'}</button>}
      </article>)}
      {!items.length && <p className="small-muted">No {label.toLowerCase()} requests yet.</p>}
    </div>
  </section>;
}
export default function RequestRows({ snapshot, fallback = {}, onSelect, onSearchAgain, searchAgainBusy = '' }) {
  const rows = snapshot?.rows || REQUEST_TYPES.flatMap(([library]) => (fallback[library] || []).map((row) => ({ ...row, id: `${library}:${row.id || row.tmdbId}`, library })));
  return <div className="requests-page">
    {snapshot?.error && <p className="request-sync-notice" role="status">Status refresh unavailable: {snapshot.error}. Showing the last known requests.</p>}
    {snapshot?.warnings?.length > 0 && <p className="request-sync-notice" role="status">{snapshot.warnings.join(' ')}</p>}
    {!snapshot && <p className="small-muted" role="status">Loading request status…</p>}
    {REQUEST_TYPES.filter(([library]) => !snapshot?.allowedLibraries || snapshot.allowedLibraries.includes(library)).map(([library, label]) => <RequestRow key={library} library={library} label={label} items={rows.filter((row) => row.library === library)} onSelect={onSelect} onSearchAgain={onSearchAgain} searchAgainBusy={searchAgainBusy} />)}
  </div>;
}
