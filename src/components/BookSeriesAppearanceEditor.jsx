import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function BookSeriesAppearanceEditor({ series, appearance = {}, onSaved, onClose }) {
  const [banner, setBanner] = useState(appearance.banner || "");
  const [opacity, setOpacity] = useState(Number(appearance.opacity ?? 0.34));
  const [darkness, setDarkness] = useState(Number(appearance.darkness ?? 0.68));
  const [blur, setBlur] = useState(Number(appearance.blur ?? 0));
  const [position, setPosition] = useState(appearance.position || "center");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBanner(appearance.banner || "");
    setOpacity(Number(appearance.opacity ?? 0.34));
    setDarkness(Number(appearance.darkness ?? 0.68));
    setBlur(Number(appearance.blur ?? 0));
    setPosition(appearance.position || "center");
    setStatus("");
  }, [series, appearance.banner, appearance.opacity, appearance.darkness, appearance.blur, appearance.position]);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setStatus("Uploading series banner…");
    try {
      const response = await fetch(`/api/books/series/${encodeURIComponent(series)}/banner`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Homestead-Content-Type": file.type || "image/jpeg" },
        body: await file.arrayBuffer(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "Banner upload failed.");
      setBanner(data.url || "");
      setStatus("Banner uploaded. Save to apply it.");
    } catch (error) {
      setStatus(error.message || "Banner upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus("Saving series artwork…");
    try {
      const response = await fetch("/api/books/series-appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series, banner: banner.trim(), opacity, darkness, blur, position }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.message || "Series artwork could not be saved.");
      onSaved?.(data.appearance, data.id);
      onClose?.();
    } catch (error) {
      setStatus(error.message || "Series artwork could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!series || typeof document === "undefined") return null;
  return createPortal(
    <div className="media-appearance-overlay book-series-appearance-overlay" role="dialog" aria-modal="true" aria-label={`${series} artwork`}>
      <button className="media-appearance-backdrop" type="button" aria-label="Close series artwork" onClick={onClose} />
      <section className="collection-appearance-editor panel">
        <div className="collection-appearance-editor-header">
          <div><p className="eyebrow">Book Series Artwork</p><h3>{series}</h3><p>Add banner artwork behind this series without creating a separate collection.</p></div>
          <button className="secondary-button" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="book-series-appearance-preview" style={banner ? { backgroundImage: `linear-gradient(rgba(5, 9, 18, ${darkness}), rgba(5, 9, 18, ${darkness})), url("${banner.replace(/"/g, "%22")}")`, backgroundPosition: position, opacity } : undefined}>
          <strong>{series}</strong><span>Series banner preview</span>
        </div>
        <div className="collection-appearance-fields">
          <label>Banner image URL<input value={banner} onChange={(event) => setBanner(event.target.value)} placeholder="https://example.com/series-banner.jpg" /></label>
          <label>Upload banner<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} /></label>
          <label>Artwork opacity <strong>{Math.round(opacity * 100)}%</strong><input type="range" min="0" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
          <label>Readability darkness <strong>{Math.round(darkness * 100)}%</strong><input type="range" min="0" max="0.95" step="0.01" value={darkness} onChange={(event) => setDarkness(Number(event.target.value))} /></label>
          <label>Blur <strong>{blur}px</strong><input type="range" min="0" max="30" step="1" value={blur} onChange={(event) => setBlur(Number(event.target.value))} /></label>
          <label>Position<select value={position} onChange={(event) => setPosition(event.target.value)}><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option></select></label>
        </div>
        <div className="collection-appearance-editor-actions"><span>{status}</span><button className="secondary-button" type="button" onClick={() => setBanner("")}>Clear Banner</button><button className="primary-button" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Series Artwork"}</button></div>
      </section>
    </div>,
    document.body
  );
}
