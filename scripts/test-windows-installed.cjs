const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process'); const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2]);
assert(root.toLowerCase().startsWith(path.resolve(__dirname,'../work').toLowerCase()+path.sep), 'Use an isolated installation under this repository’s work folder.'); const runtime = JSON.parse(fs.readFileSync(path.join(root,'runtime.json'),'utf8').replace(/^\uFEFF/,''));
const app = path.join(root,runtime.relativePath); const origin='http://127.0.0.1:'+runtime.port;
(async()=>{
 const p=await fetch(origin+'/api/platform').then(r=>r.json()); assert.equal(p.platform.edition,'free'); assert.equal(p.platform.installationId,runtime.instance);
 assert.equal((await fetch(origin)).status,200);
 const response=await fetch(origin+(p.platform.authEnabled?'/api/auth/login':'/api/accounts/complete-owner-setup'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'windows-test-owner',password:'isolated-preview-test-only',displayName:'Windows Test Owner'})}); assert.equal(response.status,200,await response.clone().text());
 const cookie=response.headers.get('set-cookie').split(';')[0]; const headers={'Content-Type':'application/json',cookie};
 const movies=path.join(root,'media','movies'); const movieDir=path.join(movies,'Windows Preview Test (2026)');fs.mkdirSync(movieDir,{recursive:true});
 const file=path.join(movieDir,'Windows Preview Test (2026).mp4');
 cp.execFileSync(path.join(app,'runtime-tools/ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x180:d=2','-c:v','libx264','-pix_fmt','yuv420p','-y',file],{windowsHide:true,timeout:20000});
 const defaultIcon=fs.readFileSync(path.join(app,'public','homestead-icon.png'));
 for (const route of ['/homestead-icon.png','/api/branding/icon']) { const icon=await fetch(origin+route,{headers});assert.equal(icon.status,200);assert(icon.headers.get('content-type').startsWith('image/png'));assert.deepEqual(Buffer.from(await icon.arrayBuffer()),defaultIcon); }
 assert(fs.statSync(path.join(root,'homestead.ico')).size>22);
 const customIcon=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=','base64');
 const iconSaved=await fetch(origin+'/api/branding/icon',{method:'POST',headers,body:JSON.stringify({imageData:'data:image/png;base64,'+customIcon.toString('base64')})});assert.equal(iconSaved.status,200);
 assert.deepEqual(Buffer.from(await fetch(origin+'/api/branding/icon',{headers}).then(r=>r.arrayBuffer())),customIcon);
 assert.equal((await fetch(origin+'/api/branding/icon',{method:'DELETE',headers})).status,200);
 assert.deepEqual(Buffer.from(await fetch(origin+'/api/branding/icon',{headers}).then(r=>r.arrayBuffer())),defaultIcon);
 const storagePost=async(route,folder)=>fetch(origin+'/api/setup/'+route,{method:'POST',headers,body:JSON.stringify({enabledLibraries:{movies:true},folderMappings:{movies:folder}})}).then(r=>r.json());
 const shortcut=path.join(root,'Network Shortcuts','Movies');const rejected=await storagePost('check-folders',shortcut);assert.equal(rejected.ok,false);assert.match(rejected.results[0].message,/Windows shortcut/);assert(!fs.existsSync(shortcut));
 assert.equal((await storagePost('create-folders',shortcut)).ok,false);assert(!fs.existsSync(shortcut));
 const missingFolder=path.join(root,'media','new-local-folder');if(!fs.existsSync(missingFolder)){assert.equal((await storagePost('check-folders',missingFolder)).ok,true);assert(!fs.existsSync(missingFolder));assert.equal((await storagePost('create-folders',missingFolder)).ok,true);}
 assert.equal((await storagePost('check-folders',movies)).ok,true);
 const config=await fetch(origin+'/api/setup-config',{headers}).then(r=>r.json());assert.equal(config.subscription.features.photos,true);assert.equal(config.subscription.features.adult,true);for(const feature of ['familyLibrary','liveTV','cloud','inventory','ai','externalIntegrations'])assert.equal(config.subscription.features[feature],false,feature);assert.equal(config.storage.platform,'win32');assert.equal(config.storage.folderDefaults.movies,movies);config.completed=true;config.enabledLibraries={movies:true};config.configuredEnabledLibraries={movies:true};config.folderMappings={movies:[movies]};
 const saved=await fetch(origin+'/api/setup-config',{method:'POST',headers,body:JSON.stringify(config)});assert.equal(saved.status,200,await saved.clone().text());
 const env={...process.env,NODE_ENV:'production',HOMESTEAD_DATA_DIR:path.join(root,'data'),MEDIA_ROOT:path.join(root,'media'),PATH:path.join(app,'runtime-tools')+';'+app+';'+process.env.SystemRoot+'\\System32'};
 cp.execFileSync(path.join(app,'node.exe'),[path.join(app,'scripts/scanners/scan-media.cjs'),'--library','movies'],{cwd:app,env,windowsHide:true,timeout:60000});
 const indexPath=path.join(root,'data','media-index.json');assert(fs.existsSync(indexPath));assert(!fs.existsSync(path.join(app,'data','media-index.json')));
 const index=await fetch(origin+'/data/media-index.json',{headers}).then(r=>r.json());assert(JSON.stringify(index).includes('Windows Preview Test'));
 const fileUrl=origin+'/api/file?path='+encodeURIComponent(file);const media=await fetch(fileUrl,{headers:{cookie,Range:'bytes=0-31'}});assert.equal(media.status,206,await media.clone().text());assert.equal((await media.arrayBuffer()).byteLength,32);await fetch(origin+'/api/subscription/playback',{method:'POST',headers,body:JSON.stringify({active:false})});
 const probe=await fetch(origin+'/api/media/probe?path='+encodeURIComponent(file),{headers}).then(r=>r.json());assert.equal(probe.ok,true,JSON.stringify(probe));
 assert.equal((await fetch(origin+'/api/livetv/channels',{headers})).status,402);
 fs.writeFileSync(path.join(root,'data','update-preservation.txt'),'KEEP-DATA-EXACTLY');fs.writeFileSync(path.join(root,'media','update-preservation.txt'),'KEEP-MEDIA-EXACTLY');
 fs.writeFileSync(path.join(root,'..','smoke-evidence.json'),JSON.stringify({edition:p.platform.edition,installationId:runtime.instance,originalRuntime:runtime.relativePath,owner:'windows-test-owner',file,indexPath,checks:['frontend','owner setup','bundled ffmpeg','bundled ffprobe','scanner external data','index API','media range playback','paid feature lock','default and custom icons','Windows defaults','folder access and shortcut rejection']},null,2));
 console.log('Windows installed runtime smoke checks passed: Free startup, owner setup, bundled media tools, scan, playback range, and paid-feature lock.');
})().catch(e=>{console.error(e);process.exitCode=1});
