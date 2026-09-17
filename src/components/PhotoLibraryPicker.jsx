import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function photoUrl(file) {
  const raw = String(typeof file === "string" ? file : file?.sourcePath || file?.path || file?.publicPath || file?.url || "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/api/")) return raw;
  return `/api/file?path=${encodeURIComponent(raw)}`;
}
export default function PhotoLibraryPicker({ mediaIndex, libraryKey = "photos", onSelect, onClose, title = "Choose a photo", initialAlbum = "" }) {
  const albums = useMemo(() => Object.values(mediaIndex?.libraries?.[libraryKey] || {}), [mediaIndex, libraryKey]);
  const [albumId, setAlbumId] = useState(initialAlbum);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const dialog = useRef(null);
  const choices = useMemo(() => albums.filter((album) => !albumId || String(album.id) === albumId).flatMap((album) =>
    (album.files || []).filter((file) => file.type === "image").map((file) => ({ ...file, albumName: album.name }))
  ).filter((file) => `${file.name} ${file.albumName}`.toLowerCase().includes(query.toLowerCase())), [albums, albumId, query]);
  useEffect(() => { setPage(0); }, [albumId, query]);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const handleKey = (event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") {
      const nodes = [...dialog.current.querySelectorAll('button:not([disabled]), input, select')];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return createPortal(<div className="photo-picker-overlay" onClick={onClose}>
    <section className="photo-picker-card" role="dialog" aria-modal="true" aria-label={title} ref={dialog} tabIndex={-1} onKeyDown={handleKey} onClick={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button className="secondary-button" onClick={onClose}>Close</button></header>
      <div className="photo-picker-controls"><select aria-label="Photo album" value={albumId} onChange={(event) => setAlbumId(event.target.value)}>
        <option value="">All photo albums</option>{albums.map((album) => <option value={album.id} key={album.id}>{album.name}</option>)}
      </select><input aria-label="Search photos" placeholder="Search photos or albums…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <p>{choices.length} photos · originals are not modified</p>
      <div className="photo-picker-grid">{choices.slice(page * 60, page * 60 + 60).map((file, index) => <button key={`${file.path || file.sourcePath}-${index}`} type="button" onClick={() => { onSelect(photoUrl(file), file); onClose(); }}>
        <img src={photoUrl(file)} alt={file.name || "Photo"} loading="lazy" /><span>{file.name}</span><small>{file.albumName}</small>
      </button>)}</div>
      {!choices.length && <p>No photos found. Choose another album or use Browse Files to upload an image.</p>}
      <footer><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(choices.length / 60))}</span><button disabled={(page + 1) * 60 >= choices.length} onClick={() => setPage(page + 1)}>Next</button></footer>
    </section>
  </div>, document.body);
}
