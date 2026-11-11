import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const s=fs.readFileSync('tests/run.mjs','utf8');
const head=s.slice(0,s.indexOf('try {\n  /* ---------- 1.')).replace('../tools/serve.mjs',pathToFileURL(process.cwd()+'/tools/serve.mjs').href).replace('8123','8164');
const network=s.slice(s.indexOf('  // Network battle between two separate browser sessions'));
fs.writeFileSync('../m10-network-only.mjs',head+'try {\n'+network);

