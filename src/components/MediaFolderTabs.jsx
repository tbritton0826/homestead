import { useEffect, useMemo, useState } from 'react';
import { mediaFolders } from '../utils/media-folder-tabs.js';

export function useMediaFolders(files, rootHint = '', profileCategory = false) {
  const [selected, select] = useState('__all__');
  const catalog = useMemo(() => mediaFolders(files, { rootHint, profileCategory }), [files, rootHint, profileCategory]);
  const effective = catalog.tabs.some(tab => tab.id === selected) ? selected : '__all__';
  useEffect(() => { select('__all__'); }, [catalog.root]);
  useEffect(() => { if (effective !== selected) select('__all__'); }, [effective, selected]);
  return { tabs: catalog.tabs, selected: effective, select, files: catalog.filter(effective), rootFileCount: catalog.filter('').length };
}
export function MediaFolderTabs({ folders, compact = false }) {
  if (compact) return folders.tabs.length ? <div className="media-folder-picker"><label>Folder<select aria-label="Media folder" value={folders.selected} onChange={(event) => folders.select(event.target.value)}>
    {folders.tabs.filter(tab => tab.id !== '' || folders.rootFileCount > 0).map(tab => <option key={tab.id} value={tab.id}>{tab.id === '__all__' ? 'All folders' : tab.title}</option>)}
  </select></label></div> : null;
  return folders.tabs.length ? <div className="media-folder-tabs" role="group" aria-label="Media folders">
    {folders.tabs.map(tab => <button key={tab.id} type="button" className={`library-tab ${folders.selected === tab.id ? 'active' : ''}`} aria-pressed={folders.selected === tab.id} onClick={() => folders.select(tab.id)}>{tab.title}</button>)}
  </div> : null;
}
