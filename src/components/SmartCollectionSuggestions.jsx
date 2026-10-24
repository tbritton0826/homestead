import { useEffect, useMemo, useState } from 'react';

export default function SmartCollectionSuggestions({ groups, saved, onCreate }) {
  const [dismissed, setDismissed] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/account/preferences', { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.message || 'Unable to load suggestion preferences.');
      setDismissed(data.preferences?.dismissedCollectionSuggestions || []);
    }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, []);
  const suggestions = useMemo(() => {
    if (dismissed === null) return [];
    return groups.filter(group => !dismissed.includes(group.id) && !saved.some(collection => {
      if (collection.generatedCollectionId === group.id || collection.name.toLowerCase() === group.name.toLowerCase()) return true;
      return group.items.length > 0 && group.items.every(item => collection.items.some(member => member.library === item.library && String(member.sourceId) === String(item.sourceId)));
    }));
  }, [groups, saved, dismissed]);
  const dismiss = async group => {
    setBusy(group.id); setError('');
    try {
      const response = await fetch('/api/account/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: { dismissedCollectionSuggestions: [...new Set([...dismissed, group.id])] } }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || 'Unable to dismiss suggestion.');
      setDismissed(data.preferences.dismissedCollectionSuggestions);
    } catch (error) { setError(error.message); } finally { setBusy(''); }
  };
  if (!suggestions.length && !error) return null;
  return <section className="smart-collection-suggestions" aria-label="Smart collection suggestions"><header><p className="eyebrow">Suggestions</p><h3>Smart Collections — Based on your Media</h3><p className="small-muted">Review a group to create your own collection. Removing a suggestion keeps your media.</p></header>{error && <p role="alert">{error}</p>}<div className="smart-collection-grid">{suggestions.map(group => <article key={group.id}><h4>{group.name}</h4><p>{group.description}</p><details><summary>{group.count} matching titles</summary><ul>{group.items.map(item => <li key={`${item.library}:${item.sourceId}`}>{item.title} <small>{item.library === 'tv' ? 'TV' : item.library === 'books' ? 'Book' : 'Movie'}</small></li>)}</ul></details><div><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => onCreate(group)}>Create</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => dismiss(group)}>{busy === group.id ? 'Removing…' : 'Remove suggestion'}</button></div></article>)}</div></section>;
}
