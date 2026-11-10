import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { startServer } from "../tools/serve.mjs";
const server = await startServer(8147);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  if (!localStorage.getItem("recoilRange.settings.v1"))
    localStorage.setItem(
      "recoilRange.settings.v1",
      JSON.stringify({ graphics: "low", renderScale: 0.5 }),
    );
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (msg, v) => {
  assert.ok(v, msg);
  console.log("PASS " + msg);
};
const evalR = (fn) => page.evaluate(fn);
try {
  await page.goto("http://127.0.0.1:8147/index.html?test");
  await page.waitForFunction(() => window.__range?.ready);
  await page.waitForSelector("dialog[open]");
  check(
    "first launch asks for controls",
    (await page.locator("[data-first-profile]").count()) === 2,
  );
  await page.keyboard.press("Escape");
  check(
    "first launch retains keyboard focus",
    (await page.locator("dialog[open]").count()) === 1,
  );
  await page.click("[data-first-profile=mouse]");
  await page.reload();
  await page.waitForFunction(() => window.__range?.ready);
  check(
    "profile persists across reload",
    (await page.locator("dialog[open]").count()) === 0,
  );
  await page.click("#go-settings");
  await page.focus("#all-settings-tab");
  await page.keyboard.press("Home");
  check(
    "keyboard navigation skips hidden match tab",
    await page
      .locator("#all-settings-tab")
      .evaluate(
        (e) =>
          e === document.activeElement &&
          e.getAttribute("aria-selected") === "true",
      ),
  );
  await page.click("#m7-settings-1-tab");
  check(
    "settings tabs reveal only the requested category",
    (await page.locator("#m7-settings-1").isVisible()) &&
      !(await page.locator("#m7-settings-0").isVisible()),
  );
  await page.focus("#m7-settings-1-tab");
  await page.keyboard.press("ArrowRight");
  check(
    "arrow keys move active tab and focus",
    await page
      .locator("#m7-settings-2-tab")
      .evaluate(
        (e) =>
          e === document.activeElement &&
          e.getAttribute("aria-selected") === "true",
      ),
  );
  await page.click("#go-play");
  await page.click("#go-controls");
  await page.click("#m7-binding-panel-tab");
  await page.click("#m7-bindings-1-tab");
  await page.click('[data-action=ability][data-slot="0"]');
  await page.keyboard.press("KeyQ");
  check(
    "duplicate binding is rejected with feedback",
    (await page.locator("#controls-root [role=status]").textContent()).includes(
      "Already assigned",
    ),
  );
  await page.keyboard.press("KeyO");
  check(
    "valid remap is saved",
    (await page
      .locator('[data-action=ability][data-slot="0"]')
      .textContent()) === "O",
  );
  await page.reload();
  await page.waitForFunction(() => window.__range?.ready);
  check(
    "remap survives reload",
    await evalR(() => __range.controls.e.mc_binding(10, 0) === 15),
  );
  await page.click("#go-controls");
  await page.click("[data-profile=mouse]");
  await evalR(async () => {
    __range.manual(true);
    await __range.modeStart("bomb", {
      map: { bomb: "ranch" },
      op: { bomb: "glitch" },
      seed: 7,
    });
  });
  await page.keyboard.down("KeyQ");
  check(
    "Q leans while abilities are enabled",
    await evalR(() => __range.modeGame().h.in.leanL),
  );
  await page.keyboard.up("KeyQ");
  await page.keyboard.down("KeyE");
  check(
    "E leans in bomb mode",
    await evalR(() => __range.modeGame().h.in.leanR),
  );
  await page.keyboard.up("KeyE");
  const middle = await evalR(() => {
    const G = __range.modeGame();
    let calls = [];
    const old = G.m.ab.q;
    G.m.ab.q = (_, down) => calls.push(down);
    document.dispatchEvent(
      new MouseEvent("mousedown", { button: 1, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", { button: 1, bubbles: true }),
    );
    G.m.ab.q = old;
    return calls;
  });
  check(
    "middle click reaches ability press and release",
    JSON.stringify(middle) === "[true,false]",
  );
  const interact = await evalR(() => {
    const G = __range.modeGame();
    let calls = [];
    const old = G.m.rules.key;
    G.m.rules.key = (_, code, down) => calls.push([code, down]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    G.m.rules.key = old;
    return calls;
  });
  check(
    "F reaches the existing bomb interaction rule",
    JSON.stringify(interact) === '[["KeyE",true],["KeyE",false]]',
  );
  const drone = await evalR(() => {
    document.dispatchEvent(
      new MouseEvent("mousedown", { button: 1, bubbles: true }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", { button: 1, bubbles: true }),
    );
    return !!__range.modeGame().me.ab.drone;
  });
  check("middle click launches the real prep drone", drone);
  await page.keyboard.press("KeyV");
  check(
    "drone recall remains operational",
    await evalR(() => !__range.modeGame().me.ab.drone),
  );
  await page.keyboard.down("KeyW");
  await evalR(() =>
    document.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    ),
  );
  await evalR(() => window.dispatchEvent(new Event("blur")));
  check(
    "focus loss releases movement and fire",
    await evalR(() => {
      const h = __range.modeGame().h;
      return !h.in.fwd && !h.in.fire;
    }),
  );
  await page.keyboard.up("KeyW");
  await evalR(() =>
    document.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, bubbles: true }),
    ),
  );
  await evalR(() => {
    __range.battleLeave();
    document.getElementById("menu").hidden = false;
    document.getElementById("pause-quit").click();
  });
  await page.click("#go-controls");
  await page.click("[data-profile=trackpad]");
  await evalR(async () => {
    await __range.modeStart("tdm", {
      map: { tdm: "containers", bomb: "ranch" },
      seed: 7,
    });
  });
  await page.keyboard.press("KeyL");
  check(
    "trackpad ADS toggles on",
    await evalR(() => __range.modeGame().h.in.ads),
  );
  await page.keyboard.press("KeyL");
  check(
    "trackpad ADS toggles off",
    await evalR(() => !__range.modeGame().h.in.ads),
  );
  await page.keyboard.down("KeyJ");
  check(
    "trackpad keyboard fire and automatic ADS work",
    await evalR(
      () => __range.modeGame().h.in.fire && __range.modeGame().h.in.ads,
    ),
  );
  await page.keyboard.up("KeyJ");
  check(
    "automatic ADS releases with fire",
    await evalR(() => !__range.modeGame().h.in.ads),
  );
  await evalR(() => {
    __range.battleLeave();
    document.getElementById("menu").hidden = false;
    document.getElementById("pause-quit").click();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#go-controls");
  await page.click("#m7-binding-panel-tab");
  check(
    "controls fit a narrow viewport",
    await page.evaluate(
      () =>
        document.getElementById("menu-panel").getBoundingClientRect().right <=
        innerWidth,
    ),
  );
  mkdirSync("tests/output/m7", { recursive: true });
  await page.screenshot({ path: "tests/output/m7/controls-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click("#go-play");
  await page.screenshot({ path: "tests/output/m7/menu.png" });
  await page.click("[data-mode-filter=online]");
  check(
    "online filter shows the existing network mode",
    (await page.locator(".mode-card:visible").count()) === 1 &&
      (await page.locator("[data-mode=net]").isVisible()),
  );
  await page.click("[data-mode-filter=all]");
  await page.click("[data-mode=tdm]");
  await page.click("#setup-next");
  await page.waitForSelector(".op-card");
  await page.fill("#ops-search", "Muse");
  check(
    "operator search filters the real catalogue",
    (await page.locator(".op-card:visible").count()) === 1,
  );
  await page.click("#ops-back");
  await page.click("#setup-back");
  await page.click("[data-mode=range]");
  await page.click("#setup-next");
  await page.fill("#weapon-search", "Scorpion");
  check(
    "weapon search filters the existing loadout",
    (await page.locator("#loadout .slot:visible").count()) === 1,
  );
  await page.click("#arm-back");
  await page.click("#setup-back");

  check("no browser exceptions", errors.length === 0);
} catch (error) {
  console.error(
    "UI diagnostics",
    await page.evaluate(() => ({
      menu: document.getElementById("menu").hidden,
      armory: document.getElementById("armory").hidden,
      controls: document.getElementById("go-controls").outerHTML,
      parents: document
        .getElementById("go-controls")
        .parentElement.outerHTML.slice(0, 1500),
      notice: document.getElementById("notice").textContent,
    })),
  );
  console.error("Page errors", errors);
  throw error;
} finally {
  await browser.close();
  server.close();
}
