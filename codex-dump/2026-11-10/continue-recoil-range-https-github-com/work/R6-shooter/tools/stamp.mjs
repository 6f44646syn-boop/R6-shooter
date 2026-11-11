// Cache busting for GitHub Pages (which lets browsers keep files for 10 minutes): give every
// relative module import, and the page's script and stylesheet links, a ?v=<build> query so
// a new version never mixes with old cached files. Every reference to a file gets the same
// query, so each module still loads once. Run before publishing:
//   node tools/stamp.mjs            (build = current git commit + time)
//   node tools/stamp.mjs abc123     (explicit build id)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let build = process.argv[2];
if (!build) {
  let hash = 'dev';
  try { hash = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { /* not a repo */ }
  build = hash + '-' + Date.now().toString(36);
}
const q = '?v=' + build;

const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(join(root, 'js'));

// from './x.js' | from "../y.js" | import './z.js' | import('./w.js'), with or without an old ?v=
const spec = /((?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+?\.js)(\?v=[^'"]*)?\2/g;
let n = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const out = s.replace(spec, (m, pre, qt, path) => { n++; return pre + qt + path + q + qt; });
  if (out !== s) writeFileSync(f, out);
}
const html = join(root, 'index.html');
let h = readFileSync(html, 'utf8');
h = h.replace(/(src="js\/main\.js)(\?v=[^"]*)?"/, '$1' + q + '"').replace(/(href="css\/style\.css)(\?v=[^"]*)?"/, '$1' + q + '"');
writeFileSync(html, h);
console.log('stamped ' + n + ' imports in ' + files.length + ' files + index.html with ' + q);
