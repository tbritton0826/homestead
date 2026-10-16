// Local fixture only: synthetic data, isolated API responses, no production server.
const { createServer, transformWithOxc } = require('vite');
const react = require('@vitejs/plugin-react').default;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageViewer, TVShowDetail, ProfilePage, RecipeDetailsOverlay, RecipeWizard } from '/src/App.jsx?mobileFixture=1';
const art = '/media/fixture/portrait.svg';
const landscape = '/media/fixture/landscape.svg';
const config = { enabledLibraries: {adult:true,family:true}, adultSublibraries:{bodyDetails:true}, subscription:{features:{recipes:true,appearance:true}}, familySublibraries:{recipes:true} };
const child = new URLSearchParams(location.search).get('mode') === 'child';
const profile = {id:'fixture-profile',name:'Synthetic profile',library:child?'children':'personal',poster:art,banner:landscape,metadata:{poster:art,banner:landscape,biography:'Synthetic biography used for regression checks.',birthday:child?'2015-04-03':'1989-04-03',pantySize:'XS/S',braSize:'34B',everydayCut:'Thong',seamless:true,periodCut:'Cheeky'}};
let recipe = JSON.parse(sessionStorage.getItem('mobile-v12-fixture-recipe') || 'null') || {id:'recipe-fixture',title:'Synthetic soup',description:'Synthetic recipe',ingredients:['Water','Salt'],directions:['Boil','Serve'],categoryId:'dinner',category:'Dinner',tags:['family'],favorite:true,householdVisible:false,image:art};
window.fetch = async (address, options={}) => {
  const url=String(address); let data={ok:true};
  if(url.includes('/api/auth/session')) data={ok:true,authEnabled:true,user:{id:'fixture-owner',role:'owner',allowedLibraries:['*']}};
  else if(url.includes('/api/setup-config')) data=config;
  else if(url.includes('/api/appearance/config')) data={ok:true,config:{userDefaults:{},libraries:{},pages:{},devices:{}}};
  else if(url.includes('/api/recipes/categories')) data={ok:true,categories:[{id:'dinner',name:'Dinner'}]};
  else if(url.includes('/api/recipes/recipe-fixture') && options.method==='PATCH') {
    recipe={...recipe,...JSON.parse(options.body),updatedAt:new Date().toISOString()};
    sessionStorage.setItem('mobile-v12-fixture-recipe',JSON.stringify(recipe)); data={ok:true,recipe};
  } else if(url.includes('/api/recipes')) data={ok:true,recipes:[recipe]};
  else if(url.includes('biography')) data={ok:true,text:profile.metadata.biography};
  else if(url.includes('metadata')) data={ok:true,metadata:profile.metadata};
  else if(url.includes('/data/')) data={libraries:{}};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
function Fixture(){
 const mode=new URLSearchParams(location.search).get('mode')||'recipe';
 const [editing,setEditing]=useState(false),[saved,setSaved]=useState(recipe),[viewer,setViewer]=useState({index:0,files:[{name:'Portrait.svg',url:art},{name:'Landscape.svg',url:landscape}]}),[slideshow,setSlideshow]=useState({active:false,speed:5000});
 if(mode==='photo')return <ImageViewer viewer={viewer} onClose={()=>setViewer(null)} setViewer={setViewer} slideshow={slideshow} setSlideshow={setSlideshow}/>;
 if(mode==='profile'||mode==='child')return <ProfilePage person={profile} mediaFiles={[]} onBack={()=>{}} openImageViewer={()=>{}} setSelected={()=>{}} people={[]} setActiveLibrary={()=>{}} setupConfig={config} accountUserId="fixture-owner"/>;
 if(mode==='tv')return <div className="app-shell"><main className="main" style={{'--media-panel-color':'#203040'}}><TVShowDetail show={{id:'fixture-tv',title:'Synthetic TV show',poster:art,banner:landscape,year:2024,genres:['Drama'],counts:{videos:0},seasons:[]}} mediaIndex={{libraries:{}}} onBack={()=>{}} setActiveLibrary={()=>{}} watchlist={[]} setWatchlist={()=>{}} requests={[]} setRequests={()=>{}} tvLibraryAppearance={{backgroundImage:landscape,backgroundOpacity:.45,backgroundBlur:7,detailPanelOpacity:.3,detailPanelBlur:8,detailPosterWidth:240}}/></main><nav className="mobile-bottom-nav"><button className="mobile-bottom-nav-button">Fixture bottom navigation</button></nav></div>;
 return editing ? <RecipeWizard recipe={saved} categories={[{id:'dinner',name:'Dinner'}]} onClose={()=>setEditing(false)} onSaved={setSaved}/> : <RecipeDetailsOverlay recipe={{...saved,readOnly:mode==='readonly'}} onClose={()=>{}} onEdit={()=>setEditing(true)} onToggleFavorite={()=>{}}/>;
}
createRoot(document.getElementById('fixture-root')).render(<Fixture/>);
`;
const controls = `<!doctype html><html><head><meta charset="utf-8"><title>Homestead V1.2 responsive fixtures</title><style>body{margin:12px;font:14px system-ui;background:#18202c;color:white}button{padding:10px;margin:3px}iframe{display:block;border:1px solid #889;margin:10px 0;background:#070b12}</style></head><body>
<h1>Homestead V1.2 — synthetic responsive checks</h1>
<div id="pages">${['recipe','readonly','photo','profile','child','tv'].map(mode=>`<button data-mode="${mode}">${mode}</button>`).join('')}</div>
<div><button data-size="390,844">Portrait 390 × 844</button><button data-size="844,390">Landscape 844 × 390</button><button data-size="1365,900">Desktop 1365 × 900</button></div>
<iframe title="Homestead test viewport" width="390" height="844" src="/__mobile-v12-frame?mode=recipe"></iframe>
<script>const frame=document.querySelector('iframe');document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>frame.src='/__mobile-v12-frame?mode='+button.dataset.mode);document.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>{const [width,height]=button.dataset.size.split(',');frame.width=width;frame.height=height;});</script></body></html>`;
(async () => {
  const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), {
    name: 'mobile-v12-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/__mobile-v12-fixture.jsx') return '\0mobile-v12-fixture.jsx'; },
    load(id) { if (id === '\0mobile-v12-fixture.jsx') return transformWithOxc(fixture, 'fixture.jsx', { jsx: { runtime: 'classic' } }).then(result => result.code); },
    transform(code, id) { if (id.includes('/src/App.jsx?mobileFixture')) return code + '\nexport { ImageViewer, TVShowDetail, ProfilePage, RecipeDetailsOverlay, RecipeWizard };'; },
    configureServer(instance) { instance.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname.startsWith('/media/fixture/') || pathname === '/api/file') {
        const name = pathname === '/api/file' ? new URL(request.url, 'http://127.0.0.1').searchParams.get('path') || '' : pathname;
        if (name.includes('/fixture/')) {
          const wide = name.includes('landscape'); response.setHeader('Content-Type', 'image/svg+xml');
          response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 1600 : 900}" height="${wide ? 900 : 1200}"><rect width="100%" height="100%" fill="${wide ? '#804a30' : '#305690'}"/><text x="40" y="90" fill="white" font-size="48">Synthetic ${wide ? 'landscape' : 'portrait'}</text></svg>`); return;
        }
      }
      if (!request.url.startsWith('/__mobile-v12-frame') && request.url.split('?')[0] !== '/__mobile-v12') return next();
      const html = request.url.startsWith('/__mobile-v12-frame') ? '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Homestead fixture</title></head><body><div id="fixture-root"></div><script type="module" src="/__mobile-v12-fixture.jsx"></script></body></html>' : controls;
      response.setHeader('Content-Type','text/html'); response.end(await instance.transformIndexHtml(request.url, html));
    }); },
  }], server: { host: '127.0.0.1', port: 7377, strictPort: true } });
  await server.listen(); console.log('Synthetic mobile fixtures: http://127.0.0.1:7377/__mobile-v12');
})().catch(error => { console.error(error); process.exitCode = 1; });
