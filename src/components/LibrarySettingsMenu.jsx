import { useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus.js';
import { DiagnosticsDialog } from './LibraryDiagnostics.jsx';

function SettingsDialog({ onClose, onFilter, onAppearance, onDiagnostics, filterCount, filterActive }) {
  useDialogFocus({ selector: '.library-settings-dialog', onClose });
  return createPortal(<div className="polish-modal-overlay">
    <div className="polish-modal-backdrop" aria-hidden="true" onClick={onClose} />
    <section className="polish-modal-card library-settings-dialog" role="dialog" aria-modal="true" aria-label="Library settings">
      <header><h2>Library Settings</h2><button type="button" className="secondary-button" onClick={onClose}>Close</button></header>
      <div className="library-settings-options">
        {onFilter && <button type="button" onClick={onFilter}><span aria-hidden="true">⇅</span><span>Filter &amp; Sort</span>{filterActive && <small>{filterCount ? `${filterCount} active` : 'Custom sort'}</small>}</button>}
        <button type="button" onClick={onAppearance}><span aria-hidden="true">◉</span><span>Appearance</span></button>
        {onDiagnostics && <button type="button" onClick={onDiagnostics}><span aria-hidden="true">≠</span><span>Review discrepancies</span></button>}
      </div>
    </section>
  </div>, document.body);
}

export default function LibrarySettingsMenu({ library, onFilter, onAppearance, canReview, filterCount = 0, filterActive = false }) {
  const [view, setView] = useState('');
  // Restore the Settings trigger before the next dialog captures its focus origin.
  const select = callback => () => { setView(''); setTimeout(callback, 0); };
  return <>
    <button type="button" className={`global-search-icon-button app-ribbon-settings-button ${filterActive ? 'active' : ''}`} aria-label="Library settings" aria-haspopup="dialog" aria-expanded={Boolean(view)} title="Library Settings" onClick={() => setView('settings')}><span aria-hidden="true">⚙</span>{filterCount > 0 && <b>{filterCount > 99 ? '99+' : filterCount}</b>}</button>
    {view === 'settings' && <SettingsDialog onClose={() => setView('')} onFilter={onFilter && select(onFilter)} onAppearance={select(onAppearance)} onDiagnostics={canReview ? select(() => setView('diagnostics')) : undefined} filterCount={filterCount} filterActive={filterActive} />}
    {view === 'diagnostics' && <DiagnosticsDialog library={library} onClose={() => setView('')} />}
  </>;
}
