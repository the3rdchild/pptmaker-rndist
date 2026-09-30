import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const reviewDir = resolve(process.cwd(), "..", "artifacts", "morph-review-2026-09-30");
test.skip(!existsSync(resolve(reviewDir, "espresso-source.json")), "Local source deck fixtures are unavailable");

async function openDeck(page: Page, name: string) {
  const deck = JSON.parse(readFileSync(resolve(reviewDir, `${name}-source.json`), "utf8").replace(/^\uFEFF/, ""));
  deck.payload.slides = deck.payload.slides.map((slide: Record<string, unknown>, index: number) => ({
    ...slide,
    transition: index === 0 ? "none" : "morph",
  }));
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({ json: { data: { id: "morph-review-session", token: "test-token" } } }));
  await page.route(`**/api/v1/decks/${deck.id}`, route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));
  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/${deck.id}`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText(`1 / ${deck.payload.slides.length}`, { exact: true })).toBeVisible();
  await page.waitForTimeout(2600);
}

test("Espresso outline moves and changes contour continuously", async ({ page }) => {
  await openDeck(page, "espresso");
  await page.keyboard.press("ArrowRight");
  const flight = page.locator(".morph-shape-flight");
  await expect(flight).toBeVisible();
  const samples = await page.evaluate(async () => {
    const values = new Set<string>();
    for (let tick = 0; tick < 22; tick += 1) {
      const d = document.querySelector(".morph-shape-flight path")?.getAttribute("d");
      if (d) values.add(d);
      await new Promise(requestAnimationFrame);
    }
    return [...values];
  });
  expect(samples.length).toBeGreaterThan(5);
  await page.screenshot({ path: resolve(reviewDir, "espresso-morph-mid.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  await page.screenshot({ path: resolve(reviewDir, "espresso-slide-2.png") });
});

test("Karhutla target image gains opacity during its moving morph", async ({ page }) => {
  await openDeck(page, "karhutla");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  await page.waitForTimeout(2600);
  await page.keyboard.press("ArrowRight");
  const target = page.locator(".morph-target-content");
  await expect(target).toBeVisible();
  const samples = await page.evaluate(async () => {
    const values: { opacity: number; left: number }[] = [];
    for (let tick = 0; tick < 55; tick += 1) {
      const content = document.querySelector<HTMLElement>(".morph-target-content");
      const wrapper = document.querySelector<HTMLElement>(".morph-content-flight");
      if (content && wrapper) values.push({ opacity: Number(getComputedStyle(content).opacity), left: parseFloat(getComputedStyle(wrapper).left) });
      await new Promise(requestAnimationFrame);
    }
    return values;
  });
  expect(samples.some(sample => sample.opacity > 0.1 && sample.opacity < 0.9), JSON.stringify(samples)).toBe(true);
  expect(new Set(samples.map(sample => Math.round(sample.left))).size).toBeGreaterThan(3);
  await page.screenshot({ path: resolve(reviewDir, "karhutla-morph-mid.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  await page.screenshot({ path: resolve(reviewDir, "karhutla-slide-3.png") });
});
