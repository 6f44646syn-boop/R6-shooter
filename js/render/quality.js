// Graphics quality actually used. Low and Standard run in any browser; High and Ultra need
// the Enhanced Graphics pack (render/hd-pack.js). Until it is installed they run as Standard
// (the saved choice is kept, so installing the pack switches them on).
import { HDPack } from './hd-pack.js?v=a6e39f3-mwmzyysr';

export const ENHANCED = ['high', 'ultra', 'max'];
export function needsPack(g) { return ENHANCED.includes(g); }
// Max draws as Ultra everywhere, plus the extras that check maxMode.on (set by main.js):
// 4K map surfaces, bloom, colour grading, light shafts and fog, floor reflections, baked light
// and SSAO together, sharper sun shadows, full-detail soldiers at any distance, wall impacts
// with debris, and wet surfaces in rain.
export const maxMode = { on: false };
// Minimal draws as Low, and the cuts that check minimalMode.on: no muzzle flash or brass, no
// bullet holes in matches, no rain or snow, still menus (default skins and T-pose bots too).
export const minimalMode = { on: false };
export function effectiveGraphics(settings) {
  const g = settings.graphics;
  maxMode.on = g === 'max' && HDPack.ready;
  minimalMode.on = g === 'minimal';
  return needsPack(g) && !HDPack.ready ? 'standard' : g === 'max' ? 'ultra' : g === 'minimal' ? 'low' : g;
}
