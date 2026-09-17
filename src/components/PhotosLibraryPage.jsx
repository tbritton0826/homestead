import { useEffect, useMemo, useState } from "react";
import { photoUrl } from "./PhotoLibraryPicker.jsx";

export default function PhotosLibraryPage({ mediaIndex, libraryKey = "photos", appearance = {}, albumId = "", onAlbumChange, openImageViewer, setNavBackAction }) {
  const [visible, setVisible] = useState(120);
  const [fallbackPhoto, setFallbackPhoto] = useState(null);
  const albums = useMemo(() => Object.values(mediaIndex?.libraries?.[libraryKey] || {}).sort((a, b) => String(a.name || a.title).localeCompare(String(b.name || b.title))), [mediaIndex, libraryKey]);
  const album = albums.find((item) => String(item.id) === albumId);
  const photos = useMemo(() => (album?.files || []).filter((file) => file.type === "image"), [album]);
  useEffect(() => { setVisible(120); }, [albumId]);
  useEffect(() => {
    setNavBackAction?.(album ? () => () => onAlbumChange?.("") : null);
    return () => setNavBackAction?.(null);
  }, [albumId, setNavBackAction, onAlbumChange]);
  const covers = appearance.albumCovers || {};
  return <div className="photos-library-page photos-poster-library">
    {(album || appearance.bannerImage) && <header className={`photos-library-hero ${appearance.bannerImage ? "has-banner" : ""}`}>
      {appearance.bannerImage && <img className="photos-library-banner" src={appearance.bannerImage} alt="" style={{ opacity: appearance.bannerOpacity ?? 0.7, objectPosition: appearance.bannerPosition || "center", objectFit: appearance.bannerFit || "cover" }} />}
      {album && <div className="photos-library-hero-content">
        {album && <button className="secondary-button" type="button" onClick={() => onAlbumChange?.("")}>← Albums</button>}
        <h2>{album?.name || "Photo Albums"}</h2>
        <p>{album ? `${photos.length} photos` : `${albums.length} albums`}</p>
      </div>}
    </header>}
    {!album ? <div className="photos-poster-grid">
      {albums.map((item) => {
        const files = (item.files || []).filter((file) => file.type === "image");
        const cover = covers[item.id] || photoUrl(item.poster || files[0]);
        return <button className="photos-poster-card" type="button" key={item.id} onClick={() => onAlbumChange?.(String(item.id))}>
          <span className="photos-poster-image"><span className="photos-empty-poster" aria-hidden="true">▧</span>{cover && <img key={cover} src={cover} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span>
          <span className="photos-poster-caption"><strong>{item.name}</strong><small>{files.length} photos</small></span>
        </button>;
      })}
      {!albums.length && <p>No photo albums found. Add a folder mapping for this library and scan it.</p>}
    </div> : <>
      <div className="photos-detail-grid">{photos.slice(0, visible).map((photo, index) => <button className="photos-detail-photo" key={`${photo.path || photo.sourcePath}-${index}`} onClick={() => openImageViewer ? openImageViewer(photos, index) : setFallbackPhoto(photo)}>
        <img src={photoUrl(photo)} alt={photo.name || "Photo"} loading="lazy" decoding="async" /><span>{photo.name}</span>
      </button>)}</div>
      {!photos.length && <p>This album has no photos yet.</p>}
      {photos.length > visible && <button className="secondary-button" onClick={() => setVisible(visible + 120)}>Show More Photos ({photos.length - visible} remaining)</button>}
    </>}
    {fallbackPhoto && <div className="image-viewer-overlay" onClick={() => setFallbackPhoto(null)}><button onClick={() => setFallbackPhoto(null)}>Close</button><img src={photoUrl(fallbackPhoto)} alt={fallbackPhoto.name} /></div>}
  </div>;
}
