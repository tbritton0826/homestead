import { useEffect, useRef, useState } from 'react';
import { transferRows } from '../utils/media-polish.js';
import { RequestStatePill, REQUEST_TYPES } from './RequestRows.jsx';

export default function TransferQueue({ snapshot, onSelect, onRequests, onRefresh }) {
  const [local, setLocal] = useState(null);
  const [error, setError] = useState('');
  const refresh = useRef(() => {});
  useEffect(() => {
    if (snapshot !== undefined) return;
    let stopped = false, busy = false;
    const controller = new AbortController();
    refresh.current = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch('/api/requests/status', { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || 'Queue unavailable');
        if (!stopped) { setLocal(data); setError(''); }
      } catch (err) { if (!stopped) setError(err.message); }
      finally { busy = false; }
    };
    refresh.current(); const timer = setInterval(() => refresh.current(), 8000);
    const visible = () => refresh.current(); document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [snapshot !== undefined]);
  const data = snapshot ?? local;
  const rows = transferRows(data?.rows);
  const failed = rows.filter((row) => row.status === 'needs-attention').length;
  return <section className="panel transfer-queue">
    <header><div><h2>Downloads & Imports</h2><p>Active transfers and items needing attention. Request history stays on Requests.</p></div><div><button className="secondary-button" onClick={() => onRefresh ? onRefresh() : refresh.current()}>Refresh</button>{onRequests && <button className="secondary-button" onClick={onRequests}>Requests</button>}</div></header>
    <div className="download-stat-pills"><span className="download-stat-pill">{rows.length - failed} active</span><span className="download-stat-pill">{failed} need attention</span></div>
    {(error || data?.error || data?.warnings?.length > 0) && <p role="alert">{error || data.error || data.warnings.join(' · ')}. Last known status is shown.</p>}
    {!data && !error && <p role="status">Loading transfer status…</p>}
    {data && !rows.length && <p>No active transfers or import errors reported. Monitored titles waiting for a release remain on Requests.</p>}
    <div className="transfer-list">{rows.map((row) => <article key={row.id}>
      <div><strong>{row.title || row.name || 'Untitled'}</strong><small>{REQUEST_TYPES.find(([key]) => key === row.library)?.[1]} · {row.source || row.provider || 'Homestead'}</small><p>{row.lastPollError || row.message || row.remoteStatus}</p></div>
      <div className="transfer-state"><RequestStatePill row={row} /><span>{row.percent != null ? `${Math.round(row.percent)}%` : 'Progress not reported'}</span>{row.percent != null && <progress max="100" value={row.percent} />}{row.eta && <small>ETA: {row.eta}</small>}{Number(row.downloadSpeed) > 0 && <small>{(Number(row.downloadSpeed) / 1048576).toFixed(1)} MB/s</small>}{row.tmdbId && onSelect && <button className="secondary-button" onClick={() => onSelect({ id: row.tmdbId, mediaType: row.library === 'tv' ? 'tv' : 'movie', title: row.title })}>Details</button>}</div>
    </article>)}</div>
    <p className="small-muted">Only provider-reported progress is shown. Pause/resume and import retry are not exposed by this queue yet.</p>
  </section>;
}
