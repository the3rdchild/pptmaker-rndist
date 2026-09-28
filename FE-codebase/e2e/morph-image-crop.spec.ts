import { expect, test } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const picture = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360"><rect width="600" height="360" fill="#17324d"/><circle cx="300" cy="180" r="100" fill="#6dd5ed"/><rect x="20" y="20" width="60" height="60" fill="#ffe287"/></svg>',
)}`;

const slide = (
  position: { x: number; y: number },
  size: { width: number; height: number },
  transition: "none" | "morph",
  headline: string,
) => ({
  transition,
  ui: {
    elements: [
      {
        id: "same-headline-slot",
        type: "text",
        morph_id: "title",
        position: { x: position.x, y: position.y - 75 },
        size: { width: 850, height: 65 },
        font: { family: "Arial", size: 45, color: "#ffffff" },
        runs: [{ text: headline }],
      },
      {
        id: "same-picture",
        type: "image",
        morph_id: "hero-picture",
        position,
        size,
        data: picture,
        fit: "cover",
        border_radius: 18,
      },
    ],
  },
});

test("morph crops a resized image but leaves changed text out of the flight", async ({ page }) => {
  const deck = {
    id: "morph-crop-test",
    title: "Morph crop test",
    thumbnail: null,
    is_favorite: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    payload: {
      title: "Morph crop test",
      slides: [
        slide({ x: 90, y: 100 }, { width: 420, height: 260 }, "none", "Studi Kasus Fiktif"),
        slide({ x: 570, y: 350 }, { width: 590, height: 120 }, "morph", "Perbandingan Layanan"),
      ],
    },
  };
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({
    json: { data: { id: "morph-session", token: "morph-token" } },
  }));
  await page.route("**/api/v1/decks/morph-crop-test", route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));

  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/morph-crop-test`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.morphCropMid = "0";
    const deadline = performance.now() + 4_000;
    const sample = () => {
      const node = document.querySelector(".morph-image-flight");
      if (node) {
        const style = getComputedStyle(node);
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        if (width > 440 && width < 570 && height > 140 && height < 240) {
          document.documentElement.dataset.morphCropMid = "1";
          return;
        }
      }
      if (performance.now() < deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("ArrowRight");

  const flight = page.locator(".morph-image-flight").first();
  await expect(flight).toBeVisible({ timeout: 15_000 });
  await expect(flight.locator("canvas")).toHaveCSS("object-fit", "cover");
  await expect(flight).toHaveCSS("overflow", "hidden");
  await expect(flight).toHaveCSS("transform", "none");
  await expect(page.locator('div[style*="z-index: 4"][style*="will-change: transform"]')).toHaveCount(0);
  const properties = await flight.evaluate((node) => getComputedStyle(node).transitionProperty);
  expect(properties).toContain("width");
  expect(properties).toContain("height");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.morphCropMid)).toBe("1");
});
