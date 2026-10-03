import http from 'node:http';
import fs from 'node:fs';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
// Run against a separate disposable checkout server on port 7313. Never proxy a live installation.

const baselineSource=process.env.HOMESTEAD_PROFILE_APP_SOURCE ? fs.readFileSync(process.env.HOMESTEAD_PROFILE_APP_SOURCE,'utf8') : null;
const productionDist=process.env.HOMESTEAD_PROFILE_DIST ? path.resolve(process.env.HOMESTEAD_PROFILE_DIST) : null;
const counts={movies:2000,tv:1000,books:500,music:500};
const libraries={};
for(const [library,count] of Object.entries(counts)) {
 libraries[library]=Object.fromEntries(Array.from({length:count},(_,i)=>{
  const id=`profile-${library}-${i}`; const title=`${String.fromCharCode(65+i%26)} Sample ${library} ${String(i).padStart(5,'0')}`;
  return [id,{id,name:title,title,artist:title,poster:`/media/profiling/art/${library}/${i}.jpg`,metadata:{title,year:String(2000+i%25),genres:[i%2?'Drama':'Comedy'],authors:['Sample Author'],artist:title,description:'Synthetic local profiling record'},files:[{name:'sample.'+(library==='books'?'epub':library==='music'?'mp3':'mp4'),path:'/media/profiling/'+id+'.mp4',type:library==='books'?'ebook':library==='music'?'audio':'video',artist:title,album:'Sample Album',title:'Sample Song'}],counts:{videos:1},seasons:[],albums:{},episodes:[]}];
 }));
}
const profileCount=Number(process.env.HOMESTEAD_PROFILE_PROFILES || 0);
for(const library of ['personal','celebrities','performers']) libraries[library]=Object.fromEntries(Array.from({length:profileCount},(_,i)=>{const id='fixture-'+library+'-'+i;return [id,{id,name:'Fixture '+library+' '+i,profileDir:'/media/'+library+'/'+id,metadataPath:'/media/'+library+'/'+id+'/metadata.json'}]}));
const youtube={creators:Object.fromEntries(Array.from({length:300},(_,i)=>[`creator-${i}`,{id:`creator-${i}`,name:`Creator ${i}`,poster:`/media/profiling/art/youtube/${i}.jpg`,videos:[]} ])),series:{}};
libraries.youtube=youtube.creators;
const perfScript=`(() => {
 let stats; const fresh=()=>({renders:{},commits:[],longTasks:[],inputs:[],frames:[],writes:0,started:performance.now(),work:{},profileLists:{},gridFirstMs:null}); stats=fresh();
 performance.setResourceTimingBufferSize(10000);
 window.__profileSpan=(name,ms)=>{(stats.work[name]||= []).push(ms)};
 window.__profileLists=lists=>{for(const [name,count] of Object.entries(lists))if(count && !stats.profileLists[name])stats.profileLists[name]={count,firstMs:Math.round(performance.now()-stats.started)}};
 window.__profileRender=name=>{stats.renders[name]=(stats.renders[name]||0)+1;};
 window.__profileCommit=(id,phase,duration)=>{stats.commits.push(duration);};
 const write=Storage.prototype.setItem; Storage.prototype.setItem=function(...args){stats.writes++;return write.apply(this,args);};
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())stats.longTasks.push(e.duration);}).observe({type:'longtask',buffered:true});}catch{}
 document.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>stats.inputs.push(performance.now()-start));},true);
 let previous=performance.now(); const frame=t=>{const delta=t-previous;previous=t;if(delta<2000)stats.frames.push(delta);requestAnimationFrame(frame);};requestAnimationFrame(frame);
 const readyObserver=new MutationObserver(()=>{if(stats.gridFirstMs==null && document.querySelector('.movie-library-grid')){stats.gridFirstMs=Math.round(performance.now()-stats.started);readyObserver.disconnect()}});readyObserver.observe(document.documentElement,{childList:true,subtree:true});
 const install=()=>{const panel=document.createElement('details');panel.style='position:fixed;bottom:0;left:0;z-index:999999;background:#111;color:#fff;max-height:35vh;overflow:auto;font:12px monospace';panel.innerHTML='<summary>Local synthetic profiling</summary><button id="profile-reset">Reset measurements</button><pre id="profile-stats"></pre>';document.body.append(panel);document.getElementById('profile-reset').onclick=()=>{stats=fresh();};setInterval(()=>{const summary=a=>{const s=[...a].sort((a,b)=>a-b);return {count:s.length,total:Math.round(s.reduce((a,b)=>a+b,0)),p95:Math.round(s[Math.floor(s.length*.95)]||0),max:Math.round(s.at(-1)||0)};};const imgs=[...document.querySelectorAll('.tv-grid img,.book-grid img,.music-grid img,.youtube-grid img')];document.getElementById('profile-stats').textContent=JSON.stringify({renders:stats.renders,reactMs:summary(stats.commits),longTasksMs:summary(stats.longTasks),inputToFrameMs:summary(stats.inputs),frameMs:summary(stats.frames),workMs:Object.fromEntries(Object.entries(stats.work).map(([name,values])=>[name,summary(values)])),profileLists:stats.profileLists,profileRequests:performance.getEntriesByType("resource").filter(e=>e.name.includes("fixture-")&&(e.name.includes("metadata")||e.name.includes("profiles/metadata"))).length,gridFirstMs:stats.gridFirstMs,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:Math.round(e.startTime)})),scripts:performance.getEntriesByType('resource').filter(e=>e.name.split('?')[0].endsWith('.js')).map(e=>({url:e.name.split('/').at(-1),encodedBytes:e.encodedBodySize})),storageWrites:stats.writes,domNodes:document.querySelectorAll('*').length,gridImages:imgs.length,loadedImages:imgs.filter(i=>i.complete&&i.naturalWidth).length,artRequests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/media/profiling/art/')).length},null,2);},500);};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install):install();})();`;
const plugin={name:'public-ui-profile',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/App.jsx') && baselineSource) code=baselineSource;
 if(id.endsWith('/src/App.jsx')) code=code.replace(/\r\n/g,'\n');
 if(id.endsWith('/src/App.jsx')) for(const name of ['HomesteadApp','MoviesPage','TVShowsPage','BooksPage','MusicPage','YouTubePage','MediaLibraryAppearanceStudio','MovieDetail','normalizeLocalMusicSong','buildOwnedSearchArtwork','GlobalSearchResults']) code=code.replace(new RegExp('(function '+name+'\\([^\\n]*\\) \\{)'),`$1 window.__profileRender?.('${name}');`);
 if(id.endsWith('/src/App.jsx')) {
  const span=(begin,end,name)=>{code=code.replace(begin,'const __'+name+'Start=performance.now();\n'+begin).replace(end,'window.__profileSpan?.("'+name+'",performance.now()-__'+name+'Start);\n'+end)};
  span('  const musicMatchIndex =','const normalizeMusicTrack =','musicDerivation');
  span('const searchCorpusActive =','useEffect(() => {\n  if (!searchText) {','searchCorpus');
  code=code.replace('function isLibraryEnabled(libraryId)', 'window.__profileLists?.({personal:people.length,celebrities:celebrities.length,performers:performers.length,personalEnriched:people.length && people.every(p=>!p._startupPending)?people.length:0,celebritiesEnriched:celebrities.length && celebrities.every(p=>!p._startupPending)?celebrities.length:0,performersEnriched:performers.length && performers.every(p=>!p._startupPending)?performers.length:0});\nfunction isLibraryEnabled(libraryId)');
 }
 if(id.endsWith('/src/main.jsx')) code=code.replace("import { StrictMode }", "import { StrictMode, Profiler }").replace('<App />','<Profiler id="App" onRender={(...args)=>window.__profileCommit?.(...args)}><App /></Profiler>');
 if(id.endsWith('/src/App.jsx')) code+='\nexport { BookReader, LiveTvPlayer };';
 return code;
 },transformIndexHtml(html){return html.replace('</head>',`<script>${perfScript}</script></head>`);}};
const vite=productionDist?null:await createServer({root,server:{middlewareMode:true,hmr:false},plugins:[plugin]});
let failNextFeature = false;
const fixtureDirectory=process.env.HOMESTEAD_PROFILE_FIXTURES;
const {default:JSZip}=await import('jszip');
const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');zip.file('content.opf','<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Startup reader fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');zip.file('chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body><h1>Startup reader fixture</h1><p>A local EPUB verifies first-use loading and reopening.</p></body></html>');const fixtureEpub=await zip.generateAsync({type:'nodebuffer'});
const {QRCodeWriter,BarcodeFormat}=await import('@zxing/library');const {default:sharp}=await import('sharp');
const qr=new QRCodeWriter().encode('fixture-code',BarcodeFormat.QR_CODE,256,256,new Map());const pixels=Buffer.alloc(256*256);for(let y=0;y<256;y++)for(let x=0;x<256;x++)pixels[y*256+x]=qr.get(x,y)?0:255;const fixtureCode=await sharp(pixels,{raw:{width:256,height:256,channels:1}}).png().toBuffer();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__profile/fail-next' && req.method==='POST'){failNextFeature=true;res.end('armed');return;}
 if(failNextFeature && /src\/components\/(CalendarView|ModelViewer)\.jsx$/.test(url.pathname)){failNextFeature=false;res.statusCode=503;res.end('Deliberate fixture import failure');return;}
 if(url.pathname==='/__feature-check'){res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script type="module" src="/scripts/profile-feature-safety.jsx"></script></body></html>');return;}
 const mediaPath=url.pathname==='/api/file'?url.searchParams.get('path'):url.pathname;
 if(mediaPath==='/media/profiling/fixture-code.png'){res.setHeader('Content-Type','image/png');res.end(fixtureCode);return;}
 if(mediaPath==='/media/profiling/fixture.epub'){res.setHeader('Content-Type','application/epub+zip');res.end(fixtureEpub);return;}
 if(mediaPath==='/media/profiling/fixture.stl'){res.setHeader('Content-Type','text/plain');res.end('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 30 0 0\nvertex 0 30 0\nendloop\nendfacet\nendsolid fixture');return;}
 if(url.pathname==='/api/livetv/proxy' && fixtureDirectory && Buffer.from(url.searchParams.get('url')||'','base64url').toString().includes('/media/profiling/fixture.m3u8')){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(fs.readFileSync(path.join(fixtureDirectory,'fixture.m3u8'),'utf8').replace(/fixture\d+\.ts/g,name=>'/media/profiling/'+name));return;}
 if(fixtureDirectory && /^\/media\/profiling\/fixture\d+\.ts$/.test(url.pathname)){res.setHeader('Content-Type','video/mp2t');res.end(fs.readFileSync(path.join(fixtureDirectory,path.basename(url.pathname))));return;}
 if((url.pathname==='/api/profiles/metadata' && url.searchParams.get('profileId')?.startsWith('fixture-')) || (url.pathname.includes('/fixture-') && url.pathname.includes('metadata'))) {
  const id=url.searchParams.get('profileId') || url.pathname.split('/').find(part=>part.startsWith('fixture-'));
  const library=id.split('-')[1];const i=id.split('-').at(-1);
  await new Promise(resolve=>setTimeout(resolve,80));res.setHeader('Content-Type','application/json');
  const profile={id,name:'Fixture '+library+' '+i,library,metadata:{bio:'Enriched synthetic profile '+i}};
  res.end(JSON.stringify(url.pathname.startsWith('/api/')?{ok:true,profile}:url.pathname.includes('candidates')?{}:profile));return;
 }
 if(url.pathname==='/data/media-index.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({libraries}));return;}
 if(url.pathname==='/data/youtube-index.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(youtube));return;}
 if((url.pathname.startsWith('/media/profiling/art/') || url.pathname==='/placeholder-poster.jpg' || url.pathname==='/placeholder-banner.jpg' || (url.pathname==='/api/file' && url.searchParams.get('path')?.startsWith('/media/profiling/art/')))){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(root+'/public/homestead-icon.png'));return;}
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/data/')||url.pathname.startsWith('/media/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const upstream=await fetch('http://127.0.0.1:7313'+req.url,{method:req.method,headers:{'Content-Type':req.headers['content-type']||'application/json','X-Homestead-Device-Id':req.headers['x-homestead-device-id']||''},...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');
  if(url.pathname==='/api/setup-config'&&req.method==='GET'){const config=await upstream.json();res.end(JSON.stringify({...config,completed:true,serverName:'Homestead · synthetic profiling',familySublibraries:{...config.familySublibraries,calendar:true},enabledLibraries:{home:true,media:true,movies:true,tv:true,tvshows:true,books:true,music:true,youtube:true,photos:true,family:true,liveTV:true}}));}
  else res.end(Buffer.from(await upstream.arrayBuffer()));return;
 }
 if(productionDist){
  const requested=path.resolve(productionDist,'.'+decodeURIComponent(url.pathname));
  if(requested.startsWith(productionDist+path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile()){res.setHeader('Content-Type',requested.endsWith('.js')?'application/javascript':requested.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(requested));return;}
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(path.join(productionDist,'index.html'),'utf8').replace('</head>', '<script>'+perfScript+'</script></head>'));return;
 }
 vite.middlewares(req,res);
});
server.listen(7314,'127.0.0.1',()=>console.log('Synthetic UI profile: http://localhost:7314/?library=movies'));
