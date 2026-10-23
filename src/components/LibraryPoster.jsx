import { useEffect, useState } from 'react';
import { posterPreviewUrl } from '../utils/poster-preview.js';
import { handlePosterFallback } from '../utils/image-fallback.js';

export default function LibraryPoster({ src, width = 360, alt = '', ...props }) {
  const [original, setOriginal] = useState(false);
  useEffect(() => setOriginal(false), [src, width]);
  const preview = posterPreviewUrl(src, width);
  return <img {...props} src={original ? src : preview} alt={alt} loading="lazy" decoding="async" onError={event => {
    if (!original && preview !== src) setOriginal(true);
    else handlePosterFallback(event);
  }} />;
}
