import { useState } from 'react';
import { createPortal } from 'react-dom';
import useDialogFocus from '../hooks/useDialogFocus.js';

export default function LibraryFilterOverlay({ title, genres, years, selectedGenres, selectedYears, sort, onChange, onClose }) {
  const [draftGenres, setGenres] = useState(selectedGenres);
  const [draftYears, setYears] = useState(selectedYears);
  const [draftSort, setSort] = useState(sort);
  useDialogFocus({ selector: '.library-filter-dialog', onClose });
  const toggle = (setter, item) => setter(current => current.includes(item) ? current.filter(value => value !== item) : [...current, item]);
  return createPortal(<div className="polish-modal-overlay"><div className="polish-modal-backdrop" onClick={onClose} aria-hidden="true" /><section className="library-filter-dialog polish-modal-card" role="dialog" aria-modal="true" aria-label={`${title} filter and sort`}><header><h2>Filter & Sort · {title}</h2><button type="button" className="secondary-button" onClick={onClose}>Close</button></header><div className="polish-modal-body"><label>Sort<select value={draftSort} onChange={event => setSort(event.target.value)}><option value="title">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="release-desc">Newest first</option><option value="release-asc">Oldest first</option></select></label><fieldset><legend>Genres</legend><div className="polish-filter-choices">{genres.map(genre => <label key={genre}><input type="checkbox" checked={draftGenres.includes(genre)} onChange={() => toggle(setGenres, genre)} />{genre}</label>)}{!genres.length && <p>No genre metadata available.</p>}</div></fieldset><fieldset><legend>Years</legend><div className="polish-filter-choices">{years.map(year => <label key={year}><input type="checkbox" checked={draftYears.includes(year)} onChange={() => toggle(setYears, year)} />{year}</label>)}</div></fieldset></div><footer><button type="button" className="secondary-button" onClick={() => { setGenres([]); setYears([]); setSort('title'); }}>Reset</button><button type="button" className="primary-button" onClick={() => { onChange({ genres: draftGenres, years: draftYears, sort: draftSort }); onClose(); }}>Apply</button></footer></section></div>, document.body);
}
