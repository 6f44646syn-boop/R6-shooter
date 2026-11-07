// Abilities (stage 3). For now: no gadgets.
export class Abilities {
  constructor(m, cfg) { this.m = m; this.cfg = cfg; this.gadgets = []; this.projectiles = []; }
  init(a) { a.ab = { charges: 0, busy: false }; }
  refill() {}
  update() {}
  onDeath() {}
  rayGadgets() { return null; }
  destroy() {}
  botThink() {}
}
