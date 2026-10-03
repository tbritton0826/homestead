const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),React=require('react');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8').replace(/\r\n/g,'\n');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const source=name=>{const start=app.indexOf('function '+name+'('),end=app.indexOf('\n}',start)+2;assert(start>=0&&end>start,name);return app.slice(start,end)};
const plain=value=>JSON.parse(JSON.stringify(value));
async function run(){
 const {createFeatureLoader}=await import('../src/utils/feature-loaders.js');
 let calls=0,resolveImport;const load=createFeatureLoader(()=>{calls++;return new Promise(resolve=>{resolveImport=resolve})});
 const first=load(),second=load();assert.equal(first,second);await tick();assert.equal(calls,1);resolveImport({default:'feature'});await first;assert.equal(load(),first,'repeat opens reuse the fulfilled module');
 let attempts=0;const retry=createFeatureLoader(async()=>{attempts++;if(attempts===1)throw Error('network');return {default:'ready'}});await assert.rejects(retry(),/network/);assert.equal((await retry()).default,'ready');assert.equal(attempts,2,'failed import is cleared, with no automatic retry loop');
 const {createProfileStartupLoader,initialStartupProfileList,mergeStartupProfileList}=await import('../src/utils/profile-startup.js');
 const initial=['a','b','c','d'].map(id=>({id,name:id,metadata:{bio:'',height:''},_startupPending:true}));
 let indexCalls=0,order=[],gates={},active=0,maximum=0,firstSubscriber=0,snapshots=[];
 const startup=createProfileStartupLoader({loadIndex:async()=>{indexCalls++;return {libraries:{}}},prepare:()=>({personal:{initial,hydrate:async id=>{order.push(id);active++;maximum=Math.max(maximum,active);await new Promise(resolve=>{gates[id]=resolve});active--;return {id,name:id.toUpperCase(),metadata:{bio:'loaded '+id,height:'170'}}}}}),concurrency:1});
 const unsubscribe=startup.subscribe(()=>firstSubscriber++);unsubscribe();startup.subscribe(snapshot=>snapshots.push(snapshot));await tick();
 assert.equal(indexCalls,1,'StrictMode subscription replay shares the index request');assert.equal(firstSubscriber,0,'disposed subscribers receive no late publication');assert.equal(snapshots[0].lists.personal.length,4,'all indexed names publish before metadata completes');assert.equal(snapshots[0].pending,4);assert.deepEqual(order,['a']);
 startup.prioritize('personal','d');gates.a();await tick();assert.deepEqual(order,['a','d'],'selected pending profile runs next');gates.d();await tick();gates.b();await tick();gates.c();const complete=await startup.finished;
 assert.equal(maximum,1);assert.deepEqual(complete.lists.personal.map(p=>p.id),['a','b','c','d'],'priority does not reorder the list');assert(complete.lists.personal.every(p=>!p._startupPending));assert.equal(complete.pending,0);assert.equal(snapshots.length,3,'initial, selected profile, and completed library publish; intermediate rows stay deferred');assert.equal(new Set(order).size,4,'each profile is hydrated once');
 // React may evaluate queued state updaters after the subscriber has returned.
 const subscriberSource=app.slice(app.indexOf('  let initialized = false;\n  return loader.subscribe'),app.indexOf('}, [sessionUser?.id]);',app.indexOf('  let initialized = false;\n  return loader.subscribe')));
 const queued={personal:[],celebrities:[],performers:[]};let subscriber;
 vm.runInNewContext('(function(){'+subscriberSource+'})()', {loader:{subscribe:fn=>(subscriber=fn,()=>{}),getProfile:()=>null},setMediaIndex(){},setPeople:fn=>queued.personal.push(fn),setCelebrities:fn=>queued.celebrities.push(fn),setPerformers:fn=>queued.performers.push(fn),setSelected(){},initialStartupProfileList,mergeStartupProfileList,console});
 subscriber({index:{},initial:{personal:initial,celebrities:[],performers:[]},lists:{personal:initial,celebrities:[],performers:[]}});
 assert.equal(queued.personal[0]([]).length,4,'deferred initial updater retains its publication phase');
 const edited={...initial[1],metadata:{...initial[1].metadata,bio:'my edit'}};
 const current=[initial[0],edited,initial[3],{id:'new',name:'created'}];const merged=mergeStartupProfileList(current,initial,complete.lists.personal);
 assert.deepEqual(merged.map(p=>p.id),['a','b','d','new'],'deleted profiles are not resurrected and new profiles survive');assert.equal(merged[1].metadata.bio,'my edit');assert.equal(merged[1].metadata.height,'170');assert(!merged[1]._startupPending);assert.equal(current[1].metadata.height,'');
 assert.equal(mergeStartupProfileList(merged,initial,complete.lists.personal),merged,'completed publication does not create new references');
 assert.equal(initialStartupProfileList([],initial),initial);assert.equal(initialStartupProfileList([{id:'a',name:'new name'}],initial)[0].name,'new name');
 const aliasIncoming=complete.lists.personal.map((p,i)=>i===0?{...p,id:'canonical-a'}:p);assert.equal(mergeStartupProfileList(initial,initial,aliasIncoming)[0].id,'canonical-a','canonical identity semantics are retained');
 let concurrent=0,maxConcurrent=0;const bounded=createProfileStartupLoader({loadIndex:async()=>({}),prepare:()=>({personal:{initial,hydrate:async id=>{concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await tick();concurrent--;return {id}}}}),concurrency:2});bounded.subscribe(()=>{});await bounded.finished;assert.equal(maxConcurrent,2);
 const fail=createProfileStartupLoader({loadIndex:async()=>{throw Error('offline')},prepare:()=>({})});fail.subscribe(()=>{});assert.match((await fail.finished).error.message,/offline/);

 // Run the real measured Music declarations with persistent hook-cache semantics.
 const begin=app.indexOf('  const musicMatchIndex ='),end=app.indexOf('const normalizeMusicTrack =',begin),music=app.slice(begin,end);
 let memos=[],cursor=0,normalizations=0,matchReads=0,matchIndex={};
 const files=[{name:'01 First.mp3',path:'/media/music/Artist/Album/CD1/01 First.mp3',type:'audio',metadata:{artist:'Artist',album:'Album',title:'First',disc:1,track:1}},{name:'01 First.mp4',path:'/media/music/Artist/Album/CD1/01 First.mp4',type:'video'},{name:'01 First.lrc',path:'/media/music/Artist/Album/CD1/01 First.lrc',type:'lyrics'},{name:'02 Second.mp3',path:'/media/music/Artist/Album/CD2/02 Second.mp3',type:'audio',metadata:{artist:'Artist',album:'Album',title:'Second',disc:2,track:2}},{name:'cover.jpg',path:'/media/music/Artist/Album/cover.jpg',type:'image'}];
 const library={artist:{id:'artist',name:'Artist',poster:'/local.jpg',files}};
 const context={scannedMusic:library,metadataMatchesVersion:1,lidarrArtistArtwork:{Artist:{hasLocalPoster:true,localPoster:'/local.jpg',lidarr:{poster:'/provider.jpg'}}},lidarrAlbumArtwork:{},musicArtworkPriority:'lidarr',musicMetadataRevision:0,
  useMemo:(fn,deps)=>{const i=cursor++;if(!memos[i]||deps.some((dep,j)=>!Object.is(dep,memos[i].deps[j])))memos[i]={deps,value:fn()};return memos[i].value},useEffect:()=>{},loadHomesteadMetadataMatches:()=>{matchReads++;return matchIndex},getHomesteadMetadataMatchFromIndex:(index,library,item)=>index[typeof item==='object'?item.id:item],getLocalApiFileUrl:value=>value||'',getPlayableMediaUrl:file=>file.path||'',console};
 for(const name of ['cleanMusicTrackTitle','getMusicAlbumKey','getAlphabetSortValue','findLocalMusicAlbumArtwork','normalizeLocalMusicSong']) vm.runInNewContext(source(name),context);
 const normalize=context.normalizeLocalMusicSong;context.normalizeLocalMusicSong=(...args)=>{normalizations++;return normalize(...args)};
 const derive=()=>{cursor=0;return vm.runInNewContext('(function(){'+music+';return {baseSongs,artists,songs,albumGroups,artistGroups};})()',context)};
 const firstMusic=derive();for(let i=0;i<10;i++)assert.equal(derive().artistGroups,firstMusic.artistGroups,'unrelated rerenders retain derived artist objects');assert.equal(normalizations,2);assert.equal(matchReads,1);
 assert.equal(firstMusic.artistGroups[0].songCount,2);assert.equal(firstMusic.artistGroups[0].videoCount,1);assert.equal(firstMusic.baseSongs[0].lyricsFile.name,'01 First.lrc');assert.equal(firstMusic.baseSongs[0].localAlbumArtwork,'/media/music/Artist/Album/cover.jpg');assert.equal(firstMusic.songs[1].discNumber,2);assert.deepEqual(plain(firstMusic.artists),['Artist']);
 context.musicArtworkPriority='local';const local=derive();assert.equal(local.artistGroups[0].poster,'/local.jpg');assert.equal(normalizations,2,'artwork priority does not normalize tracks again');
 context.lidarrArtistArtwork={Artist:{lidarr:{poster:'/new-provider.jpg'}}};context.musicArtworkPriority='lidarr';assert.equal(derive().artistGroups[0].poster,'/new-provider.jpg');assert.equal(normalizations,2);
 matchIndex={artist:{artworkOverrides:{gridPoster:'/fixed.jpg'}},['track:'+files[0].path]:{title:'Corrected track'}};context.metadataMatchesVersion++;const refreshed=derive();assert.equal(refreshed.artistGroups[0].poster,'/fixed.jpg');assert.equal(refreshed.songs[0].title,'Corrected track');assert.equal(normalizations,4,'metadata revision invalidates normalization');
 context.scannedMusic={...library,second:{id:'second',name:'Other',files:[{name:'song.mp3',path:'/media/music/Other/song.mp3',type:'audio',metadata:{artist:'Other',title:'Other track'}}]}};assert.equal(derive().artists.length,2,'source changes refresh totals');

 // Execute the actual scanner path while import/device work is deferred.
 const cameraSource=app.slice(app.indexOf('async function startCameraScanner()'),app.indexOf('async function decodeBarcodePhoto(',app.indexOf('async function startCameraScanner()')));
 async function cameraCase({cancel=false,reject=false,earlyScan=false}={}) {
  let task,resolveLoad,rejectLoad,constructors=0,stopped=0,codes=[],status=[];
  const generation={current:0};class Reader {constructor(){constructors++}async decodeFromVideoDevice(_device,_video,callback){if(earlyScan)await callback({getText:()=> 'fixture-code'});return {stop(){stopped++}}}}
  const sandbox={capabilities:{camera:true},scannerGeneration:generation,stopCamera:()=>generation.current++,setMode(){},setStatus:value=>status.push(value),setScannerLoadError(){},setCameraActive(){},setScanContinuous(){},window:{setTimeout:fn=>(task=fn,1),isSecureContext:true},videoRef:{current:{}},zxingReaderRef:{current:null},zxingControlsRef:{current:null},setCode:value=>codes.push(value),resolveCode:async()=>{},loadBarcodeReader:()=>new Promise((resolve,rejectFn)=>{resolveLoad=resolve;rejectLoad=rejectFn})};
  const start=vm.runInNewContext('(function(){'+cameraSource+';return startCameraScanner})()',sandbox);await start();const pending=task();if(cancel)generation.current++;if(reject)rejectLoad(Error('offline'));else resolveLoad({BrowserMultiFormatReader:Reader});await pending;
  if(cancel){assert.equal(constructors,0);assert.equal(status.length,1,'cancelled import cannot set stale status')}else if(reject){assert(status.at(-1).includes('could not start'))}else {assert.equal(constructors,1);if(earlyScan){assert.deepEqual(codes,['fixture-code']);assert.equal(stopped,1,'a scan before device setup finishes still stops its controls')}}
 }
 await cameraCase();await cameraCase({cancel:true});await cameraCase({cancel:true,reject:true});await cameraCase({reject:true});await cameraCase({earlyScan:true});

 // The actual reader must not construct a book after closing during module download.
 const {transformWithOxc}=await import('vite');const readerCode=await transformWithOxc(source('BookReader'),'reader.jsx',{jsx:{runtime:'classic'}});
 async function readerCase({cancel=false,reject=false,pdf=false}={}) {
  let effects=[],states=[],resolveLoad,rejectLoad,imports=0,books=0,destroyed=0;
  const book={ready:Promise.resolve(),renderTo:()=>({display:async()=>{},on(){},destroy(){}}),locations:{generate:async()=>{}},destroy(){destroyed++}};
  const sandbox={React,useRef:()=>({current:{}}),useState:initial=>[initial,value=>states.push(value)],useEffect:fn=>effects.push(fn),getPlayableMediaUrl:()=>'/fixture.epub',getWatchProgress:()=>({}),saveWatchProgress(){},window:{addEventListener(){},removeEventListener(){}},loadEpub:()=>{imports++;return new Promise((resolve,rejectFn)=>{resolveLoad=()=>resolve({default:()=>{books++;return book}});rejectLoad=()=>rejectFn(Error('reader offline'))})}};
  const Reader=vm.runInNewContext(readerCode.code+'; BookReader',sandbox);Reader({file:{name:pdf?'fixture.pdf':'fixture.epub',path:'/fixture'},book:{id:'fixture'},onClose(){}});const cleanup=effects[0]();if(cancel)cleanup();if(reject)rejectLoad();else resolveLoad?.();await tick();
  if(pdf)assert.equal(imports,0,'PDF does not download EPUB');else if(cancel)assert.equal(books,0);else if(reject)assert(states.includes('reader offline'));else assert.equal(books,1);
  if(!cancel)cleanup?.();if(books)assert.equal(destroyed,1);
 }
 await readerCase();await readerCase({cancel:true});await readerCase({reject:true});await readerCase({pdf:true});

 // Exercise the actual HLS effect through deferred imports, cancellation, native HLS and failure.
 const code=await transformWithOxc(source('LiveTvPlayer'),'player.jsx',{jsx:{runtime:'classic'}});
 async function playerCase({native=false,reject=false,cancel=false}={}){
  let effects=[],states=[],importCalls=0,constructors=0,attached=0,destroyed=0,resolveModule,callbacks={},timers=[];
  const video={canPlayType:()=>native?'probably':'',play:async()=>{},pause(){},removeAttribute(){},load(){}};
  class Hls{static isSupported(){return true}static Events={ERROR:'error',MEDIA_ATTACHED:'attached'};constructor(){constructors++}on(event,fn){callbacks[event]=fn}attachMedia(){attached++;callbacks.attached()}loadSource(url){assert(url.startsWith('/api/livetv/proxy?url='))}destroy(){destroyed++}}
  const sandbox={React,useRef:()=>({current:video}),useState:initial=>[typeof initial==='function'?initial():initial,value=>states.push(value)],useEffect:fn=>effects.push(fn),loadHls:()=>{importCalls++;return new Promise((resolve,rejectFn)=>{resolveModule=()=>reject?rejectFn(Error('chunk unavailable')):resolve({default:Hls})})},window:{setInterval:()=>1,clearInterval(){}},setTimeout:fn=>(timers.push(fn),1),clearTimeout(){},btoa:value=>Buffer.from(value).toString('base64'),unescape,encodeURIComponent,console:{log(){},warn(){}},formatPlaybackClock:()=>''};
  const Player=vm.runInNewContext(code.code+'; LiveTvPlayer',sandbox);Player({channel:{name:'Test',url:'http://localhost/test.m3u8'}});const stopClock=effects[0](),cleanup=effects[1]();if(cancel)cleanup();if(resolveModule)resolveModule();await tick();
  if(native){assert.equal(importCalls,0);assert(video.src)}else if(cancel){assert.equal(constructors,0,'late module cannot attach after unmount')}else if(reject){assert(states.some(value=>String(value).includes('could not')));assert.equal(timers.length,0)}else{assert.equal(constructors,1);assert.equal(attached,1)}
  if(!cancel)cleanup();stopClock();if(constructors)assert.equal(destroyed,1);
 }
 await playerCase();await playerCase({native:true});await playerCase({cancel:true});await playerCase({reject:true});
 console.log('Lazy-loader coalescing/retry, startup index/enrichment/priority/edit safety, Music cache/data/artwork semantics, EPUB deferred/PDF/failure, scanner cancellation, and HLS native/cancellation/failure: PASSED');
}
run().catch(error=>{console.error(error);process.exitCode=1});
