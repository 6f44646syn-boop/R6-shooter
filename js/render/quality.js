// Graphics quality actually used. Low and Standard run in any browser; High and Ultra need
// the Enhanced Graphics pack (render/hd-pack.js). Until it is installed they run as Standard
// (the saved choice is kept, so installing the pack switches them on).
import { HDPack } from './hd-pack.js?v=2bc20c5-mwb9w9ii';

export const ENHANCED = ['high', 'ultra'];
export function needsPack(g) { return ENHANCED.includes(g); }
export function effectiveGraphics(settings) {
  const g = settings.graphics;
  return needsPack(g) && !HDPack.ready ? 'standard' : g;
}
