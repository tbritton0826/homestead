// Folder names come only from the caller's authorized indexed files.
export function mediaPath(value) {
  const raw = typeof value === 'string' ? value : value?.path || value?.sourcePath || value?.filePath || '';
  if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('\\\\')) return raw.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  try {
    const url = new URL(raw, 'https://homestead.invalid');
    return (url.searchParams.get('path') || decodeURIComponent(url.pathname)).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  } catch { return String(raw).replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''); }
}
export function mediaFolders(files, { rootHint = '', profileCategory = false } = {}) {
  const paths = files.map(mediaPath), directories = paths.map(value => value.split('/').slice(0, -1));
  let root = mediaPath(rootHint);
  if (!rootHint || !paths.every(value => value.startsWith(root + '/'))) {
    root = '';
    if (profileCategory) {
      const parts = directories[0] || [];
      const categories = new Set(['photos', 'videos', 'nude', 'nudes', 'sex', 'keepsakes', 'ai', 'artwork', 'scenes']);
      const position = parts.findLastIndex(part => categories.has(part.toLowerCase()));
      const candidate = parts.slice(0, position + 1).join('/');
      if (position >= 0 && paths.every(value => value.startsWith(candidate + '/'))) root = candidate;
    }
    if (!root) {
      let common = directories[0] || [];
      for (const parts of directories.slice(1)) common = common.slice(0, common.findIndex((part, index) => part !== parts[index]) < 0 ? common.length : common.findIndex((part, index) => part !== parts[index]));
      root = common.join('/');
    }
  }
  const folder = file => {
    const value = mediaPath(file);
    if (root && !value.startsWith(root + '/')) return null;
    return (root ? value.slice(root.length + 1) : value).split('/').slice(0, -1).join('/');
  };
  const names = new Set();
  for (const file of files) {
    const parts = (folder(file) || '').split('/').filter(Boolean);
    for (let count = 1; count <= parts.length; count++) names.add(parts.slice(0, count).join('/'));
  }
  const tabs = names.size ? [{ id: '__all__', title: 'All' }, { id: '', title: 'Main folder' }, ...[...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(id => ({ id, title: id.replaceAll('/', ' › ') }))] : [];
  const filter = selected => files.filter(file => selected === '__all__' || folder(file) === selected || (selected && folder(file)?.startsWith(selected + '/')));
  return { root, tabs, filter };
}
