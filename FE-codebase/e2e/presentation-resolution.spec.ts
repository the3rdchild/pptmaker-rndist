import { expect, test, type Page } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1920, height: 1080 } });

const title = (x: number, animated = false) => ({
  type: "text",
  morph_id: "title",
  position: { x, y: 120 },
  size: { width: 600, height: 100 },
  font: { family: "Arial", size: 52, color: "#111111" },
  runs: [{ text: "Presentation resolution" }],
  ...(animated ? { animations: [{
    effect: "rise", trigger: "after-previous", duration: 450,
    delay: 0, easing: "ease-out", order: 1,
  }] } : {}),
});

async function openDeck(page: Page, animated = false, morphGrowth = 1, sourceHeight = 120) {
  const marker = (x: number, width = 120, height = 120) => ({
    type: "rectangle", morph_id: "marker", position: { x, y: 320 },
    size: { width, height }, fill: { color: "#0a766b" },
  });
  const deck = {
    id: "resolution-test", title: "Resolution test", thumbnail: null,
    is_favorite: false, created_at: "2026-01-01", updated_at: "2026-01-01",
    payload: { title: "Resolution test", slides: [
      { ui: { elements: [title(80, animated), marker(800, 120, sourceHeight)] }, transition: "none" },
      { ui: { elements: [title(80), marker(morphGrowth > 1 ? 800 : 1060, 120 * morphGrowth, 120 * morphGrowth)] }, transition: "morph" },
    ] },
  };
  await page.addInitScript(() => {
    localStorage.setItem("ppt-maker:onboarding-seen", "1");
  });
  await page.route("**/api/v1/session", route => route.fulfill({
    json: { data: { id: "resolution-session", token: "resolution-token" } },
  }));
  await page.route("**/api/v1/decks/resolution-test", route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));
  await page.goto("http://localhost:3000/editor-react/resolution-test");
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
}

const presentation = (page: Page) => page.getByTitle("Exit (Esc)").locator("../..");

test("presentation canvas follows viewport size while thumbnails keep their normal resolution", async ({ page }) => {
  await openDeck(page);
  const thumbnail = page.locator("[data-template-v2-konva-surface]").filter({
    hasNot: page.locator('input[type="file"]'),
  }).first().locator("canvas").first();
  await expect(thumbnail).toHaveJSProperty("width", 1280);
  await page.getByRole("button", { name: "Present", exact: true }).click();
  const layers = presentation(page).locator(".konvajs-content canvas");
  // 1920x1080 displays each slide pixel at 1.5x; include the editor's 1.25x oversampling.
  await expect(layers.nth(0)).toHaveJSProperty("width", 2400);
  await expect(layers.nth(1)).toHaveJSProperty("width", 2400);
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect(layers.nth(0)).toHaveJSProperty("width", 3200);
  await expect(layers.nth(1)).toHaveJSProperty("width", 3200);
  await page.getByTitle("Exit (Esc)").click();
  await expect(thumbnail).toHaveJSProperty("width", 1280);
});

test.describe("high density presentation", () => {
  test.use({ deviceScaleFactor: 2 });

  for (const [name, sourceHeight] of [["growing", 120], ["asymmetrically growing", 3]] as const) {
  test(`${name} morph retains enough pixels for its larger destination`, async ({ page }) => {
    await openDeck(page, false, 3, sourceHeight);
    await page.getByRole("button", { name: "Present", exact: true }).click();
    const root = presentation(page);
    await expect(root.locator(".konvajs-content canvas").nth(1)).toHaveJSProperty("width", 4800);
    await page.evaluate(() => {
      const captures: { width: number; height: number; color: number[] }[] = [];
      const seen = new Set<HTMLCanvasElement>();
      (window as unknown as { growingMorphCaptures: typeof captures }).growingMorphCaptures = captures;
      new MutationObserver(() => {
        const root = document.querySelector('[title="Exit (Esc)"]')?.parentElement?.parentElement;
        root?.querySelectorAll("canvas").forEach(canvas => {
          if (canvas.parentElement?.style.zIndex === "4" && !seen.has(canvas)) {
            seen.add(canvas);
            captures.push({
              width: canvas.width,
              height: canvas.height,
              color: Array.from(canvas.getContext("2d")!.getImageData(
                Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
              ).data),
            });
          }
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.keyboard.press("ArrowRight");
    const captures = () => page.evaluate(() =>
      (window as unknown as { growingMorphCaptures: { width: number; height: number; color: number[] }[] }).growingMorphCaptures,
    );
    await expect.poll(async () => (await captures()).length).toBeGreaterThan(0);
    // Both source sizes grow to 360x360 at 3.75 backing pixels per slide pixel.
    for (const capture of await captures()) {
      expect(capture.width).toBe(1350);
      expect(capture.height).toBe(1350);
      expect(capture.color).toEqual([10, 118, 107, 255]);
    }
    await expect(root.locator(".konvajs-content")).toBeVisible();
  });
  }

  test("an oversized morph uses the slide crossfade without allocating a flight texture", async ({ page }) => {
    await openDeck(page, false, 100);
    await page.getByRole("button", { name: "Present", exact: true }).click();
    const root = presentation(page);
    await expect(root.locator(".konvajs-content canvas").nth(1)).toHaveJSProperty("width", 4800);
    await page.evaluate(() => {
      const state = { flights: 0 };
      (window as unknown as { oversizedMorph: typeof state }).oversizedMorph = state;
      new MutationObserver(() => {
        const root = document.querySelector('[title="Exit (Esc)"]')?.parentElement?.parentElement;
        root?.querySelectorAll("canvas").forEach(canvas => {
          if (canvas.parentElement?.style.zIndex === "4") state.flights += 1;
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.keyboard.press("ArrowRight");
    await expect(root.locator(".slide-transition-morph-fade")).toHaveCount(1);
    await expect(root.locator(".slide-transition-morph-fade")).toHaveCount(0);
    expect(await page.evaluate(() =>
      (window as unknown as { oversizedMorph: { flights: number } }).oversizedMorph.flights,
    )).toBe(0);
    await expect(root.locator(".konvajs-content")).toBeVisible();
  });

  test("frozen slides, rise animations and morph flights retain the live canvas resolution", async ({ page }) => {
    await openDeck(page, true);
    await page.evaluate(() => {
      type Capture = { kind: string; ratio: number; animation: string; duration: string };
      const captures: Capture[] = [];
      (window as unknown as { resolutionCaptures: Capture[] }).resolutionCaptures = captures;
      const observer = new MutationObserver(() => {
        const root = document.querySelector('[title="Exit (Esc)"]')?.parentElement?.parentElement;
        root?.querySelectorAll("canvas").forEach(canvas => {
          if (canvas.closest(".konvajs-content")) return;
          const host = canvas.parentElement!;
          const animation = host.style.animationName;
          const width = parseFloat(getComputedStyle(canvas).width);
          captures.push({
            kind: animation.includes("rise") ? "rise" : host.style.zIndex === "4" ? "morph" : "slide",
            ratio: canvas.width / width,
            animation,
            duration: host.style.animationDuration,
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    });
    await page.getByRole("button", { name: "Present", exact: true }).click();
    const root = presentation(page);
    await expect(root.locator(".konvajs-content canvas").nth(1)).toHaveJSProperty("width", 4800);
    const captures = () => page.evaluate(() =>
      (window as unknown as { resolutionCaptures: { kind: string; ratio: number; animation: string; duration: string }[] }).resolutionCaptures,
    );
    await expect.poll(async () => (await captures()).some(c => c.kind === "rise")).toBe(true);
    const rise = (await captures()).find(c => c.kind === "rise")!;
    expect(rise.ratio).toBeGreaterThanOrEqual(3.74);
    expect(rise.animation).toBe("anim-kf-rise");
    expect(rise.duration).toBe("450ms");
    // The live stage becomes visible again only after its opening rise completes.
    await expect(root.locator(".konvajs-content")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await captures()).some(c => c.kind === "morph")).toBe(true);
    for (const kind of ["slide", "morph"]) {
      const matching = (await captures()).filter(c => c.kind === kind);
      expect(matching.length).toBeGreaterThan(0);
      expect(Math.min(...matching.map(c => c.ratio)), `${kind} resolution`).toBeGreaterThanOrEqual(3.74);
    }
    await expect(root.locator(".konvajs-content")).toBeVisible();
  });
});
