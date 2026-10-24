// Isolated browser QA with generated records. Never reads or writes a real library.
import fs from 'node:fs/promises';
import { createServer, transformWithOxc } from 'vite';
const poster = '/media/fixture/poster.png';
const movie = (id, name) => ({ id, name, poster, year: '2024', genres: ['Adventure'], files: [{ type: 'video', name: name + '.mkv', path: '/fixture/' + id + '.mkv' }] });
const show = (id, name, genre = 'Drama') => ({ id, name, poster, year: '2025', genres: [genre], files: Array.from({ length: 120 }, (_, i) => ({ type: 'video', name: `${name}.S${String(Math.floor(i / 20)).padStart(2, '0')}E${String(i % 20 + 1).padStart(2, '0')}.mkv`, path: `/fixture/${id}/S${String(Math.floor(i / 20)).padStart(2, '0')}E${String(i % 20 + 1).padStart(2, '0')}.mkv` })) });
const index = { libraries: {
  movies: Object.fromEntries([movie('iron-man', 'Iron Man'), movie('film', 'Space Adventure'), ...Array.from({ length: 3000 }, (_, i) => movie('movie-' + i, 'Movie ' + String(i).padStart(4, '0')))].map(item => [item.id, item])),
  tv: Object.fromEntries([show('ncis', 'NCIS'), show('ncis-la', 'NCIS: Los Angeles'), ...Array.from({ length: 500 }, (_, i) => ({ ...show('series-' + i, 'Series ' + String(i).padStart(3, '0'), i % 2 ? 'Comedy' : 'Drama'), files: [] }))].map(item => [item.id, item])),
  books: { book: { id: 'book', name: 'The Example Book', author: 'Example Author', poster, files: [] } }, music: {}, photos: {},
} };
let collections = [], preferences = {}, rejectSave = false;
const server = await createServer({ root: process.cwd(), configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'polish-fixture',
  resolveId(id) { if (id === '/polish-fixture.jsx') return '\0polish-fixture.jsx'; },
  async load(id) {
    if (id !== '\0polish-fixture.jsx') return;
    const source = `import React,{useState,useEffect,useCallback} from 'react';import {createRoot} from 'react-dom/client';
      import {MoviesPage,TVShowsPage} from '/src/App.jsx';
      const index=${JSON.stringify(index)},config={enabledLibraries:{movies:true,tvshows:true,books:true}};
      const noop=()=>{};
      function Fixture(){const [view,setView]=useState('movies'),[context,setContext]=useState({}),[timing,setTiming]=useState(''),[errors,setErrors]=useState([]);
        useEffect(()=>{const receive=event=>setContext(current=>JSON.stringify(current)===JSON.stringify(event.detail)?current:event.detail);const error=event=>setErrors(current=>[...current,event.message]);window.addEventListener('homestead-page-context',receive);window.addEventListener('error',error);return()=>{window.removeEventListener('homestead-page-context',receive);window.removeEventListener('error',error)}},[]);
        const renderStart=performance.now();useEffect(()=>{requestAnimationFrame(()=>setTiming((performance.now()-renderStart).toFixed(1)+'ms to first grid frame'))},[view]);
        const props={mediaIndex:index,watchlist:{movies:[],tv:[]},requests:{movies:[],tv:[]},setupConfig:config,setActiveLibrary:noop,setDashboardOpen:noop,setWatchlist:noop,setRequests:noop,setRequestedMediaToolPage:noop,query:'',dashboardOpen:null};
        const action=id=>window.dispatchEvent(new CustomEvent('homestead-page-action',{detail:{library:view,action:id}}));
        return <main className='main' style={{padding:20,height:'100dvh',boxSizing:'border-box',overflow:'auto'}}><nav style={{display:'flex',gap:12,marginBottom:12}}><button onClick={()=>setView('movies')}>Movies fixture</button><button onClick={()=>setView('tv')}>TV fixture</button><button onClick={()=>fetch('/api/fixture/fail-save',{method:'POST'})}>Fail next save</button></nav><output aria-label='Measured first grid frame'>{timing}</output><output role='alert'>{errors.join('; ')}</output>
        <header className='panel' style={{padding:12,display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><strong>{context.title||view}</strong>{(context.stats||[]).map((stat,i)=><span key={i}>{stat}</span>)}{(context.headerActions||[]).map(item=><button className='secondary-button' key={item.id} onClick={()=>action(item.id)}>{item.label}</button>)}{context.backAction&&<button onClick={()=>action(context.backAction)}>{context.backLabel}</button>}<button className='primary-button' onClick={()=>action('create-collection')}>Create collection</button>{context.filterSort&&<button onClick={()=>action('filter-sort')}>Filter & Sort</button>}</header>
        <div id='library'>{view==='movies'?<MoviesPage {...props}/>:<TVShowsPage {...props}/>}</div></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
    return (await transformWithOxc(source, 'polish-fixture.jsx', { jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Homestead isolated polish QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/polish-fixture.jsx"></script>'); return; }
    if (req.url === poster || req.url.startsWith('/api/file?')) { res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'private, max-age=3600'); fs.readFile('public/homestead-icon.png').then(bytes => res.end(bytes)); return; }
    if (!req.url.startsWith('/api/')) return next();
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/fixture/fail-save') { rejectSave = true; res.end('{}'); return; }
    if (req.url === '/api/collections/custom' && req.method === 'POST') {
      let input = ''; req.on('data', chunk => input += chunk); req.on('end', () => {
        if (rejectSave) { rejectSave = false; res.statusCode = 503; res.end(JSON.stringify({ ok: false, message: 'Fixture save failure. Retry keeps your draft.' })); return; }
        const item = JSON.parse(input); item.id ||= 'fixture-' + (collections.length + 1); item.watchOrder.importedAt = new Date().toISOString();
        collections = [...collections.filter(saved => saved.id !== item.id), item]; res.end(JSON.stringify({ ok: true, collection: item, collections }));
      }); return;
    }
    if (req.url === '/api/account/preferences' && req.method === 'PATCH') {
      let input = ''; req.on('data', chunk => input += chunk); req.on('end', () => { preferences = { ...preferences, ...JSON.parse(input).preferences }; res.end(JSON.stringify({ ok: true, preferences })); }); return;
    }
    if (req.url === '/api/collections/watch-order/import') {
      res.end(JSON.stringify({ ok: true, order: { sections: [{ items: [{ title: 'Space Adventure', type: 'movie' }, { title: 'NCIS', type: 'tv', season: 1, episodes: [2, 1] }, { title: 'Not Owned', type: 'movie' }] }] } })); return;
    }
    const data = req.url === '/api/collections/custom' ? { ok: true, collections }
      : req.url === '/api/account/preferences' ? { ok: true, preferences }
      : req.url.startsWith('/api/collections/watch-order/') ? { ok: true, order: collections.find(item => item.id === decodeURIComponent(req.url.split('/').pop()))?.watchOrder || null }
      : { ok: true, overrides: [], results: [], artists: {}, albums: {}, matches: {} };
    res.end(JSON.stringify(data));
  }); },
}] });
await server.listen();
console.log('Isolated polish fixture: http://127.0.0.1:' + server.httpServer.address().port);
