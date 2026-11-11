import fs from 'node:fs';
function walk(d){for(const f of fs.readdirSync(d)){if(f==='.git')continue;const p=d+'/'+f;if(fs.statSync(p).isDirectory())walk(p);else if(/\.(js|mjs|rs|toml|json|md|html|css|sh|yml|lock)$/.test(f)){const s=fs.readFileSync(p,'utf8');if(s.includes('\r\n'))fs.writeFileSync(p,s.replace(/\r\n/g,'\n'));}}}walk('.');
