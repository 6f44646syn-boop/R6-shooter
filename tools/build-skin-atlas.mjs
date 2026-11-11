// Enhanced Graphics pack v5: detail sheets for the redrawn weapon skins (hd/skins/*.webp), made
// offline with WebGL 2 in headless Chrome (dev tooling only). The game's skin shader v2
// (js/render/skins2.js) combines them with each skin's colours, so all 201 skins are redrawn
// without shipping 201 sets of images, and are still baked at up to 4096 px on Ultra.
//   camo     3 layers of hand-cut organic shapes (R G B), each a mask, stacked by the skin
//   digital  pixel camo: 3 layers at two block sizes (R G B)
//   tiger    brushed stripes (R strokes, G dry-brush streaks, B splatter and stroke edges)
//   grime    R dirt and smudges, G fine directional scratches, B edge chipping noise
//   flake    metallic flake: R sparkle, G flake tilt x, B flake tilt y
// (no alpha: a 2D canvas premultiplies it, which would erase the other channels)
//   decals   4 x 4 sheet of original emblems and stencil markings (R mask, G inner detail)
// node tools/build-skin-atlas.mjs [name ...]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LIB } from './hd/matgen.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = new URL('../hd/skins/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const SHEETS = {
  camo: { size: 4096, glsl: `
    // each layer: domain-warped fbm cut at a level, with a hand-cut rough edge; layers differ in
    // scale and seed so stacked they read as painted camo, not noise
    vec4 o;
    for (int k = 0; k < 3; k++) {
      float fk = float(k), sc = 2. + fk * .8;
      vec2 w = uv + vec2(fbm(uv + fk * 3.1, vec2(3), 5), fbm(uv + fk * 5.7 + 9., vec2(3), 5)) * .22;
      float n = fbm(w + fk * 1.7, vec2(sc), 6);
      float rough = (fbm(uv * 1. + fk, vec2(48), 3) - .5) * .045;
      float m = sstep(.5 + rough - .006, .5 + rough + .006, n + (fk - 1.5) * .025);
      o[k] = m;
    }
    gl_FragColor = vec4(o.rgb, 1.);` },
  digital: { size: 2048, glsl: `
    vec4 o;
    for (int k = 0; k < 4; k++) {
      float fk = float(k), px = k < 2 ? 96. : 192.;
      vec2 q = (floor(uv * px) + .5) / px;
      float n = fbm(q + fk * 4.3, vec2(4. + fk), 5) + .3 * fbm(q + fk + 9., vec2(10), 3);
      o[k] = step(.8 - fk * .02, n);
    }
    gl_FragColor = vec4(o.rgb, 1.);` },
  tiger: { size: 2048, glsl: `
    float w = fbm(uv, vec2(3), 5) * 1.6;
    float st = sin(PI * 2. * (uv.x * 7. + w));
    float taper = fbm(uv + 3., vec2(6), 5);
    float stroke = sstep(.3, .42, st + taper * .9 - .2);
    float dry = stroke * sstep(.35, .7, fbm(vec2(uv.x * 2., uv.y * 60.), vec2(2, 60), 3)) ;
    float splat = sstep(.12, .05, vor(uv, vec2(40)).x) * step(.8, vor(uv, vec2(40)).z);
    float edge = sstep(.02, .0, abs(st + taper * .9 - .56) - .02);
    gl_FragColor = vec4(stroke, dry, max(splat, edge * .5), 1.);` },
  grime: { size: 2048, glsl: `
    float dirt = fbm(uv, vec2(4), 7);
    float s1 = sstep(.012, .0, abs(gn(vec2(uv.x * 300., uv.y * 6.), vec2(300, 6)))) * sstep(.4, .6, fbm(uv, vec2(6), 4));
    float s2 = sstep(.01, .0, abs(gn(vec2(uv.y * 260., uv.x * 5.), vec2(260, 5)))) * sstep(.45, .65, fbm(uv + 3., vec2(5), 4));
    float chip = fbm(uv + 7., vec2(24), 6);
    float smudge = sstep(.55, .8, fbm(uv + 2., vec2(5), 5)) * (.6 + .4 * ridge(uv, vec2(60), 2));
    gl_FragColor = vec4(mix(dirt, 1., smudge * .3), max(s1, s2), chip, 1.);` },
  flake: { size: 1024, glsl: `
    vec3 v = vor(uv, vec2(220)); vec2 h = hash22(vec2(v.z * 917., v.z * 311.));
    float sparkle = sstep(.4, .1, v.x) * step(.55, v.z);
    gl_FragColor = vec4(sparkle, h, 1.);` },
  decals: { size: 2048, glsl: `
    // 16 original emblems, one per cell (R: the shape, G: inner detail lines)
    vec2 c = floor(uv * 4.), p = fract(uv * 4.) * 2. - 1.; float id = c.x + c.y * 4.;
    float R = 0., G = 0.;
    float ln = length(p), an = atan(p.y, p.x);
    if (id < .5) {        // chevrons, three stacked
      for (int i = 0; i < 3; i++) { float y = p.y + .45 - float(i) * .35; float d = abs(abs(p.x) * .7 - y * -1. - .1) ; R = max(R, sstep(.1, .08, abs(y + abs(p.x) * .8 - .1)) * step(abs(p.x), .75)); }
    } else if (id < 1.5) { // star in a ring
      float st = cos(5. * an) * .25 + .55; R = max(sstep(.02, .0, ln - st * .9) , sstep(.04, .02, abs(ln - .92))); G = sstep(.02, .0, abs(ln - .8));
    } else if (id < 2.5) { // wings
      for (int i = 0; i < 5; i++) { float fi = float(i); vec2 q = vec2(abs(p.x) - .15 - fi * .12, p.y - .1 + fi * .08); R = max(R, sstep(.06, .04, abs(q.y + q.x * q.x * .8)) * step(0., q.x) * step(q.x, .4 - fi * .03)); }
      R = max(R, sstep(.16, .14, length(p - vec2(0., .05))));
    } else if (id < 3.5) { // bolt
      vec2 q = p * vec2(1., -1.); float b = max(abs(q.x + q.y * .35) - .14, abs(q.y) - .8); float zig = step(abs(q.y), .12) * step(abs(q.x), .4);
      R = max(sstep(.02, .0, b), zig);
    } else if (id < 4.5) { // crown
      float base = step(abs(p.x), .6) * step(-.45, p.y) * step(p.y, -.15);
      float spikes = step(-.15, p.y) * step(p.y, .5 - abs(fract(p.x * 1.66 + .5) - .5) * 1.8) * step(abs(p.x), .6);
      R = max(base, spikes); G = sstep(.06, .04, length(p - vec2(0., -.3)));
    } else if (id < 5.5) { // shield
      float sh = step(abs(p.x), .6 - max(0., -p.y - .1) * .9) * step(-.85, p.y) * step(p.y, .7);
      R = sh; G = sh * (sstep(.04, .02, abs(p.x)) + sstep(.04, .02, abs(p.y - .2)));
    } else if (id < 6.5) { // diamond
      R = sstep(.02, .0, abs(p.x) + abs(p.y) * .7 - .75); G = sstep(.02, .0, abs(abs(p.x) + abs(p.y) * .7 - .5));
    } else if (id < 7.5) { // hazard triangle
      float tri = max(abs(p.x) * 1.73 + p.y - .8, -p.y - .6); R = sstep(.02, .0, tri) - sstep(.02, .0, tri + .15); G = sstep(.06, .04, abs(p.x)) * step(-.2, p.y) * step(p.y, .35) + sstep(.08, .06, length(p - vec2(0., -.38)));
    } else if (id < 8.5) { // crosshair
      R = max(sstep(.04, .02, abs(ln - .7)), max(step(abs(p.x), .04) * step(.2, abs(p.y)), step(abs(p.y), .04) * step(.2, abs(p.x)))) * step(ln, .95); G = sstep(.08, .06, ln);
    } else if (id < 12.5) { // stencil numbers 07 13 21 44, seven-segment with stencil gaps
      int n = int(id) - 9; vec2 q = vec2(p.x * 1.3, p.y);
      ivec2 digs = n == 0 ? ivec2(0, 7) : n == 1 ? ivec2(1, 3) : n == 2 ? ivec2(2, 1) : ivec2(4, 4);
      for (int dI = 0; dI < 2; dI++) {
        int dg = dI == 0 ? digs.x : digs.y; vec2 r = q - vec2(dI == 0 ? -.5 : .5, 0.);
        // segments a b c d e f g
        int segs[10] = int[10](0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F);
        int s = segs[dg];
        float hb = step(abs(r.x), .28) * step(abs(r.x), .26);
        if ((s & 1) != 0) R = max(R, step(abs(r.x), .26) * step(abs(r.y - .7), .07));
        if ((s & 2) != 0) R = max(R, step(abs(r.x - .3), .07) * step(abs(r.y - .35), .3));
        if ((s & 4) != 0) R = max(R, step(abs(r.x - .3), .07) * step(abs(r.y + .35), .3));
        if ((s & 8) != 0) R = max(R, step(abs(r.x), .26) * step(abs(r.y + .7), .07));
        if ((s & 16) != 0) R = max(R, step(abs(r.x + .3), .07) * step(abs(r.y + .35), .3));
        if ((s & 32) != 0) R = max(R, step(abs(r.x + .3), .07) * step(abs(r.y - .35), .3));
        if ((s & 64) != 0) R = max(R, step(abs(r.x), .26) * step(abs(r.y), .07));
      }
      R *= step(.05, abs(p.y - .02));     // the stencil bridge
    } else if (id < 13.5) { // arrow
      R = max(step(abs(p.x), .12) * step(-.7, p.y) * step(p.y, .2), step(abs(p.x), (.75 - p.y) * .9) * step(.2, p.y) * step(p.y, .75));
    } else if (id < 14.5) { // dot grid
      vec2 g2 = fract(p * 3. + .5) - .5; R = sstep(.25, .22, length(g2)) * step(ln, .95);
    } else {               // tally marks
      for (int i = 0; i < 4; i++) R = max(R, step(abs(p.x + .45 - float(i) * .3), .05) * step(abs(p.y), .6));
      R = max(R, step(abs(p.y - p.x * .55), .05) * step(abs(p.x), .7));
    }
    R *= step(max(abs(p.x), abs(p.y)), .98);
    gl_FragColor = vec4(R, G, 0., 1.);` },
};

const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }`;
const FS = (body) => `#version 300 es
#define gl_FragColor oc
${LIB}
in vec2 vUv; out vec4 oc;
void main() { vec2 uv = vUv; ${body} }`;

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
let total = 0;
for (const [name, def] of Object.entries(SHEETS)) {
  if (only.length && !only.includes(name)) continue;
  await page.setContent('<canvas id="c"></canvas>');
  const t0 = Date.now();
  const b64 = await page.evaluate(({ size, VS, FS }) => {
    const cv = document.getElementById('c'); cv.width = cv.height = size;
    const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: true });
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); gl.useProgram(p);
    gl.uniform2f(gl.getUniformLocation(p, 'uTile'), 1, 1); gl.uniform1f(gl.getUniformLocation(p, 'uSeed'), 3);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, size, size); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // straight alpha out: read the pixels and write them to a 2D canvas (WebP keeps RGBA)
    const px = new Uint8Array(size * size * 4); gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const c2 = document.createElement('canvas'); c2.width = c2.height = size; const g2 = c2.getContext('2d');
    const im = g2.createImageData(size, size);
    for (let y = 0; y < size; y++) im.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    g2.putImageData(im, 0, 0);
    return c2.toDataURL('image/webp', 0.92).split(',')[1];
  }, { size: def.size, VS, FS: FS(def.glsl) }).catch((e) => { throw Error(name + ': ' + e.message); });
  const buf = Buffer.from(b64, 'base64'); total += buf.length;
  writeFileSync(new URL(name + '.webp', OUT), buf);
  console.log(name.padEnd(9), def.size + 'px', (buf.length / 1048576).toFixed(2) + ' MB', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
await browser.close();
console.log('skin sheets:', (total / 1048576).toFixed(1) + ' MB');
