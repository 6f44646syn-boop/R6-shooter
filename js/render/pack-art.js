// Optional pack data shared by presentation only. No map or hit-test edits.
import * as THREE from '../../vendor/three/three.module.min.js?v=099f307-mwdirh82';
import { HDPack } from './hd-pack.js?v=099f307-mwdirh82';
import { parseRRM } from './hd-mesh.js?v=099f307-mwdirh82';
export const packArt = { soldier: null, finish: null, surfaces: new Map(), revision: 0 };
let pending = null;
export async function loadPackArt() {
  if (!HDPack.ready) return;
  if (pending) return pending;
  const manifest = HDPack.installed;
  pending = (async () => {
    const read = async path => { try { return await HDPack.file(path); } catch { return null; } };
    const soldier = await read('soldiers/equipment.rrmz');
    const finish = await read('materials/finish.json');
    const surfaces = new Map();
    for (const name of ['concrete','wood','metal','house','tiles','carpet','stone','deck']) {
      for (const size of [512,1024]) {
        const bytes = await read(`materials/${name}-${size}.png`);
        if (bytes) { try { surfaces.set(`${name}-${size}`, await createImageBitmap(new Blob([bytes], {type:'image/png'}), { imageOrientation: 'flipY' })); } catch {} }
      }
    }
    if (HDPack.installed !== manifest || !HDPack.ready) { for(const b of surfaces.values())b.close(); return; }
    for(const b of packArt.surfaces.values())b.close();
    packArt.soldier = soldier ? parseRRM(soldier).lods[0] : null;
    packArt.finish = finish ? JSON.parse(new TextDecoder().decode(finish)) : null;
    packArt.surfaces = surfaces; packArt.revision++;
  })().finally(()=>{pending=null;});
  return pending;
}
HDPack.onChange(()=>{if(!HDPack.ready){packArt.soldier=null;packArt.finish=null;for(const b of packArt.surfaces.values())b.close();packArt.surfaces.clear();packArt.revision++;}});
// Replaces material texture data only. Existing UV density, boxes, batching and colors stay.
export function applyMapArt(group, quality, renderer) {
  if(!group)return;
  const size=quality==='ultra'?1024:512, high=HDPack.ready && (quality==='high'||quality==='ultra');
  const textures=new Map(), sources=new Map();
  group.traverse(o=>{for(const m of o.material?[].concat(o.material):[]){
    const base=m.userData.packBase || m.map, name=base?.userData.surface;
    if(!name)continue;
    const bitmap=high && packArt.surfaces.get(`${name}-${size}`);
    if(m.userData.packRevision===packArt.revision && m.userData.packQuality===quality)continue;
    if(m.userData.packBase){m.map.dispose();m.map=m.userData.packBase;m.bumpMap=null;delete m.userData.packBase;}
    if(bitmap){
      const key=name+':'+base.repeat.toArray()+':'+base.offset.toArray();
      let tex=textures.get(key);
      if(!tex){let source=sources.get(name);if(!source){source=new THREE.Texture(bitmap);sources.set(name,source);}tex=source.clone();tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=base.wrapS;tex.wrapT=base.wrapT;tex.repeat.copy(base.repeat);tex.offset.copy(base.offset);tex.anisotropy=Math.min(quality==='ultra'?8:4,renderer.capabilities.getMaxAnisotropy());tex.userData.own=true;tex.needsUpdate=true;textures.set(key,tex);}
      m.userData.packBase=base;m.map=tex;m.bumpMap=quality==='ultra'?tex:null;m.bumpScale=0.002;
    }
    m.userData.packRevision=packArt.revision;m.userData.packQuality=quality;m.needsUpdate=true;
  }});
}
