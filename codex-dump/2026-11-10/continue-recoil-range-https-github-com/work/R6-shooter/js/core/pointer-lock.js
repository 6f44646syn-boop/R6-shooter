// Pointer lock with raw (unadjusted) input. Based on test/capability-test.html.
//
// 1. Ask for { unadjustedMovement: true } so Windows "Enhance pointer precision" and pointer
//    speed do not touch the counts.
// 2. If that rejects with NotSupportedError, fall back to plain pointer lock and remember it,
//    so later requests go straight to the fallback.
// 3. Any other rejection (usually Chrome refusing a re-lock right after Esc) is reported as
//    "retry": the caller shows a quiet "click again" hint and the next click tries again.

export class PointerLock {
  constructor(element, { onChange, onRetry, onUnsupported } = {}) {
    this.el = element;
    this.locked = false;
    this.raw = false;              // raw input active for the current lock
    this.rawSupported = null;      // null = unknown, true/false once we know
    this.pending = false;
    this.onChange = onChange || (() => {});
    this.onRetry = onRetry || (() => {});
    this.onUnsupported = onUnsupported || (() => {});

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.el;
      if (locked === this.locked) return;
      this.locked = locked;
      if (!locked) this.raw = false;
      this.onChange(locked);
    });
    // Older, promise-less implementations only report failure through this event.
    document.addEventListener('pointerlockerror', () => {
      if (this.pending) return; // the promise path handles it
      this.onRetry(new Error('pointerlockerror'));
    });
  }

  get available() {
    return typeof this.el.requestPointerLock === 'function';
  }

  // Must be called from a user gesture (click).
  async request() {
    if (!this.available) { this.onUnsupported(); return false; }
    if (this.locked || this.pending) return this.locked;
    this.pending = true;
    try {
      if (this.rawSupported !== false) {
        try {
          const p = this.el.requestPointerLock({ unadjustedMovement: true });
          if (p && typeof p.then === 'function') {
            await p;
            this.rawSupported = true;
            this.raw = true;
          } else {
            // No promise: the option is unknown to this browser and was ignored.
            this.rawSupported = false;
            this.raw = false;
          }
          return true;
        } catch (e) {
          if (e && e.name === 'NotSupportedError') {
            this.rawSupported = false; // fall through to the plain request
          } else {
            throw e;
          }
        }
      }
      const p2 = this.el.requestPointerLock();
      if (p2 && typeof p2.then === 'function') await p2;
      this.raw = false;
      return true;
    } catch (e) {
      this.onRetry(e);
      return false;
    } finally {
      this.pending = false;
    }
  }

  exit() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
