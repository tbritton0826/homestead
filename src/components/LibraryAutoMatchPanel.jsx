import { useCallback, useEffect, useRef, useState } from "react";

async function request(url, body) {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || (response.status === 403 ? "Auto Match is managed by an owner or admin." : "Request failed."));
  return data;
}
export default function LibraryAutoMatchPanel({ library }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const generation = useRef(0);
  const matchedCount = useRef(0);
  const base = `/api/${library}/auto-match`;
  const refresh = useCallback(async () => {
    try {
      const data = await request(`${base}/status?offset=${offset}`);
      setStatus(data);
      if (data.matched !== matchedCount.current) {
        matchedCount.current = data.matched;
        window.dispatchEvent(new Event("homestead-metadata-match-updated"));
      }
    } catch (err) { setError(err.message); }
  }, [base, offset]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [status?.running, refresh]);
  useEffect(() => () => { generation.current++; }, [library]);
  const perform = async (fn) => { setBusy(true); setError(""); try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  const run = (force = false, localId) => perform(async () => { const data = await request(`${base}/run`, { force, localId }); setStatus(data); });
  const openReview = (item) => {
    generation.current++;
    setSelected(item); setCandidates(item.candidates || []);
    setQuery([item.title, ...(item.authors || (item.kind !== "artist" ? item.artists : []) || [])].join(" "));
    setError("");
  };
  const search = () => perform(async () => {
    const token = ++generation.current;
    const data = await request(`${base}/search`, { localId: selected.localId, query });
    if (token === generation.current) setCandidates(data.candidates || []);
  });
  const save = (candidate) => perform(async () => {
    if (candidate.compatibility?.compatible === false && !window.confirm(`${candidate.compatibility.reason}. Save this different identity as a manual override?`)) return;
    const { compatibility, aliases, ...metadata } = candidate;
    await request("/api/metadata/match", { libraryType: library, localId: selected.localId,
      metadata: { ...metadata, status: "matched", manualOverride: true, matchLocked: true, mediaType: selected.kind },
      localItem: { id: selected.localId }, manualOverride: true });
    window.dispatchEvent(new Event("homestead-metadata-match-updated"));
    setSelected(null); generation.current++; await refresh();
  });
  return <section className="library-auto-match-panel">
    <header><div><h3>Auto Match · {library === "books" ? "Books" : "Music"}</h3>
      <p>{library === "books" ? "Title and author must agree. ISBN and edition conflicts need review; your original book data stays intact." : "Match artists, albums, and tracks by exact identity. Artist, album/version, and available duration/ID evidence must agree."}</p>
      <p className="muted-text">Metadata only. No file moves, monitoring, or downloads. Manual Fix Match choices stay locked.</p></div></header>
    {error && <p role="alert" className="next-v1-notice">{error}</p>}
    {status && <>
      <label className="auto-match-toggle"><input type="checkbox" checked={status.enabled} disabled={busy} onChange={(event) => perform(async () => { setStatus(await request(`${base}/settings`, { enabled: event.target.checked })); })} /> Automatically match new/unmatched items after a scan</label>
      <div className="auto-match-toolbar">
        <button className="primary-button" type="button" disabled={busy || status.running} onClick={() => run(false)}>Auto Match Library</button>
        <button className="secondary-button" type="button" disabled={busy || status.running} onClick={() => run(true)}>Retry Needs Review</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={refresh}>Refresh Status</button>
      </div>
      <p role="status">{status.running ? `Matching ${status.scanned || 0} / ${status.total || 0}…` : status.message || "Ready to match your library."}</p>
      <p>{status.matched || 0} matched · {status.skipped || 0} already matched/checked · {status.reviewCount || 0} need review · {status.errors || 0} provider errors</p>
      <div className="auto-match-reviews">
        {(status.reviews || []).map((item) => <article key={item.localId}>
          <div><strong>{item.title}</strong><small>{item.kind} · {(item.authors || item.artists || []).join(", ")}</small><span>{item.reason}</span></div>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => openReview(item)}>Fix Match</button>
          <button className="secondary-button" type="button" disabled={busy || status.running} onClick={() => run(true, item.localId)}>Retry</button>
        </article>)}
      </div>
      {(offset > 0 || status.hasMore) && <div className="auto-match-toolbar"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>Previous</button><button disabled={!status.hasMore} onClick={() => setOffset(offset + 40)}>Next</button></div>}
    </>}
    {selected && <section className="auto-match-selection" aria-label="Fix Match candidates">
      <div className="auto-match-toolbar"><h4>Fix Match: {selected.title}</h4><button className="secondary-button" type="button" onClick={() => { generation.current++; setSelected(null); }}>Close Review</button></div>
      <form onSubmit={(event) => { event.preventDefault(); void search(); }}><input aria-label="Metadata search" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" disabled={busy}>Search</button></form>
      {!candidates.length && <p>No candidates found. Change your search or leave this item for review.</p>}
      <div className="auto-match-candidates">{candidates.map((candidate) => <article key={`${candidate.provider}:${candidate.providerId}`}>
        {candidate.poster && <img src={candidate.poster} alt="" loading="lazy" />}
        <div><strong>{candidate.title}</strong><p>{(candidate.authors || candidate.artists || []).join(", ")}</p><small>{candidate.year} · {candidate.provider} · {candidate.description}</small><p>{candidate.compatibility?.reason}</p>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => save(candidate)}>Confirm Match</button></div>
      </article>)}</div>
    </section>}
  </section>;
}
