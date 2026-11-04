// HUD text. Each field is only written to the DOM when its value changes, so a frame where
// nothing changed costs no layout work.

export class Hud {
  constructor($) {
    this.el = {
      slot: $('gun-slot'), name: $('gun-name'), tag: $('gun-tag'), info: $('gun-info'),
      distance: $('hud-distance'), shots: $('hud-shots'), hits: $('hud-hits'), acc: $('hud-acc'),
      ammo: $('ammo-count'), ammoSub: $('ammo-sub'),
    };
    this.cache = {};
  }

  _set(key, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.el[key].textContent = value;
  }

  setGun(gun, index, opticLabel) {
    this._set('slot', String((index + 1) % 10));
    this._set('name', gun.name);
    this.el.tag.hidden = !gun.placeholder;
    this._set('info', gun.rpm + ' rpm · ' + opticLabel + ' optic' + (gun.fireMode === 'semi' ? ' · semi' : ''));
  }

  setDistance(d) { this._set('distance', d + ' m'); }

  setStats(shots, hits) {
    this._set('shots', String(shots));
    this._set('hits', String(hits));
    this._set('acc', shots ? '(' + Math.round(100 * hits / shots) + '%)' : '');
  }

  setAmmo(ammo, mag, reloading) {
    this._set('ammo', reloading ? '--' : String(ammo));
    this._set('ammoSub', reloading ? 'reloading' : '/ ' + mag + (ammo === 0 ? '  R to reload' : ''));
    const low = !reloading && ammo <= Math.ceil(mag * 0.2);
    if (this.cache.low !== low) { this.cache.low = low; this.el.ammo.classList.toggle('low', low); }
  }
}
