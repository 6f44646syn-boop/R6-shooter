import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo = process.env.RECOIL_REPO;
for (const [name, root] of [['baseline',join(repo,'..','m6-baseline')], ['feature',repo]]) {
  const source = readFileSync(join(root,'tests/run.mjs'),'utf8').replaceAll('\r\n','\n');
  const start = source.indexOf('  /* ---------- stairs, upper floors');
  const end = source.indexOf('\n  }',start)+4;
  if (start < 0 || end < start) throw new Error('Section not found');
  const header = source.slice(0,source.indexOf('try {\n  /* ---------- 1.'));
  const section = source.slice(start,end)
    .replace("const B = R.battle(), h = B.humans[0];","const B = R.battle(), h = B.humans[0]; const spawn = [h.f.x,h.f.z,h.f.y];")
    .replace('want: topB, y: h.f.y, t:', 'want: topB, y: h.f.y, spawn, t:')
    .replace('    check(\'Battle uses', '    console.log(JSON.stringify(ph.battleTop));\n    check(\'Battle uses');
  writeFileSync(new URL(name+'-stairs.mjs',import.meta.url),header.replace('../tools/serve.mjs',pathToFileURL(join(root,'tools/serve.mjs')).href).replace('8123','8197')+'try { for(let trial=0;trial<8;trial++){\n'+section+'\n} } finally { await browser.close(); server.close(); }\n');
}
