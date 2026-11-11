// Bakes the Enhanced Graphics pack's map materials (tools/hd/matgen.mjs) to WebP images in
// hd/mat/, rendering each with WebGL 2 in headless Chrome (dev tooling only; the game never
// loads Playwright). node tools/build-materials.mjs [name ...]
//   pass 1: colour + height, roughness + metalness + occlusion (float targets)
//   pass 2: albedo, the normal map from the height (metres, so slopes are physical), and the
//           occlusion map (the material's own times cavities found in the height)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LIB, MATERIALS } from './hd/matgen.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = new URL('../hd/mat/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const list = Object.entries(MATERIALS).filter(([n]) => !only.length || only.includes(n));

const PASS1 = (body) => `#version 300 es
${LIB}
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void surf(vec2 uv, vec2 p, inout S s) { ${body} }
void main() {
  S s = S(vec3(.5), 0., .8, 0., 1.);
  surf(vUv, vUv * uTile, s);
  o0 = vec4(clamp(s.c, 0., 1.), s.h);
  o1 = vec4(clamp(s.r, .02, 1.), clamp(s.m, 0., 1.), clamp(s.ao, 0., 1.), 1.);
}`;
const PASS2 = `#version 300 es
precision highp float;
uniform sampler2D t0, t1; uniform vec2 uRes, uTile; uniform int uMode;
in vec2 vUv; out vec4 o;
float H(ivec2 q) { ivec2 r = ivec2(uRes); return texelFetch(t0, (q % r + r) % r, 0).a; }
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(t0, q, 0), b = texelFetch(t1, q, 0);
  if (uMode == 0) { o = vec4(a.rgb, 1.); return; }
  vec2 px = uTile / uRes;                       // metres per texel
  if (uMode == 1) {
    float dx = (H(q + ivec2(1, -1)) + 2. * H(q + ivec2(1, 0)) + H(q + ivec2(1, 1)) - H(q + ivec2(-1, -1)) - 2. * H(q + ivec2(-1, 0)) - H(q + ivec2(-1, 1))) / (8. * px.x);
    float dy = (H(q + ivec2(-1, 1)) + 2. * H(q + ivec2(0, 1)) + H(q + ivec2(1, 1)) - H(q + ivec2(-1, -1)) - 2. * H(q + ivec2(0, -1)) - H(q + ivec2(1, -1))) / (8. * px.y);
    vec3 n = normalize(vec3(-dx, -dy, 1.));
    o = vec4(n * .5 + .5, 1.); return;
  }
  // cavities: how far the neighbourhood rises above this texel (two radii)
  float h = a.a, occ = 0.;
  for (int k = 0; k < 2; k++) {
    float rm = k == 0 ? .012 : .05; vec2 rt = rm / px; float acc = 0.;
    for (int i = 0; i < 12; i++) { float an = float(i) * 0.5236 + float(k) * .26; ivec2 o2 = ivec2(round(vec2(cos(an), sin(an)) * rt)); acc += max(0., H(q + o2) - h) / rm; }
    occ += acc / 12.;
  }
  float cav = clamp(1. - occ * .9, .35, 1.);
  o = vec4(b.b * cav, b.r, b.g, 1.);
}`;
const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
let total = 0;
for (const [name, def] of list) {
  const t0 = Date.now();
  const res = await page.evaluate(({ name, def, FS1, PASS2, VS }) => {
    const [W, H] = def.size, cv = document.getElementById('c');
    cv.width = W; cv.height = H;
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false });
    if (!gl.getExtension('EXT_color_buffer_float')) throw Error('no float targets');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const prog = (fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)); return p; };
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    const A = tex(), B = tex(), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, A, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, B, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, W, H);
    const p1 = prog(FS1); gl.useProgram(p1);
    gl.uniform2f(gl.getUniformLocation(p1, 'uTile'), def.tile[0], def.tile[1]);
    gl.uniform1f(gl.getUniformLocation(p1, 'uSeed'), def.seed || 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const p2 = prog(PASS2); gl.useProgram(p2);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A); gl.uniform1i(gl.getUniformLocation(p2, 't0'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B); gl.uniform1i(gl.getUniformLocation(p2, 't1'), 1);
    gl.uniform2f(gl.getUniformLocation(p2, 'uRes'), W, H); gl.uniform2f(gl.getUniformLocation(p2, 'uTile'), def.tile[0], def.tile[1]);
    const out = {};
    for (const [mode, key, q] of [[0, 'albedo', 0.9], [1, 'normal', 0.95], [2, 'orm', 0.9]]) {
      gl.uniform1i(gl.getUniformLocation(p2, 'uMode'), mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      out[key] = cv.toDataURL('image/webp', q).split(',')[1];
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  }, { name, def: { size: def.size, tile: def.tile, glsl: def.glsl, seed: def.seed }, FS1: PASS1(def.glsl), PASS2, VS }).catch((e) => { throw Error(name + ': ' + e.message); });
  let bytes = 0;
  for (const [k, b64] of Object.entries(res)) { const b = Buffer.from(b64, 'base64'); bytes += b.length; writeFileSync(new URL(name + '-' + k + '.webp', OUT), b); }
  total += bytes;
  console.log(name.padEnd(12), def.size.join('x').padEnd(10), (bytes / 1048576).toFixed(2) + ' MB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  // a fresh canvas per material (each context was lost)
  await page.setContent('<canvas id="c"></canvas>');
}
await browser.close();
console.log('materials:', list.length, (total / 1048576).toFixed(1) + ' MB');
