import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let analysis;
const result = await build({root, logLevel:'error', build:{write:false}, plugins:[{
  name:'public-bundle-measurement',
  generateBundle(_options, bundle) {
    const chunks=[], owners=new Map();
    for(const chunk of Object.values(bundle)) {
      if(chunk.type!=='chunk') continue;
      const packages={};
      for(const [id,module] of Object.entries(chunk.modules)) {
        const packageName=id.replaceAll('\\','/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] || 'application';
        packages[packageName]=(packages[packageName]||0)+(module.renderedLength||0);
        if(module.renderedLength>0) owners.set(id,[...(owners.get(id)||[]),chunk.fileName]);
      }
      chunks.push({file:chunk.fileName,entry:chunk.isEntry,bytes:Buffer.byteLength(chunk.code),gzipBytesNodeLevel6:gzipSync(chunk.code).length,imports:chunk.imports,dynamicImports:chunk.dynamicImports,packagesByRenderedLength:Object.fromEntries(Object.entries(packages).sort((a,b)=>b[1]-a[1]))});
    }
    analysis={note:'Chunk bytes are final UTF-8 JS; gzip estimates use Node zlib level 6 (Vite reporter may differ); package renderedLength is source contribution, not final minified or gzip attribution.',chunks,duplicateRenderedModules:[...owners].filter(([,files])=>files.length>1).map(([id,files])=>({id:id.replaceAll('\\','/').replace(root.replaceAll('\\','/'),'$REPO'),files}))};
  }
}]});
// Read the returned output after Vite's final preload/path substitutions.
const emitted = new Map((Array.isArray(result)?result.flatMap(part=>part.output):result.output).filter(item=>item.type==='chunk').map(chunk=>[chunk.fileName,chunk.code]));
for(const chunk of analysis.chunks) { const code=emitted.get(chunk.file); chunk.bytes=Buffer.byteLength(code);chunk.gzipBytesNodeLevel6=gzipSync(code).length; }
const output=JSON.stringify(analysis,null,2)+'\n';
if(process.argv[2]) fs.writeFileSync(process.argv[2],output); else process.stdout.write(output);
