import { expect, test } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#27add0"/><circle cx="240" cy="160" r="100" fill="#ffde7a"/></svg>')}`;
const frame = (type: "rectangle" | "ellipse" | "path" | "image", x: number, y: number) => ({
  type, morph_id: "hero", position: { x, y }, size: { width: 300, height: 300 },
  ...(type === "rectangle" ? { border_radius: 24 } : {}),
  ...(type === "path" ? { d: "M 150 0 L 300 300 L 0 300 Z", view_box: { width: 300, height: 300 } } : {}),
  ...(type === "image" ? { data: photo, fit: "cover" } : { stroke: { color: "#f5bf72", width: 4, opacity: 1 }, fill: null }),
});

test("shape contours change through the flight and image content fades while moving in both directions", async ({ page }) => {
  const types = ["rectangle", "ellipse", "path", "image", "path"] as const;
  const deck = {
    id: "morph-shape-content-test", title: "Morph contour review", thumbnail: null, is_favorite: false,
    created_at: "2026-01-01", updated_at: "2026-01-01",
    payload: { title: "Morph contour review", slides: types.map((type, index) => ({
      transition: index === 0 ? "none" : "morph",
      ui: { background: "#14252b", elements: [frame(type, 80 + index * 170, 180)] },
    })) },
  };
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({ json: { data: { id: "morph-shape-session", token: "test-token" } } }));
  await page.route("**/api/v1/decks/morph-shape-content-test", route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));
  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/morph-shape-content-test`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("1 / 5", { exact: true })).toBeVisible();

  for (let index = 1; index < types.length; index += 1) {
    await page.keyboard.press("ArrowRight");
    if (index <= 2) {
      const flight = page.locator(".morph-shape-flight");
      await expect(flight).toBeVisible();
      const paths = await page.evaluate(async () => {
        const values = new Set<string>();
        for (let tick = 0; tick < 25; tick += 1) {
          const path = document.querySelector(".morph-shape-flight path");
          if (path) values.add(path.getAttribute("d") ?? "");
          await new Promise(requestAnimationFrame);
        }
        return [...values];
      });
      expect(paths.length).toBeGreaterThan(5);
    } else {
      const flight = page.locator(".morph-content-flight");
      await expect(flight).toBeVisible();
      const samples = await page.evaluate(async (transitionIndex) => {
        const values: { opacity: number; left: number; clip: string }[] = [];
        for (let tick = 0; tick < 55; tick += 1) {
          const target = document.querySelector<HTMLElement>(".morph-target-content");
          const clipped = document.querySelector<HTMLElement>(transitionIndex === 3 ? ".morph-target-content" : ".morph-source-content");
          const wrapper = document.querySelector<HTMLElement>(".morph-content-flight");
          if (target && wrapper && clipped) values.push({ opacity: Number(getComputedStyle(target).opacity), left: parseFloat(getComputedStyle(wrapper).left), clip: getComputedStyle(clipped).clipPath });
          await new Promise(requestAnimationFrame);
        }
        return values;
      }, index);
      expect(samples.some((sample) => sample.opacity > .15 && sample.opacity < .85), `slide ${index + 1}: ${JSON.stringify(samples)}`).toBe(true);
      expect(new Set(samples.map((sample) => Math.round(sample.left))).size).toBeGreaterThan(3);
      expect(new Set(samples.map((sample) => sample.clip)).size).toBeGreaterThan(5);
    }
    await expect(page.locator(".morph-flight")).toHaveCount(0);
    await expect(page.getByText(`${index + 1} / 5`, { exact: true })).toBeVisible();
  }
});
