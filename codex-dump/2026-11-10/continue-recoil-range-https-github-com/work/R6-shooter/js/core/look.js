// Mouse look accumulator. Every mousemove event goes straight in here; nothing is smoothed,
// accelerated, filtered or scaled by frame time. All values are float64 JS numbers.
//
// Conventions: yaw in degrees, positive = turn right. Pitch in degrees, positive = look up.
// Mouse movementY is positive when the mouse moves towards you (down), so pitch -= dy * dpc.

export const MAX_EVENT_COUNTS = 2000; // Chrome occasionally reports a huge bogus jump; drop those.
export const PITCH_LIMIT = 89.9;

export class Look {
  constructor() {
    this.yaw = 0;            // wrapped to [0, 360)
    this.pitch = 0;          // clamped to +/- PITCH_LIMIT
    this.reset();
  }

  // Zero the debug counters (not the view direction).
  reset() {
    this.unwrappedYaw = 0;   // sum of every applied yaw step, never wrapped
    this.countsX = 0;        // total counts applied (signed)
    this.countsY = 0;
    this.events = 0;
    this.discarded = 0;
  }

  // dx, dy: raw counts from one mousemove event. dpc: degrees per count right now.
  // Returns false if the event was discarded by the glitch guard.
  // dpcY: degrees per count for pitch (Siege-style separate vertical sensitivity); defaults
  // to dpc.
  apply(dx, dy, dpc, dpcY = dpc) {
    if (dx > MAX_EVENT_COUNTS || dx < -MAX_EVENT_COUNTS || dy > MAX_EVENT_COUNTS || dy < -MAX_EVENT_COUNTS) {
      this.discarded++;
      return false;
    }
    this.events++;
    this.countsX += dx;
    this.countsY += dy;

    const dYaw = dx * dpc;
    this.unwrappedYaw += dYaw;
    // Wrap the working yaw separately so it never grows large and loses precision.
    let y = (this.yaw + dYaw) % 360;
    if (y < 0) y += 360;
    this.yaw = y;

    let p = this.pitch - dy * dpcY;
    if (p > PITCH_LIMIT) p = PITCH_LIMIT;
    else if (p < -PITCH_LIMIT) p = -PITCH_LIMIT;
    this.pitch = p;
    return true;
  }

  setAngles(yaw, pitch) {
    this.yaw = ((yaw % 360) + 360) % 360;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }
}
