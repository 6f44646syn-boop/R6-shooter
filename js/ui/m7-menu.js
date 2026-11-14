import { ACTIONS, inputCode, inputLabel } from "./m7-raw-input.js?v=d05ab44-mwg7imxt";
const node = (tag, text) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
};

// WAI-ARIA tabs: roving focus, keyboard navigation, labelled panels, native hidden.
export function tabs(root, groups, label) {
  const list = node("div");
  list.className = "m7-tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", label);
  const select = (i) =>
    groups.forEach((g, j) => {
      g.panel.hidden = i !== j;
      g.button.setAttribute("aria-selected", String(i === j));
      g.button.tabIndex = i === j ? 0 : -1;
    });
  groups.forEach((g, i) => {
    const b = (g.button = node("button", g.label));
    b.type = "button";
    b.id = g.panel.id + "-tab";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", g.panel.id);
    g.panel.setAttribute("role", "tabpanel");
    g.panel.setAttribute("aria-labelledby", b.id);
    g.panel.tabIndex = 0;
    b.addEventListener("click", () => select(i));
    b.addEventListener("keydown", (e) => {
      let next;
      const visible = groups
        .map((g, j) => (g.button.hidden ? -1 : j))
        .filter((j) => j >= 0);
      const position = visible.indexOf(i);
      if (e.key === "ArrowRight")
        next = visible[(position + 1) % visible.length];
      if (e.key === "ArrowLeft")
        next = visible[(position + visible.length - 1) % visible.length];
      if (e.key === "Home") next = visible[0];
      if (e.key === "End") next = visible[visible.length - 1];
      if (next !== undefined) {
        e.preventDefault();
        select(next);
        groups[next].button.focus();
      }
    });
    list.append(b);
  });
  root.prepend(list);
  select(0);
  return select;
}

export function mountControls(root, api, padPanel = null) {
  let capture = null;
  const status = node("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.className = "hint";
  const save = () => {
    status.textContent = api.save()
      ? "Controls saved in this browser."
      : "Controls applied for this session. Browser storage is unavailable.";
  };
  const profiles = node("div");
  profiles.className = "row";
  for (const [id, label] of [
    ["mouse", "Mouse + keyboard"],
    ["trackpad", "Trackpad + keyboard"],
  ]) {
    const b = node("button", label);
    b.type = "button";
    b.dataset.profile = id;
    b.addEventListener("click", () => {
      api.setProfile(id);
      api.selected = true;
      save();
      render();
    });
    profiles.append(b);
  }
  const intro = node(
    "p",
    "Trackpad uses J to fire, L to toggle ADS and U for abilities, leaving one hand free to aim. Q/E always start as lean. Selecting a profile restores its default bindings. Profiles add no aim assistance.",
  );
  const options = node("div");
  options.className = "set-grid m7-options";
  const add = (text, type, value, change, min, max) => {
    const label = node("label", text);
    label.className = "field";
    const input = node("input");
    input.type = type;
    if (type === "checkbox") input.checked = value;
    else {
      input.value = value;
      input.min = min;
      input.max = max;
      input.step = ".1";
    }
    label.append(input);
    options.append(label);
    input.addEventListener("change", () => {
      change(type === "checkbox" ? input.checked : Number(input.value));
      api.release();
      save();
      render();
    });
    return input;
  };
  const gain = add(
    "Look sensitivity multiplier",
    "number",
    api.gain,
    (v) => (api.gain = Math.max(0.1, Math.min(4, Number.isFinite(v) ? v : 1))),
    0.1,
    4,
  );
  const ads = add(
    "ADS sensitivity multiplier",
    "number",
    api.adsGain,
    (v) =>
      (api.adsGain = Math.max(0.1, Math.min(2, Number.isFinite(v) ? v : 1))),
    0.1,
    2,
  );
  const toggle = add(
    "Toggle ADS",
    "checkbox",
    api.toggle,
    (v) => (api.toggle = v),
  );
  const autoAds = add(
    "Automatically ADS while firing",
    "checkbox",
    api.autoAds,
    (v) => (api.autoAds = v),
  );
  const invert = add(
    "Invert vertical look",
    "checkbox",
    api.invert,
    (v) => (api.invert = v),
  );
  const table = node("div");
  table.className = "m7-bindings";
  const panels = ["Movement", "Combat", "Utilities"].map((label, i) => {
    const panel = node("div");
    panel.id = "m7-bindings-" + i;
    table.append(panel);
    return { label, panel };
  });
  const buttons = [];
  ACTIONS.forEach(([id, title], a) => {
    const row = node("div");
    row.className = "m7-binding";
    const label = node("span", title);
    row.append(label);
    for (let slot = 0; slot < 2; slot++) {
      const b = node("button");
      b.type = "button";
      b.dataset.action = id;
      b.dataset.slot = slot;
      b.addEventListener("click", () => {
        capture = { a, slot };
        render();
        status.textContent =
          "Press a key or mouse button. Escape cancels; Delete clears this slot.";
      });
      buttons.push({ b, a, slot, title });
      row.append(b);
    }
    panels[
      a >= 16 ? 2 : [2, 3, 4, 5, 6, 7, 8, 9, 13].includes(a) ? 0 : 1
    ].panel.append(row);
  });
  function render() {
    buttons.forEach(({ b, a, slot, title }) => {
      b.textContent =
        capture?.a === a && capture.slot === slot
          ? "Press input…"
          : inputLabel(api.e.mc_binding(a, slot));
      b.setAttribute(
        "aria-label",
        title + ", " + (slot ? "alternate" : "primary") + ": " + b.textContent,
      );
    });
    profiles
      .querySelectorAll("button")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.profile === api.profile),
        ),
      );
    toggle.checked = api.toggle;
    autoAds.checked = api.autoAds;
    gain.value = api.gain;
    ads.value = api.adsGain;
    invert.checked = api.invert;
  }
  const captureInput = (e) => {
    if (!capture || !root.offsetParent) {
      capture = null;
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === "Escape") {
      capture = null;
      status.textContent = "Rebinding cancelled.";
      render();
      return;
    }
    const c = e.code === "Delete" ? 0 : inputCode(e);
    if (
      e.type === "keydown" &&
      /^(BracketLeft|BracketRight|Digit[0-9]|Minus|Equal)$/.test(e.code)
    ) {
      status.textContent = "That shortcut is reserved for the range.";
      return;
    }
    if (!c && e.code !== "Delete") {
      status.textContent =
        "That input is reserved or unsupported. Choose another.";
      return;
    }
    if (api.bind(capture.a, capture.slot, c)) {
      capture = null;
      save();
      render();
    } else
      status.textContent =
        "Already assigned. Clear the other slot first, or choose another input.";
  };
  document.addEventListener("keydown", captureInput, true);
  document.addEventListener("mousedown", captureInput, true);
  const devicePanel = node("section");
  devicePanel.id = "m7-device";
  devicePanel.append(profiles, intro, options);
  table.id = "m7-binding-panel";
  table.prepend(
    node(
      "p",
      "Select a binding to change it. Escape cancels; Delete clears it. Primary and alternate inputs both work.",
    ),
  );
  root.append(status, devicePanel, table);
  if (padPanel) root.append(padPanel);
  tabs(
    root,
    [
      { label: "Device & aim", panel: devicePanel },
      { label: "Keybinds", panel: table },
      ...(padPanel ? [{ label: "Controller", panel: padPanel }] : []),
    ],
    "Controls categories",
  );
  tabs(table, panels, "Control bindings");
  const previous = api.onChange;
  api.onChange = () => {
    previous();
    render();
  };
  render();
}

export function mountFirstLaunch(api, onDone = () => {}) {
  if (api.selected) return;
  const dialog = node("dialog");
  dialog.className = "m7-welcome";
  dialog.setAttribute("aria-labelledby", "m7-welcome-title");
  const title = node("h1", "Choose your controls");
  title.id = "m7-welcome-title";
  const copy = node(
    "p",
    "Choose the device you use to aim. You can change any key later in Controls & keybinds.",
  );
  dialog.append(title, copy);
  for (const [id, label] of [
    ["mouse", "Mouse + keyboard"],
    ["trackpad", "Trackpad + keyboard"],
  ]) {
    const b = node("button", label);
    b.type = "button";
    b.dataset.firstProfile = id;
    b.addEventListener("click", () => {
      api.setProfile(id);
      api.selected = true;
      api.save();
      dialog.close();
      dialog.remove();
      onDone();
    });
    dialog.append(b);
  }
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
}
