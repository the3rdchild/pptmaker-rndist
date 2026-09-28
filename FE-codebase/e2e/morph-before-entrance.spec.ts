import { expect, test } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const photo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360"><rect width="600" height="360" fill="#60b5dc"/></svg>',
)}`;

const frame = (x: number, width: number) => ({
  id: "linked-card",
  morph_id: "hero-card",
  type: "rectangle",
  position: { x, y: 180 },
  size: { width, height: 390 },
  fill: { color: "#082044" },
  stroke: { color: "#4aaee2", width: 2 },
});

test("entrance flights keep their canvas order around a morphed card", async ({ page }) => {
  const deck = {
    id: "morph-before-entrance-test",
    title: "Morph before entrance test",
    thumbnail: null,
    is_favorite: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    payload: {
      title: "Morph before entrance test",
      slides: [
        { transition: "none", ui: { elements: [frame(80, 350)] } },
        {
          transition: "morph",
          ui: {
            elements: [
              {
                type: "rectangle",
                position: { x: 140, y: 250 },
                size: { width: 600, height: 180 },
                fill: { color: "#ff315a" },
                animations: [{
                  effect: "fade-in", trigger: "after-previous", order: 1,
                  duration: 1200, delay: 0, easing: "ease-out",
                }],
              },
              frame(120, 660),
              {
                type: "image",
                position: { x: 140, y: 200 },
                size: { width: 620, height: 240 },
                data: photo,
                animations: [{
                  effect: "fade-in", trigger: "with-previous", order: 2,
                  duration: 1200, delay: 0, easing: "ease-out",
                }],
              },
              {
                type: "text",
                position: { x: 150, y: 460 },
                size: { width: 580, height: 60 },
                font: { family: "Arial", size: 36, color: "#ffffff" },
                runs: [{ text: "Photo and caption" }],
                animations: [{
                  effect: "rise", trigger: "with-previous", order: 3,
                  duration: 1200, delay: 0, easing: "ease-out",
                }],
              },
            ],
          },
        },
      ],
    },
  };
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({
    json: { data: { id: "morph-before-entrance-session", token: "test-token" } },
  }));
  await page.route("**/api/v1/decks/morph-before-entrance-test", route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));

  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/morph-before-entrance-test`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(page.locator(".fixed.inset-0 .konvajs-content canvas").first()).toBeVisible();
  await page.keyboard.press("ArrowRight");

  await expect(page.locator(".morph-flight")).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('div[style]')]
      .filter((node) => node.style.animationName.includes("anim-kf") && node.querySelector("canvas"))
      .length,
  ), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator(".morph-flight")).toHaveCount(0);
  const layers = await page.evaluate(() => {
    const flights = [...document.querySelectorAll<HTMLElement>('div[style]')]
      .filter((node) => node.style.animationName.includes("anim-kf") && node.querySelector("canvas"));
    const back = flights.find((node) => node.style.left === "140px");
    const front = flights.find((node) => node.style.left === "150px");
    const morphed = document.querySelector<HTMLElement>(".static-foreground-flight");
    const canvas = morphed?.querySelector("canvas");
    const morphOpacity = canvas?.getContext("2d")?.getImageData(
      Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1,
    ).data[3];
    return {
      back: Number(back?.style.zIndex),
      morphed: Number(morphed?.style.zIndex),
      front: Number(front?.style.zIndex),
      morphOpacity,
    };
  });
  expect(layers.back).toBeLessThan(layers.morphed);
  expect(layers.morphed).toBeLessThan(layers.front);
  expect(layers.morphOpacity).toBe(255);
});
