// Ammo, reload and fire timing. Time is in seconds (float), from the same clock everywhere.
//
// Shot timing uses an accumulator: nextShotTime advances by exactly 60/rpm per shot, and
// update() fires every shot that is due, so several shots can land in one long frame and the
// rate never depends on the frame rate.

export class Weapon {
  constructor() {
    this.gun = null;
    this.ammo = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.reloadSpeed = 1;     // multiplier from Settings: 2 = reloads take half the gun's reloadSeconds
    this.reloadDur = 0;
    this.nextShotTime = 0;
    this.triggerHeld = false;
    this.semiReady = false;   // semi-auto: one shot per press
  }

  // Most rounds the gun can hold: magSize, plus one in the chamber if "chambered" is set.
  get capacity() { return this.gun.magSize + (this.gun.chambered ? 1 : 0); }

  setGun(gun) {
    this.gun = gun;
    this.interval = 60 / gun.rpm;
    this.ammo = this.capacity;
    this.reloading = false;
    this.nextShotTime = 0;
  }

  pressTrigger(t) {
    this.triggerHeld = true;
    this.semiReady = true;
    // Can't fire faster than the rpm even by clicking quickly.
    if (this.nextShotTime < t) this.nextShotTime = t;
  }

  releaseTrigger() {
    this.triggerHeld = false;
  }

  // Returns true if a reload started.
  startReload(t) {
    if (this.reloading || this.ammo === this.capacity) return false;
    // Reloading with a round still chambered gives magSize + 1 (guns with "chambered": true).
    this.reloadTo = this.gun.magSize + (this.gun.chambered && this.ammo > 0 ? 1 : 0);
    this.reloading = true;
    this.reloadEmpty = this.ammo === 0;   // for the animation only (same duration either way)
    this.reloadDur = this.gun.reloadSeconds / this.reloadSpeed;
    this.reloadEnd = t + this.reloadDur;
    return true;
  }

  get reloadProgress() {
    return this.reloading ? 1 - Math.max(0, this.reloadEnd - this._t) / Math.max(1e-6, this.reloadDur) : 0;
  }

  // Advance to time t. Calls onShot(shotTime) for each shot fired, in order.
  // Returns 'reloaded' when a reload finished during this call, otherwise null.
  update(t, onShot) {
    this._t = t;
    let event = null;
    if (this.reloading && t >= this.reloadEnd) {
      this.reloading = false;
      this.ammo = this.reloadTo;
      if (this.nextShotTime < this.reloadEnd) this.nextShotTime = this.reloadEnd;
      event = 'reloaded';
    }
    if (!this.triggerHeld || this.reloading) return event;
    const semi = this.gun.fireMode === 'semi';
    while (this.ammo > 0 && this.nextShotTime <= t) {
      if (semi && !this.semiReady) break;
      const shotTime = this.nextShotTime;
      this.ammo--;
      this.nextShotTime += this.interval;
      this.semiReady = false;
      onShot(shotTime);
    }
    return event;
  }
}
