// Browser API adapter only. Binding resolution, transitions, ADS and gain run in Rust.
export const ACTIONS = [
  ["fire", "Fire"],
  ["ads", "Aim down sights"],
  ["forward", "Move forward"],
  ["back", "Move back"],
  ["left", "Move left"],
  ["right", "Move right"],
  ["sprint", "Sprint"],
  ["crouch", "Crouch"],
  ["leanLeft", "Lean left"],
  ["leanRight", "Lean right"],
  ["ability", "Operator ability / drone scan"],
  ["interact", "Interact / plant / defuse / flashlight"],
  ["reload", "Reload"],
  ["vault", "Vault / clear range"],
  ["grenade", "Throw grenade"],
  ["knife", "Knife"],
  ["inspect", "Inspect weapon"],
  ["scoreboard", "Scoreboard"],
  ["recall", "Recall drone / replay perspective"],
  ["droneZap", "Drone zap"],
  ["underbarrel", "Underbarrel mode"],
  ["reset", "Reset range position"],
  ["target", "Cycle target"],
  ["zero", "Zero debug counters"],
];
export const CODES = [
  "",
  ...Array.from({ length: 26 }, (_, i) => "Key" + String.fromCharCode(65 + i)),
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "Tab",
  "CapsLock",
  "BracketLeft",
  "BracketRight",
  "Minus",
  "Equal",
  ...Array.from({ length: 10 }, (_, i) => "Digit" + i),
];
const STORE = "recoilRange.controls.v1";
export function inputCode(e) {
  if (e.type.includes("mouse"))
    return e.button >= 0 && e.button <= 4 ? 128 + e.button : 0;
  return Math.max(0, CODES.indexOf(e.code));
}
export function inputLabel(c) {
  return c >= 128
    ? [
        "Left mouse",
        "Middle mouse",
        "Right mouse",
        "Mouse back",
        "Mouse forward",
      ][c - 128]
    : (CODES[c] || "Unbound").replace("Key", "").replace("Digit", "");
}
export async function createControls() {
  const response = await fetch(
    new URL("../../wasm/m7_controls.wasm?v=1", import.meta.url),
  );
  if (!response.ok)
    throw new Error("Controls could not load. Reload the page to retry.");
  const { instance } = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    {},
  );
  const e = instance.exports;
  if (e.mc_abi() !== 1 || e.mc_count() !== ACTIONS.length)
    throw new Error("Controls ABI mismatch. Reload the page.");
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORE));
  } catch {
    /* unavailable */
  }
  const api = {
    e,
    profile: "mouse",
    selected: false,
    toggle: false,
    autoAds: false,
    gain: 1,
    adsGain: 1,
    invert: false,
    onAction: () => {},
    onChange: () => {},
    bindingLabel(id) {
      const a = ACTIONS.findIndex((x) => x[0] === id);
      return a < 0
        ? "Unbound"
        : inputLabel(e.mc_binding(a, 0) || e.mc_binding(a, 1));
    },
    abilityLabel() {
      return inputLabel(e.mc_binding(10, 0) || e.mc_binding(10, 1));
    },
    bindings() {
      return ACTIONS.map((_, a) => [e.mc_binding(a, 0), e.mc_binding(a, 1)]);
    },
    release() {
      const mask = e.mc_release();
      ACTIONS.forEach(([id], i) => {
        if (mask & (1 << i)) api.onAction(id, false);
      });
    },
    options() {
      e.mc_auto_ads(+api.autoAds);
      e.mc_options(+api.toggle, api.gain, api.adsGain, +api.invert);
    },
    save() {
      api.options();
      try {
        localStorage.setItem(
          STORE,
          JSON.stringify({
            version: 1,
            profile: api.profile,
            selected: api.selected,
            toggle: api.toggle,
            autoAds: api.autoAds,
            gain: api.gain,
            adsGain: api.adsGain,
            invert: api.invert,
            bindings: api.bindings(),
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
    setProfile(profile) {
      api.release();
      api.profile = profile === "trackpad" ? "trackpad" : "mouse";
      e.mc_reset(+(api.profile === "trackpad"));
      api.toggle = api.profile === "trackpad";
      api.autoAds = api.profile === "trackpad";
      api.options();
      api.onChange();
    },
    bind(a, slot, code) {
      api.release();
      const ok = !!e.mc_bind(a, slot, code);
      if (ok) api.onChange();
      return ok;
    },
    look(dx, dy, ads) {
      return [e.mc_look(dx, +ads, 0), e.mc_look(dy, +ads, 1)];
    },
  };
  if (stored?.version === 1 && ["mouse", "trackpad"].includes(stored.profile)) {
    api.setProfile(stored.profile);
    api.selected = stored.selected === true;
    api.autoAds = stored.autoAds === true;
    api.toggle = stored.toggle === true;
    api.invert = stored.invert === true;
    api.gain = Number.isFinite(stored.gain)
      ? Math.max(0.1, Math.min(4, stored.gain))
      : 1;
    api.adsGain = Number.isFinite(stored.adsGain)
      ? Math.max(0.1, Math.min(2, stored.adsGain))
      : 1;
    const b = stored.bindings;
    if (
      Array.isArray(b) &&
      b.length === ACTIONS.length &&
      b.every(
        (row) =>
          Array.isArray(row) && row.length === 2 && row.every(Number.isInteger),
      )
    ) {
      for (let a = 0; a < ACTIONS.length; a++)
        for (let s = 0; s < 2; s++) e.mc_bind(a, s, 0);
      let valid = true;
      b.forEach((row, a) =>
        row.forEach((c, s) => {
          if (!e.mc_bind(a, s, c)) valid = false;
        }),
      );
      if (!valid) e.mc_reset(+(api.profile === "trackpad"));
    }
    api.options();
  } else e.mc_reset(0);
  return api;
}

export function attachRawInput(
  api,
  { enabled, onAux = () => {}, target = document },
) {
  const listeners = [];
  const listen = (node, name, fn, opts) => {
    node.addEventListener(name, fn, opts);
    listeners.push(() => node.removeEventListener(name, fn, opts));
  };
  const handle = (event, down) => {
    if (event.target?.closest?.("input,select,textarea,[contenteditable=true]"))
      return;
    if (!enabled()) return;
    const code = inputCode(event);
    const bound = code && api.bindings().some((row) => row.includes(code));
    if (bound) {
      event.preventDefault();
      const result = api.e.mc_event(code, +down);
      if (result)
        api.onAction(ACTIONS[(result & 255) - 1][0], !!(result & 256));
      const secondary = api.e.mc_secondary();
      if (secondary)
        api.onAction(ACTIONS[(secondary & 255) - 1][0], !!(secondary & 256));
    } else if (event.type.startsWith("key")) onAux(event, down);
  };
  listen(target, "keydown", (e) => handle(e, true));
  listen(target, "keyup", (e) => handle(e, false));
  listen(target, "mousedown", (e) => handle(e, true));
  listen(target, "mouseup", (e) => handle(e, false));
  listen(window, "blur", () => api.release());
  listen(document, "visibilitychange", () => {
    if (document.hidden) api.release();
  });
  listen(document, "pointerlockchange", () => {
    if (!document.pointerLockElement) api.release();
  });
  return () => {
    api.release();
    listeners.forEach((fn) => fn());
  };
}
