// Keep artwork revision parameters: replacing a chosen poster must invalidate its preview.
export function posterPreviewUrl(source, width = 360) {
  const value = String(source || '');
  if (!value || /^(?:https?:|data:|blob:)/i.test(value)) return value;
  try {
  const parsed = new URL(value, 'https://homestead.invalid');
  if (parsed.pathname === '/api/file') {
    if (!/\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i.test(parsed.searchParams.get('path') || '')) return value;
    parsed.searchParams.set('width', String(width));
    return parsed.pathname + parsed.search;
  }
  if (parsed.pathname.startsWith('/media/') && /\.(?:jpe?g|png|webp|gif|avif|heic|heif)$/i.test(parsed.pathname)) {
    const query = new URLSearchParams(parsed.search);
    query.set('path', decodeURIComponent(parsed.pathname)); query.set('width', String(width));
    return '/api/file?' + query;
  }
  return value;
  } catch { return value; }
}
