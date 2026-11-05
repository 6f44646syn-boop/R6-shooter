// HUD text. Inputs are compared as numbers first and strings are only built when something
// changed, so a normal frame allocates nothing and touches no DOM.

export class Hud {
  constructor($) {
    this.el = {
      slot: $('gun-slot'), name: $('gun-name'), tag: $('gun-tag'), info: $('gun-info'),
      distance: $('hud-distance'), shots: $('hud-shots'), hits: $('hud-hits'), acc: $('hud-acc'),
      ammo: $('ammo-count'), ammoSub: $('ammo-sub'),
    };
    this.lastShots = -1;
    this.lastHits = -1;
    this.lastAmmo = -1;
    this.lastMag = -1;
    this.lastReloading = null;
  }

  setGun(gun, index, opticLabel) {
    this.el.slot.textContent = String((index + 1) % 10);
    this.el.name.textContent = gun.name;
    // PLACEHOLDER RECOIL: invented spray. MEASURED: spray from the game, with any values the
    // measurement file still flags as placeholders listed in the tooltip.
    this.el.tag.hidden = false;
    this.el.tag.textContent = gun.placeholder ? 'PLACEHOLDER RECOIL' : 'MEASURED SPRAY';
    this.el.tag.title = gun.placeholder ? 'Invented test pattern' :
      'Measured at ' + gun.measuredAtVFov + '\u00b0 vertical FOV' + (gun.placeholderFields.length ? '. Still placeholders: ' + gun.placeholderFields.join(', ') : '');
    this.el.tag.classList.toggle('measured', !gun.placeholder);
    this.el.info.textContent = gun.rpm + ' rpm · ' + opticLabel + (gun.fireMode === 'semi' ? ' · semi' : '');
  }

  setDistance(d, moving) { this.el.distance.textContent = d + ' m' + (moving ? ' \u00b7 moving dot' : ''); }

  setStats(shots, hits) {
    if (shots === this.lastShots && hits === this.lastHits) return;
    this.lastShots = shots;
    this.lastHits = hits;
    this.el.shots.textContent = String(shots);
    this.el.hits.textContent = String(hits);
    this.el.acc.textContent = shots ? '(' + Math.round(100 * hits / shots) + '%)' : '';
  }

  setAmmo(ammo, mag, reloading) {
    if (ammo === this.lastAmmo && mag === this.lastMag && reloading === this.lastReloading) return;
    this.lastAmmo = ammo;
    this.lastMag = mag;
    this.lastReloading = reloading;
    this.el.ammo.textContent = reloading ? '--' : String(ammo);
    this.el.ammoSub.textContent = reloading ? 'reloading' : '/ ' + mag + (ammo === 0 ? '  R to reload' : '');
    this.el.ammo.classList.toggle('low', !reloading && ammo <= Math.ceil(mag * 0.2));
  }
}
