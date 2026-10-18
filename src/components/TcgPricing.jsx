import { useEffect, useState } from 'react';
const endpoint = '/api/inventory/native/pricing';
async function request(route = '', body) {
  const response = await fetch(endpoint + route, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Error(result.message || 'Pricing service unavailable.');
  return result;
}
export function TcgPricingSettings() {
  const [settings, setSettings] = useState(null), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let active = true; request().then(result => { if (active) setSettings(result); }).catch(() => {}); return () => { active = false; }; }, []);
  async function save(clearKey = false) {
    setBusy(true); setMessage('');
    try { const result = await request('', { enabled: settings.enabled, ...(key ? { apiKey: key } : {}), clearKey }); setSettings(current => ({ ...current, ...result })); setKey(''); setMessage('Pricing settings saved.'); }
    catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }
  async function test() { setBusy(true); try { const result = await request('/test', {}); setMessage(result.message); } catch (error) { setMessage(error.message); } finally { setBusy(false); } }
  if (!settings?.canEdit) return null;
  return <section className="tcg-pricing-settings"><h4>TCG Price Lookup</h4><p>Optional TCGplayer pricing by printing and condition. Your key stays on this server. Provider quotas apply; manual estimates are preserved.</p>
    <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /> Enable pricing</label>
    <label>API key {settings.configured ? '(saved — leave blank to keep)' : ''}<input type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} /></label>
    <div><button type="button" disabled={busy} onClick={() => save()}>Save pricing settings</button><button type="button" disabled={busy || !settings.configured} onClick={test}>Test saved connection</button><button type="button" disabled={busy || !settings.configured} onClick={() => save(true)}>Remove saved key</button></div>
    {message && <p role="status">{message}</p>}<a href="https://tcgpricelookup.com/docs" target="_blank" rel="noreferrer">Provider setup and plans</a></section>;
}
export function TcgPriceCheck({ draft, setDraft }) {
  const [message, setMessage] = useState('');
  const identity = JSON.stringify({ cardName: draft?.cardName || '', setCode: draft?.setCode || '', rarity: draft?.rarity || '', edition: draft?.edition || '', condition: draft?.condition || 'Near Mint', language: draft?.language || 'English' });
  useEffect(() => {
    let active = true;
    const input = JSON.parse(identity);
    if (!input.cardName || !input.setCode || !input.rarity) return;
    setMessage('Checking optional pricing source…');
    request('/quote?' + new URLSearchParams(input)).then(result => {
      if (!active) return;
      const quote = result.quote;
      setMessage(quote.priceAvailable ? quote.priceSource : quote.pricingStatus === 'not-configured' ? 'Optional pricing source is not configured.' : 'No exact quote from the optional source. Manual estimates are kept.');
      if (quote.priceAvailable) setDraft(current => {
        if (!current || current.priceSourceType === 'manual-override' || current.setCode !== input.setCode || current.rarity !== input.rarity || current.edition !== input.edition || current.condition !== input.condition) return current;
        return { ...current, ...quote };
      });
    }).catch(error => { if (active) setMessage(error.message + ' Existing estimates are unchanged.'); });
    return () => { active = false; };
  }, [identity, setDraft]);
  return message ? <p className="muted" role="status">{message}</p> : null;
}
