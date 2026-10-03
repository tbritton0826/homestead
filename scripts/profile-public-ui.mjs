import http from 'node:http';
import fs from 'node:fs';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
// Run against a separate disposable checkout server on port 7313. Never proxy a live installation.

const baselineSource=process.env.HOMESTEAD_PROFILE_APP_SOURCE ? fs.readFileSync(process.env.HOMESTEAD_PROFILE_APP_SOURCE,'utf8') : null;
const counts={movies:2000,tv:1000,books:500,music:500};
const libraries={};
for(const [library,count] of Object.entries(counts)) {
 libraries[library]=Object.fromEntries(Array.from({length:count},(_,i)=>{
  const id=`profile-${library}-${i}`; const title=`${String.fromCharCode(65+i%26)} Sample ${library} ${String(i).padStart(5,'0')}`;
  return [id,{id,name:title,title,artist:title,poster:`/media/profiling/art/${library}/${i}.jpg`,metadata:{title,year:String(2000+i%25),genres:[i%2?'Drama':'Comedy'],authors:['Sample Author'],artist:title,description:'Synthetic local profiling record'},files:[{name:'sample.'+(library==='books'?'epub':library==='music'?'mp3':'mp4'),path:'/media/profiling/'+id+'.mp4',type:library==='books'?'ebook':library==='music'?'audio':'video',artist:title,album:'Sample Album',title:'Sample Song'}],counts:{videos:1},seasons:[],albums:{},episodes:[]}];
 }));
}
const youtube={creators:Object.fromEntries(Array.from({length:300},(_,i)=>[`creator-${i}`,{id:`creator-${i}`,name:`Creator ${i}`,poster:`/media/profiling/art/youtube/${i}.jpg`,videos:[]} ])),series:{}};
libraries.youtube=youtube.creators;
const perfScript=`(() => {
 let stats; const fresh=()=>({renders:{},commits:[],longTasks:[],inputs:[],frames:[],writes:0,started:performance.now()}); stats=fresh();
 window.__profileRender=name=>{stats.renders[name]=(stats.renders[name]||0)+1;};
 window.__profileCommit=(id,phase,duration)=>{stats.commits.push(duration);};
 const write=Storage.prototype.setItem; Storage.prototype.setItem=function(...args){stats.writes++;return write.apply(this,args);};
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())stats.longTasks.push(e.duration);}).observe({type:'longtask',buffered:true});}catch{}
 document.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>stats.inputs.push(performance.now()-start));},true);
 let previous=performance.now(); const frame=t=>{const delta=t-previous;previous=t;if(delta<2000)stats.frames.push(delta);requestAnimationFrame(frame);};requestAnimationFrame(frame);
 const install=()=>{const panel=document.createElement('details');panel.style='position:fixed;bottom:0;left:0;z-index:999999;background:#111;color:#fff;max-height:35vh;overflow:auto;font:12px monospace';panel.innerHTML='<summary>Local synthetic profiling</summary><button id="profile-reset">Reset measurements</button><pre id="profile-stats"></pre>';document.body.append(panel);document.getElementById('profile-reset').onclick=()=>{stats=fresh();};setInterval(()=>{const summary=a=>{const s=[...a].sort((a,b)=>a-b);return {count:s.length,total:Math.round(s.reduce((a,b)=>a+b,0)),p95:Math.round(s[Math.floor(s.length*.95)]||0),max:Math.round(s.at(-1)||0)};};const imgs=[...document.querySelectorAll('.tv-grid img,.book-grid img,.music-grid img,.youtube-grid img')];document.getElementById('profile-stats').textContent=JSON.stringify({renders:stats.renders,reactMs:summary(stats.commits),longTasksMs:summary(stats.longTasks),inputToFrameMs:summary(stats.inputs),frameMs:summary(stats.frames),storageWrites:stats.writes,domNodes:document.querySelectorAll('*').length,gridImages:imgs.length,loadedImages:imgs.filter(i=>i.complete&&i.naturalWidth).length,artRequests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/media/profiling/art/')).length},null,2);},500);};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',install):install();})();`;
const plugin={name:'public-ui-profile',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/App.jsx') && baselineSource) code=baselineSource;
 if(id.endsWith('/src/App.jsx')) for(const name of ['HomesteadApp','MoviesPage','TVShowsPage','BooksPage','MusicPage','YouTubePage','MediaLibraryAppearanceStudio','MovieDetail']) code=code.replace(new RegExp('(function '+name+'\\([^\\n]*\\) \\{)'),`$1 window.__profileRender?.('${name}');`);
 if(id.endsWith('/src/main.jsx')) code=code.replace("import { StrictMode }", "import { StrictMode, Profiler }").replace('<App />','<Profiler id="App" onRender={(...args)=>window.__profileCommit?.(...args)}><App /></Profiler>');
 return code;
 },transformIndexHtml(html){return html.replace('</head>',`<script>${perfScript}</script></head>`);}};
const vite=await createServer({root,server:{middlewareMode:true,hmr:false},plugins:[plugin]});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/data/media-index.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({libraries}));return;}
 if(url.pathname==='/data/youtube-index.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(youtube));return;}
 if((url.pathname.startsWith('/media/profiling/art/') || url.pathname==='/placeholder-poster.jpg' || url.pathname==='/placeholder-banner.jpg' || (url.pathname==='/api/file' && url.searchParams.get('path')?.startsWith('/media/profiling/art/')))){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(root+'/public/homestead-icon.png'));return;}
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/data/')||url.pathname.startsWith('/media/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const upstream=await fetch('http://127.0.0.1:7313'+req.url,{method:req.method,headers:{'Content-Type':req.headers['content-type']||'application/json','X-Homestead-Device-Id':req.headers['x-homestead-device-id']||''},...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');
  if(url.pathname==='/api/setup-config'&&req.method==='GET'){const config=await upstream.json();res.end(JSON.stringify({...config,completed:true,serverName:'Homestead · synthetic profiling',enabledLibraries:{home:true,media:true,movies:true,tv:true,tvshows:true,books:true,music:true,youtube:true,photos:true}}));}
  else res.end(Buffer.from(await upstream.arrayBuffer()));return;
 }
 vite.middlewares(req,res);
});
server.listen(7314,'127.0.0.1',()=>console.log('Synthetic UI profile: http://localhost:7314/?library=movies'));
