import { useEffect, useRef, useState } from "react";
import { parseVideoDisplay } from "../utils/video-display.js";
import { formatHomesteadDate } from "../utils/display-format.js";
import { photoUrl } from "./PhotoLibraryPicker.jsx";
export default function AdultVideoCard({ video, onClick }) {
  const element = useRef(null);
  const [visible, setVisible] = useState(false);
  const display = parseVideoDisplay(video);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "160px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const poster = video.thumbnail || video.poster || video.metadata?.poster;
  return <button ref={element} className="adult-video-card" type="button" onClick={() => onClick(video)} title={display.displayTitle}>
    <span className="adult-video-thumb">
      {poster ? <img src={photoUrl(poster)} alt="" loading="lazy" decoding="async" /> : <video src={visible ? photoUrl(video) : undefined} muted playsInline preload={visible ? "metadata" : "none"} />}
      <span className="adult-video-play" aria-hidden="true">▶</span>
    </span>
    <strong>{display.displayTitle}</strong>
    <span className="adult-video-pills">{display.source && <span>{display.source}</span>}{display.date && formatHomesteadDate(display.date, {}, "") && <span>{formatHomesteadDate(display.date)}</span>}</span>
  </button>;
}
