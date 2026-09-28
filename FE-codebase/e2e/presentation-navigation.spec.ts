import { expect, test } from "@playwright/test";

test.use({ channel: "msedge", viewport: { width: 1440, height: 900 } });

const slide = (name: string) => ({
  ui: {
    elements: [{
      type: "text",
      position: { x: 100, y: 130 },
      size: { width: 800, height: 110 },
      font: { family: "Arial", size: 54, color: "#111111" },
      runs: [{ text: name }],
    }],
  },
  transition: "none",
});

test("overview jumps to a slide and its presentation link survives reload", async ({ page }) => {
  const deck = {
    id: "nav-test",
    title: "Navigation test",
    thumbnail: null,
    is_favorite: false,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    payload: { title: "Navigation test", slides: [slide("Start"), slide("Middle"), slide("Finish")] },
  };
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({
    json: { data: { id: "nav-session", token: "nav-token" } },
  }));
  await page.route("**/api/v1/decks/nav-test", route => route.fulfill({ json: { data: deck } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));

  await page.goto(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/editor-react/nav-test`);
  await expect(page.locator("#onboarding-canvas .konvajs-content canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.getByRole("button", { name: "Slide overview" }).click();
  await page.getByRole("button", { name: "Go to slide 3" }).click();

  await expect(page.getByText("3 / 3", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/editor-react\/nav-test\?present=1#3$/);
  await page.reload();
  await expect(page.getByTitle("Exit (Esc)")).toBeVisible();
  await expect(page.getByText("3 / 3", { exact: true })).toBeVisible();
});
