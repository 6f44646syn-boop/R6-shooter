import { concreteTiles, wallPanels, duskSky } from '../scene/range-tex.js?v=9dd0f7b-mwbioun8';

export const ROYALE_MAP_ID = 'blacktide';
export const ROYALE_BOTS = 20;

const spawns = Array.from({ length: ROYALE_BOTS + 1 }, (_, i) => {
  const a = (i + .5) * 2 * Math.PI / (ROYALE_BOTS + 1);
  return [63 * Math.cos(a), 49 * Math.sin(a)];
});
const box = (x, z, w, d, h, kind = 'wall', y = 0) => ({ x, z, w, d, h, kind, y });
const shack = (x, z) => [
  box(x, z - 3, 8, .4, 3, 'plank'), box(x - 4, z, .4, 6, 3, 'plank'),
  box(x + 4, z, .4, 6, 3, 'plank'), box(x - 2.6, z + 3, 2.8, .4, 3, 'plank'),
  box(x + 2.6, z + 3, 2.8, .4, 3, 'plank'), box(x, z, 8.4, 6.4, .25, 'plank', 3),
];

export const BLACKTIDE = {
  name: 'Blacktide Island', hx: 80, hz: 64, wallH: 5,
  sky: duskSky, background: 0x4c5f65, fog: [0x73878e, 78, 186],
  hemi: [0xd5e8f1, 0x524638, 2.2], key: [0xffe2bb, 2, [-43, 83, 30]],
  floor: () => ({ map: concreteTiles().map.clone(), tile: 5, color: 0x9b9173 }),
  wall: () => ({ ...wallPanels(), tileW: 2, tileH: 4 }),
  kinds: {
    wall: { color: 0x707b70, rough: .9 },
    low: { color: 0x928576, rough: .95 },
    plank: { color: 0x74503a, rough: .9 },
    dock: { color: 0x829292, rough: .85 },
    container: { color: 0x385b62, metal: .45, rough: .65 },
    crate: { color: 0x9b6944, rough: .9 },
    barrier: { color: 0xc6a175, rough: .9 },
  },
  spawns, spawnsB: [],
  chests: [
    ...spawns.map(([x, z]) => [x * .92, z * .92]),
    [-45,-31], [-36,-18], [36,-35], [54,-22], [-50,28], [-31,35],
    [36,30], [52,19], [-14,0], [12,0], [0,-12], [0,12],
  ],
  layout: [
    // Wreck, village, container docks and quarry surround the central fort.
    box(-45, -29, 26, 1, 2.8, 'plank'), box(-45, -37, 20, .8, 2.2, 'plank'),
    box(-57, -33, 2, 7, 1.2, 'plank'), box(-34, -33, 4, 5, 1.2, 'dock'),
    box(-45, -24, 13, 5, .8, 'dock'), box(-38, -19, 4, 2.6, 1.2, 'crate'),
    ...shack(-51, 29), ...shack(-38, 29), ...shack(-44, 42), ...shack(-31, 42),
    box(36, -29, 16, 2.8, 2.8, 'container'), box(55, -30, 2.8, 19, 2.8, 'container'),
    box(45, -43, 13, 3, 2.8, 'container'), box(34, -40, 2.8, 9, 2.8, 'container'),
    box(46, -34, 3, 3, 1.2, 'crate'), box(49, -23, 9, 3, 1.2, 'dock'),
    box(46, 31, 19, 9, 1.2, 'dock'), box(47, 35, 12, 6, 1.2, 'dock', 1.2),
    { ramp:'-z', x:43, z:23, w:3.5, d:7, y1:1.2, kind:'dock' },
    box(60, 29, 3, 12, 2.1), box(36, 38, 5, 7, 1.25, 'low'),
    box(-8, -9, 6, .7, 3.2), box(8, -9, 6, .7, 3.2),
    box(-8, 9, 6, .7, 3.2), box(8, 9, 6, .7, 3.2),
    box(-11, 0, .7, 9, 3.2), box(11, 0, .7, 9, 3.2),
    box(0, 3, 7, 5, 1.15, 'dock'), box(-3, 3, 1, 3, .9, 'low', 1.15),
    { ramp:'+z', x:0, z:-1.8, w:2.6, d:4.6, y1:1.15, kind:'dock' },
    ...[-60,-30,0,30,60].flatMap((x, i) => [-50,-14,14,50].map((z, j) =>
      box(x + (j % 2 ? 5 : -5), z, (i+j)%2 ? 3 : 6, (i+j)%2 ? 6 : 3, 1.2, 'barrier'))),
  ],
};
