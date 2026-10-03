const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
async function run() {
  const { createAppearancePreviewBuffer, appearanceNumericVariables } = await import('../src/utils/appearance-preview.js');
  const { handlePosterFallback } = await import('../src/utils/image-fallback.js');
  let commits=[], previews=[], timers=[];
  const buffer=createAppearancePreviewBuffer({ preview:changes=>previews.push({...changes}), commit:changes=>commits.push({...changes}), setTimer:fn=>(timers.push(fn),timers.length), clearTimer:()=>{} });
  buffer.change('posterWidth',192); const stale=timers.at(-1);
  buffer.hold(); buffer.change('posterWidth',250); buffer.change('panelBlur',12); stale();
  assert.equal(commits.length,0,'a canceled idle callback cannot commit during pointer dragging');
  assert.deepEqual(previews.at(-1),{posterWidth:250,panelBlur:12},'every input previews immediately');
  buffer.release(); assert.deepEqual(commits,[{posterWidth:250,panelBlur:12}],'one final changed-field commit on release');
  buffer.flush(); assert.equal(commits.length,1,'close after release cannot duplicate a commit');
  buffer.change('posterWidth',300); const canceled=timers.at(-1); buffer.cancel(); buffer.change('posterWidth',200); canceled();
  assert.equal(commits.length,1,'Reset cancels an earlier captured callback');
  timers.at(-1)(); assert.deepEqual(commits.at(-1),{posterWidth:200},'keyboard idle saves final value');
  buffer.change('gridGap',24); buffer.flush(); assert.deepEqual(commits.at(-1),{gridGap:24},'close/scope switch flushes the last field');
  assert.deepEqual(previews.at(-1),{});
  const vars=appearanceNumericVariables({posterWidth:210,detailPosterWidth:340,detailPanelBlur:7,sidebarBackgroundBlur:5});
  assert.equal(vars['--media-grid-poster-width'],'210px'); assert.equal(vars['--movie-detail-poster-width'],'340px');
  assert.equal(vars['--tv-detail-panel-blur'],'7px'); assert.equal(vars['--sidebar-background-blur'],'5px');
  let src='/missing.jpg', writes=0;
  const image={get src(){return src},set src(value){writes++;src=value},getAttribute(){return src}};
  handlePosterFallback({currentTarget:image});assert.equal(src,'/placeholder-poster.jpg');
  handlePosterFallback({currentTarget:image});assert(src.startsWith('data:image/svg+xml'));
  handlePosterFallback({currentTarget:image});assert.equal(writes,2,'missing fallback never requests itself forever');

  const { transformWithOxc }=await import('vite');
  const gridSource=fs.readFileSync(path.join(root,'src/components/ProgressiveLibraryGrid.jsx'),'utf8').replace(/import[^;]+;/,'').replace('export const','const').replace('export default function','function');
  const gridCode=await transformWithOxc(gridSource,'grid.jsx',{jsx:{runtime:'classic'}});
  let state, refIndex=0, effects=[],layouts=[],listeners={},scrolls=[],frames=[];
  const scroller={scrollTop:0,scrollHeight:2000,clientHeight:600,getBoundingClientRect:()=>({top:0}),scrollTo:value=>scrolls.push(value)};
  const refs=[{current:{closest:()=>scroller,querySelectorAll:()=>[{dataset:{alphaLetter:'Z'},closest:()=>scroller,getBoundingClientRect:()=>({top:2000})}]}},{current:{}},{current:null},{current:null}];
  let intersection, disconnected=0, observedRoot;
  class Observer {constructor(callback,options){intersection=callback;observedRoot=options.root;assert.equal(options.root,scroller.scrollHeight>scroller.clientHeight?scroller:null)} observe(){} disconnect(){disconnected++}}
  const context={React,IntersectionObserver:Observer,requestAnimationFrame:fn=>(frames.push(fn),frames.length),cancelAnimationFrame:()=>{},window:{addEventListener:(name,fn)=>{listeners[name]=fn},removeEventListener:(name)=>delete listeners[name]},
    useMemo:fn=>fn(),useState:initial=>{if(!state)state=initial;return [state,update=>{state=typeof update==='function'?update(state):update}]},
    useRef:()=>refs[refIndex++],useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>layouts.push(fn)};
  const Grid=vm.runInNewContext(gridCode.code+'; ProgressiveLibraryGrid',context);
  const items=Array.from({length:400},(_,i)=>({id:String(i),title:i<300?'A':'Z'}));
  const props={items,className:'grid',libraryId:'movies',getLetter:item=>item.title,renderItem:item=>React.createElement('button',{key:item.id},item.id)};
  let cleanups=[];
  const render=(updates={})=>{cleanups.forEach(fn=>fn?.());cleanups=[];effects=[];layouts=[];refIndex=0;const result=Grid({...props,...updates});layouts.forEach(fn=>fn());cleanups=effects.map(fn=>fn());return result;};
  let tree=render();assert.equal(tree.props.children[0].props.children.length,120);
  scroller.scrollHeight=600;tree=render();assert.equal(observedRoot,null,'mobile uses the viewport rather than its content-sized main');scroller.scrollHeight=2000;
  intersection([{isIntersecting:true}]);tree=render();assert.equal(tree.props.children[0].props.children.length,240,'scroll loads one batch');
  tree=render({items:items.map(item=>({...item,title:item.title+' updated'}))});assert.equal(tree.props.children[0].props.children.length,240,'equivalent new objects keep expanded cards while showing updated metadata');
  tree=render(); listeners['homestead-alpha-reveal']({detail:{libraryId:'other',letter:'Z'}});assert.equal(state.limit,240);
  listeners['homestead-alpha-reveal']({detail:{libraryId:'movies',letter:'Z'}});tree=render();assert.equal(tree.props.children[0].props.children.length,360,'distant jumps mount only one batch per frame');frames.at(-1)();tree=render();assert.equal(tree.props.children[0].props.children.length,400);assert.equal(scrolls.at(-1).top,1904,'jump waits for the requested card to render');
  state.limit=240;tree=render();listeners['homestead-alpha-reveal']({detail:{libraryId:'movies',letter:'Z'}});tree=render();const pendingJump=frames.at(-1);listeners['homestead-alpha-reveal']({detail:{libraryId:'movies',letter:'A'}});pendingJump();assert.equal(state.limit,360,'a newer visible-letter jump cancels the pending distant jump');
  tree=render({items:items.slice().reverse()});assert.equal(tree.props.children[0].props.children.length,120,'sort uses the new first batch immediately');assert.equal(tree.props.children[0].props.children[0].props.children,'399');
  tree=render({items:items.filter(item=>Number(item.id)<5)});assert.equal(tree.props.children[0].props.children.length,5);assert.equal(tree.props.children[1],false,'filtered totals do not require more cards');
  cleanups.forEach(fn=>fn?.());assert(disconnected>0);

  // Execute the actual memoized search declarations, including permission/source dependencies.
  const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');
  const appearance = await import('../src/utils/appearance-state.js');
  const { resolvePhotoAlbumAppearance } = await import('../src/utils/photo-appearance.js');
  const extract = name => { const start=app.indexOf('function '+name+'('), end=app.indexOf('\n}',start)+2; return app.slice(start,end); };
  const constants=app.slice(app.indexOf('const MEDIA_LIBRARY_APPEARANCE_DEFAULTS ='),app.indexOf('const MOVIE_DETAIL_APPEARANCE_DEFAULTS ='));
  const resolver=vm.runInNewContext(constants+extract('resolveUserAppearance')+'; resolveUserAppearance',appearance);
  const globals=appearance.appearanceScope('movies','','global'), lib=appearance.appearanceScope('movies'), page=appearance.appearanceScope('movies','all','page');
  let configuration=appearance.withScopedAppearanceOverrides({},globals,{posterWidth:210},'device');
  configuration=appearance.withScopedAppearanceOverrides(configuration,lib,{posterWidth:250},'device');
  configuration=appearance.withScopedAppearanceOverrides(configuration,page,{posterWidth:270},'device');
  const applied={}; const main={style:{setProperty:(key,value)=>{applied[key]=value}},querySelectorAll:()=>[]};
  const previewStart=app.indexOf('  const previewScopedAppearance ='),previewEnd=app.indexOf('\n  };',previewStart)+5;
  const previewContext={...appearance,appearanceNumericVariables,resolvePhotoAlbumAppearance,resolveUserAppearance:resolver,
    editingAppearanceScope:globals,appearanceDeviceId:'device',appearanceConfigRef:{current:configuration},activeLibrary:'movies',activeAppearancePageScope:'all',photoAppearanceAlbumId:'',libraryScrollRef:{current:main},pageContext:{},document:{querySelectorAll:()=>[]}};
  const preview=vm.runInNewContext(app.slice(previewStart,previewEnd)+'; previewScopedAppearance',previewContext);
  preview({posterWidth:300});assert.equal(applied['--media-grid-poster-width'],'270px','global preview respects explicit page geometry');
  previewContext.editingAppearanceScope=lib;preview({posterWidth:280});assert.equal(applied['--media-grid-poster-width'],'270px','library preview respects page overrides');
  previewContext.editingAppearanceScope=page;preview({posterWidth:290});assert.equal(applied['--media-grid-poster-width'],'290px');
  preview({});assert.equal(applied['--media-grid-poster-width'],'270px','discard restores resolved values');assert.equal(previewContext.appearanceConfigRef.current,configuration,'preview cannot mutate persisted React state');
  const album=appearance.appearanceScope('photos','','library','test-album');
  previewContext.activeLibrary='photos';previewContext.activeAppearancePageScope='';previewContext.photoAppearanceAlbumId='test-album';previewContext.editingAppearanceScope=album;
  preview({posterWidth:280});assert.equal(applied['--media-grid-poster-width'],'280px','album preview uses the album scope');
  assert.deepEqual(appearance.getScopedAppearanceOverrides(configuration,album,'device'),{});

  const start=app.indexOf('const searchCorpusActive ='),end=app.indexOf('\nuseEffect(() => {',start);
  const searchSource=app.slice(start,end).replace(/\r\n/g,'\n');assert(end>start);
  let memos=[],memoIndex=0,artworkCalls=0;
  const index={libraries:{movies:{one:{id:'one',name:'First Movie'}},tv:{two:{id:'two',name:'Second Show'}}}};
  const sandbox={searchOpen:true,searchText:'first',mediaIndex:index,searchMetadataMatches:{},inventorySearchItems:[],pluginSearchResults:[],people:[],performers:[],celebrities:[],canSearchMovies:true,canSearchTv:true,canSearchBooks:false,canSearchMusic:false,canSearchYoutube:false,canSearchAdult:false,getOwnedStatus:()=> 'owned',buildOwnedSearchArtwork:()=>{artworkCalls++;return {poster:'poster.jpg'}},getProfilePosterCandidates:()=>[],normalizePosterCandidate:()=>'',
    useMemo:(fn,deps)=>{const i=memoIndex++;if(!memos[i]||deps.some((dep,j)=>!Object.is(dep,memos[i].deps[j])))memos[i]={deps,value:fn()};return memos[i].value}};
  const search=()=>{memoIndex=0;return vm.runInNewContext('(function(){'+searchSource+';return searchResults;})()',sandbox)};
  assert.equal(search()[0].id,'one');assert.equal(artworkCalls,2);
  sandbox.searchText='second';assert.equal(search()[0].id,'two');assert.equal(artworkCalls,2,'typing reuses artwork and normalized records');
  sandbox.canSearchTv=false;assert.equal(search().length,0,'permission changes invalidate the corpus');
  sandbox.mediaIndex={libraries:{movies:{three:{id:'three',name:'Second New Movie'}}}};assert.equal(search()[0].id,'three','metadata/source updates invalidate the corpus');
  sandbox.searchText='';assert.equal(search().length,0);
  console.log('Public UI live preview/release/idle/Reset timers, safe poster fallback, grid batches/alpha/sort/filters, and search cache invalidation: PASSED');
}
run().catch(error=>{console.error(error);process.exitCode=1});
