// Gun charms: small trinkets that hang off the gun on a short cord (they swing when you move
// and inspect). Bought with points in the shop; one equipped at a time, on every gun.
export const CHARMS = [
  { id: 0, name: 'Brass Bell', shape: 'bell', color: 0xc9a24a, price: 150 },
  { id: 1, name: 'Dog Tag', shape: 'tag', color: 0xb8bec6, price: 150 },
  { id: 2, name: 'Lucky Die', shape: 'die', color: 0xeeeae0, price: 200 },
  { id: 3, name: 'Jade Ring', shape: 'ring', color: 0x3fae7a, price: 250 },
  { id: 4, name: 'Pixel Heart', shape: 'heart', color: 0xe0405a, price: 250 },
  { id: 5, name: 'Paper Crane', shape: 'crane', color: 0xf2efe6, price: 300 },
  { id: 6, name: 'Tiny Dummy', shape: 'dummy', color: 0xd88a3a, price: 350 },
  { id: 7, name: 'Frost Shard', shape: 'shard', color: 0x8fe6ff, price: 400 },
];
export const charmById = (id) => CHARMS[id] ?? null;
