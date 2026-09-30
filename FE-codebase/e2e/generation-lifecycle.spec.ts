import { expect, test, type Page } from "@playwright/test";

test.use({ channel: "msedge" });

const slides = Array.from({ length: 5 }, (_, index) => ({
  ui: { background: "#102a20", elements: [{
    type: "text", position: { x: 64, y: 80 }, size: { width: 900, height: 100 },
    font: { family: "Arial", size: 48, color: "#ffffff" },
    runs: [{ text: `Biliar ${index + 1}` }], morph_id: "title",
  }] },
  transition: index === 0 ? "none" : "morph",
}));
const outline = "# Biliar\n" + slides.map((_, index) => `## Biliar ${index + 1}\nTeknik permainan.\nTransition: morph`).join("\n");
const url = "http://localhost:3000/editor-react/lifecycle-test?" + new URLSearchParams({
  prompt: outline, mode: "html", images: "stock", transitions: "on", gen: "openrouter-gpt-sol",
});

async function mockDeck(page: Page, existing: boolean) {
  let deck = {
    id: "lifecycle-test", title: "Biliar", thumbnail: null, is_favorite: false,
    created_at: "2026-01-01", updated_at: "2026-01-01",
    payload: existing ? { title: "Biliar", slides } : null as any,
  };
  const writes: any[] = [];
  await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
  await page.route("**/api/v1/session", route => route.fulfill({ json: { data: { id: "lifecycle", token: "lifecycle-token" } } }));
  await page.route("**/api/fonts", route => route.fulfill({ json: { fonts: {} } }));
  await page.route("**/api/v1/decks/lifecycle-test", async route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      writes.push(body);
      deck = { ...deck, ...body };
    }
    await route.fulfill({ json: { data: deck } });
  });
  return { writes, saved: () => deck.payload };
}

test("opening a populated deck through its old prompt URL does not regenerate or clear it", async ({ page }) => {
  const storage = await mockDeck(page, true);
  let generations = 0;
  await page.route("**/api/html-slides/generate", async route => {
    generations += 1;
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "error", message: "unexpected regeneration" }) + "\n" });
  });
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
  // Observe past the 1500ms autosave deadline: a transient clear must never
  // reach persistent storage even if no slide response has arrived yet.
  await page.waitForTimeout(1900);
  expect(generations).toBe(0);
  expect(storage.writes.filter(body => body.payload.slides.length !== 5)).toEqual([]);
  expect(storage.saved().slides).toHaveLength(5);
});

test("new HTML generation saves all five slides and a reload cannot start it again", async ({ page }) => {
  const storage = await mockDeck(page, false);
  let generations = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/html-slides/generate", async route => {
    generations += 1;
    await pending;
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "outline", title: "Biliar", slides: slides.map((_, i) => `Biliar ${i + 1}`) },
      ...slides.map((slide, index) => ({ type: "slide", index, ...slide, heading: `Biliar ${index + 1}`, summary: "1 text" })),
      { type: "done", title: "Biliar", count: 5 },
    ].map(event => JSON.stringify(event)).join("\n") + "\n" });
  });
  try {
    await page.goto(url);
    await expect.poll(() => generations).toBe(1);
    await page.waitForTimeout(1900);
    expect(storage.writes).toEqual([]);
  } finally {
    release();
  }
  await expect.poll(() => storage.saved()?.slides?.length).toBe(5);
  expect(storage.writes.every(body => body.payload.slides.length === 5)).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Present", exact: true })).toBeVisible();
  await page.waitForTimeout(1900);
  expect(generations).toBe(1);
  expect(storage.saved().slides).toHaveLength(5);
  await page.getByTitle("Double-click to rename").dblclick();
  const title = page.locator('header input').first();
  await title.fill("Biliar edited");
  await title.press("Enter");
  await expect.poll(() => storage.saved()?.title).toBe("Biliar edited");
  expect(storage.saved().slides).toHaveLength(5);
});

test("finished status bar shows outline plus all slide generation charges", async ({ page }) => {
  await mockDeck(page, false);
  await page.route("**/api/html-slides/generate", route => route.fulfill({
    contentType: "application/x-ndjson",
    body: [
      { type: "outline", title: "Biliar", slides: slides.map((_, i) => `Biliar ${i + 1}`) },
      ...slides.map((slide, index) => ({ type: "slide", index, ...slide, heading: `Biliar ${index + 1}`, summary: "1 text" })),
      { type: "done", title: "Biliar", count: 5, costUsd: 0.0004271 },
    ].map(event => JSON.stringify(event)).join("\n") + "\n",
  }));
  await page.goto(`${url}&outline-cost-usd=0.0004625`);
  await expect(page.getByText("Presentation ready", { exact: true })).toBeVisible();
  await expect(page.getByText("AI cost $0.0008896", { exact: true })).toBeVisible();
});

test("an interrupted generation never persists an empty or starter-template deck", async ({ page }) => {
  const storage = await mockDeck(page, false);
  await page.route("**/api/html-slides/generate", route => route.fulfill({
    contentType: "application/x-ndjson",
    body: [
      { type: "outline", title: "Biliar", slides: slides.map((_, i) => `Biliar ${i + 1}`) },
      { type: "slide", index: 0, ...slides[0], heading: "Biliar 1", summary: "1 text" },
      { type: "error", message: "Model connection interrupted" },
    ].map(event => JSON.stringify(event)).join("\n") + "\n",
  }));
  await page.goto(url);
  await expect(page.getByText("Model connection interrupted", { exact: true })).toBeVisible();
  await page.waitForTimeout(1900);
  expect(storage.writes).toEqual([]);
  expect(storage.saved()).toBeNull();
});

test("a failed final save stays visible as an error and never reports a persisted deck", async ({ page }) => {
  const storage = await mockDeck(page, false);
  let puts = 0;
  let generations = 0;
  await page.route("**/api/v1/decks/lifecycle-test", async route => {
    if (route.request().method() === "PUT" && ++puts === 1) {
      expect(route.request().postDataJSON().payload.slides).toHaveLength(5);
      await route.fulfill({ status: 503, json: { message: "Test storage unavailable" } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/html-slides/generate", route => {
    generations++;
    return route.fulfill({
    contentType: "application/x-ndjson",
    body: [
      { type: "outline", title: "Biliar", slides: slides.map((_, i) => `Biliar ${i + 1}`) },
      ...slides.map((slide, index) => ({ type: "slide", index, ...slide, heading: `Biliar ${index + 1}`, summary: "1 text" })),
      { type: "done", title: "Biliar", count: 5 },
    ].map(event => JSON.stringify(event)).join("\n") + "\n",
    });
  });
  await page.goto(url);
  await expect(page.getByText("Test storage unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  expect(storage.saved()).toBeNull();
  // Retain the completed work on screen even when the persistence request fails.
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.getByText("5 / 5", { exact: true })).toBeVisible();
  await page.getByTitle("Exit (Esc)").click();
  await page.getByRole("button", { name: "Retry Save", exact: true }).click();
  await expect.poll(() => storage.saved()?.slides?.length).toBe(5);
  await expect(page.getByText("Test storage unavailable", { exact: true })).toHaveCount(0);
  expect(generations).toBe(1);
});

test("edits during the final generation save are included before completion", async ({ page }) => {
  const storage = await mockDeck(page, false);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let puts = 0;
  await page.route("**/api/v1/decks/lifecycle-test", async route => {
    if (route.request().method() === "PUT" && ++puts === 1) await gate;
    await route.fallback();
  });
  await page.route("**/api/html-slides/generate", route => route.fulfill({
    contentType: "application/x-ndjson",
    body: [
      { type: "outline", title: "Biliar", slides: slides.map((_, i) => `Biliar ${i + 1}`) },
      ...slides.map((slide, index) => ({ type: "slide", index, ...slide, heading: `Biliar ${index + 1}`, summary: "1 text" })),
      { type: "done", title: "Biliar", count: 5 },
    ].map(event => JSON.stringify(event)).join("\n") + "\n",
  }));
  try {
    await page.goto(url);
    await expect.poll(() => puts).toBe(1);
    expect(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
    await page.getByTitle("Double-click to rename").dblclick();
    const title = page.locator("header input").first();
    await title.fill("Edited while saving");
    await title.press("Enter");
    await expect(page.getByText("Presentation ready", { exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect.poll(() => storage.saved()?.title).toBe("Edited while saving");
  await expect(page.getByText("Presentation ready", { exact: true })).toBeVisible();
  expect(storage.saved().slides).toHaveLength(5);
});

test("a failed older autosave cannot overwrite a newer queued edit", async ({ page }) => {
  const storage = await mockDeck(page, true);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let puts = 0;
  await page.route("**/api/v1/decks/lifecycle-test", async route => {
    if (route.request().method() === "PUT" && ++puts === 1) {
      await gate;
      await route.fulfill({ status: 503, json: { message: "Older save failed" } });
      return;
    }
    await route.fallback();
  });
  try {
    await page.goto(url);
    for (const name of ["Older edit", "Latest edit"]) {
      await page.getByTitle("Double-click to rename").dblclick();
      const title = page.locator("header input").first();
      await title.fill(name);
      await title.press("Enter");
      await page.waitForTimeout(1900);
    }
    expect(puts).toBe(1);
  } finally { release(); }
  await expect.poll(() => storage.saved()?.title).toBe("Latest edit");
  // This is also the unmount flush path. It must not resurrect the failed PUT.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  await page.waitForTimeout(500);
  expect(storage.saved().title).toBe("Latest edit");
  expect(storage.writes.every(body => body.title === "Latest edit")).toBe(true);
});
