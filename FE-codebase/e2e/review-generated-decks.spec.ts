import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const reviewDir = resolve(process.cwd(), "..", "artifacts", "morph-review-2026-09-30");
test.skip(!existsSync(resolve(reviewDir, "review-deck-ids.json")), "Local generated review decks are unavailable");

async function openDeck(page: Page, name: "fresh-html-ai" | "fresh-html-ai-v2" | "morph-cases") {
  const ids = JSON.parse(readFileSync(resolve(reviewDir, "review-deck-ids.json"), "utf8"));
  const path = name === "morph-cases" ? "morph-cases-deck.json" : `${name}/deck.json`;
  const payload = JSON.parse(readFileSync(resolve(reviewDir, path), "utf8"));
  const deck = {
    id: ids[name], title: payload.title, payload, thumbnail: null, is_favorite: false,
    created_at: "2026-09-30", updated_at: "2026-09-30",
  };
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({ json: { data: { id: "review-session", token: "test-token" } } }));
  await page.route(`**/api/v1/decks/${deck.id}`, route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));
  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/${deck.id}`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 5", { exact: true })).toBeVisible();
  return payload;
}

test("generated freestyle deck keeps its varied transitions and many morph pairs", async ({ page }) => {
  const deck = await openDeck(page, "fresh-html-ai");
  expect(deck.slides.map((slide: { transition: string }) => slide.transition)).toEqual(["none", "morph", "slide-left", "fade-white", "morph"]);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.locator(".morph-flight").count()).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(260);
  await page.screenshot({ path: resolve(reviewDir, "fresh-html-ai", "slide-1-to-2-morph.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("3 / 5", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("4 / 5", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.locator(".morph-flight").count()).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(260);
  await page.screenshot({ path: resolve(reviewDir, "fresh-html-ai", "slide-4-to-5-morph.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
});

test("new freestyle deck renders nested photo and reuses it across a morph", async ({ page }) => {
  const deck = await openDeck(page, "fresh-html-ai-v2");
  expect(deck.slides.map((slide: { transition: string }) => slide.transition)).toEqual(["none", "fade-white", "morph", "slide-left", "morph"]);
  const photoBefore = deck.slides[3].ui.elements.find((element: { morph_id?: string }) => element.morph_id === "pour-scene");
  const photoAfter = deck.slides[4].ui.elements.find((element: { morph_id?: string }) => element.morph_id === "pour-scene");
  expect(photoBefore.type).toBe("image");
  expect(photoAfter.type).toBe("image");
  expect(photoAfter.data).toBe(photoBefore.data);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => page.locator(".morph-flight").count()).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(180);
  await page.screenshot({ path: resolve(reviewDir, "fresh-html-ai-v2", "slide-2-to-3-morph.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".morph-image-flight")).toBeVisible();
  await page.waitForTimeout(180);
  await page.screenshot({ path: resolve(reviewDir, "fresh-html-ai-v2", "slide-4-to-5-morph.png") });
  await expect(page.locator(".morph-flight")).toHaveCount(0);
});

test("review deck animates four linked objects through varied shapes and photo content", async ({ page }) => {
  await openDeck(page, "morph-cases");
  for (let slide = 2; slide <= 5; slide += 1) {
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.locator(".morph-flight").count()).toBeGreaterThanOrEqual(4);
    if (slide <= 3) await expect(page.locator(".morph-shape-flight")).toHaveCount(4);
    else await expect(page.locator(".morph-content-flight")).toHaveCount(1);
    await page.waitForTimeout(260);
    await page.screenshot({ path: resolve(reviewDir, `morph-case-${slide - 1}-to-${slide}.png`) });
    await expect(page.locator(".morph-flight")).toHaveCount(0);
    await expect(page.getByText(`${slide} / 5`, { exact: true })).toBeVisible();
  }
});
