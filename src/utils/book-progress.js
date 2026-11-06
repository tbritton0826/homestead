// Reuse a bookmark only when its exact file belongs to this book. This preserves
// reading progress across scanner ID/path normalization without title guessing.
export function getBookReadingProgress(book, file, progress = {}) {
  const files = file ? [file] : book?.ebookFiles || book?.files || [];
  const paths = new Map();
  for (const item of files) for (const value of [item.path, item.sourcePath, item.filePath, ...(item.legacyPaths || [])].filter(Boolean)) {
    paths.set(String(value).replaceAll('\\', '/'), item.path);
  }
  const candidates = Object.values(progress).filter(row => row?.type === 'book' && row.location && paths.has(String(row.path || '').replaceAll('\\', '/')));
  candidates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const saved = candidates[0];
  return saved ? {...saved, path: paths.get(String(saved.path).replaceAll('\\', '/'))} : null;
}
