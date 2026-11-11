import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const git='C:/Users/migue_2u2ek1d/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/cmd/git.exe';
const run=(...a)=>execFileSync(git,a,{maxBuffer:64*1024*1024});
const lines=ref=>run('ls-tree','-r',ref).toString().trim().split('\n').map(l=>{const [meta,path]=l.split('\t'),[mode,type,sha]=meta.split(' ');return {mode,type,sha,path};});
const known=new Set([...lines('02ba7be'),...lines('5cafaa1')].map(f=>f.sha));known.add('1f2ff24234277d9672ccb34a0d31cc3a9f320869');
fs.mkdirSync('../publish-blobs',{recursive:true});const snapshots=[];
for(const [ref,base] of [['6938f00','5cafaa1'],['993e675','6938f00'],['fee4f9e','993e675'],['4ab7a0c','fee4f9e']]){
 const old=new Map(lines(base).map(f=>[f.path,f.sha])), files=lines(ref),changes=files.filter(f=>old.get(f.path)!==f.sha),upload=[];
 for(const f of changes)if(!known.has(f.sha)){fs.writeFileSync('../publish-blobs/'+f.sha,run('cat-file','blob',f.sha));known.add(f.sha);upload.push(f.sha);}
 snapshots.push({ref,base,baseTree:run('rev-parse',base+'^{tree}').toString().trim(),tree:run('rev-parse',ref+'^{tree}').toString().trim(),message:run('show','-s','--format=%B',ref).toString().trim(),changes,upload});
}
fs.writeFileSync('../publish-plan.json',JSON.stringify(snapshots,null,2));console.log(snapshots.map(s=>({ref:s.ref,changes:s.changes.length,upload:s.upload.length})));

