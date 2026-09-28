// Run manually with `node e2e/live-generation.mjs`. It uses configured live
// providers and keeps every result in a unique artifacts/live-e2e-* directory.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import JSZip from "jszip";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(here, "../../artifacts");
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const output = join(artifacts, `live-e2e-${runId}`);
mkdirSync(output, { recursive: true });

const topic = [
  "Buat presentasi 5 slide untuk DEMO FIKTIF layanan publik digital Kota Contoh.",
  "Fakta uji yang harus dipakai: 120 permohonan per hari; waktu layanan turun dari 5 hari menjadi 2 hari setelah digitalisasi.",
  "Tiga langkah implementasi: audit alur, otomasi formulir, evaluasi mingguan.",
  "Bandingkan layanan manual dan digital dengan angka yang sama; jangan tambahkan angka lain.",
  "Satu slide perlu visual render 3D berupa model meja layanan publik dan alur formulir digital, tanpa tulisan dalam gambar.",
  "Tutup dengan tindakan berikutnya. Tegaskan ini studi kasus fiktif untuk pengujian produk.",
].join(" ");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem("ppt-maker:onboarding-seen", "1"));
const errors = [];
let deckId = null;

const saveStatus = (status, extra = {}) => {
  writeFileSync(join(output, "status.json"), JSON.stringify({
    status, deckId, output, updatedAt: new Date().toISOString(), ...extra,
  }, null, 2));
};

page.on("pageerror", (error) => errors.push(error.message));
saveStatus("starting");

try {
  console.log(`Artifacts: ${output}`);
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(localStorage.getItem("ppt_session_token")), null, { timeout: 60_000 });
  await page.waitForTimeout(1_000);
  await page.getByPlaceholder("Ceritakan ide presentasimu...").fill(topic);
  assert.equal(await page.getByPlaceholder("Ceritakan ide presentasimu...").inputValue(), topic);
  await page.getByRole("button", { name: "6-10 Pages" }).click();
  await page.getByRole("button", { name: "4-6 Pages" }).click();
  await page.getByRole("button", { name: /Mode HTML/ }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await page.waitForURL(/\/outline\?/, { timeout: 60_000 });
  const outlineUrl = new URL(page.url());
  assert.equal(outlineUrl.searchParams.get("mode"), "html");
  assert.equal(outlineUrl.searchParams.get("transitions"), "on");
  console.log("Homepage -> outline: transitions=on, mode=html");
  saveStatus("outline", { transitionPreference: outlineUrl.searchParams.get("transitions") });

  const generate = page.getByRole("button", { name: "Generate Presentation" });
  await generate.waitFor({ timeout: 240_000 });
  await generate.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Generate Presentation"));
    return button && !button.disabled;
  }, null, { timeout: 240_000 });
  await page.getByRole("button", { name: "Corporate Tech Glass" }).click();
  await page.screenshot({ path: join(output, "outline.png"), fullPage: true });
  await generate.click();
  await page.waitForURL(/\/editor-react\//, { timeout: 60_000 });
  const editorUrl = new URL(page.url());
  deckId = editorUrl.pathname.split("/").at(-1);
  assert.equal(editorUrl.searchParams.get("transitions"), "on");
  assert.equal(editorUrl.searchParams.get("htmlTheme"), "corporate-tech-glass");
  saveStatus("generating", { editorPath: editorUrl.pathname });
  console.log(`Editor deck: ${deckId}`);

  const token = await page.evaluate(() => localStorage.getItem("ppt_session_token"));
  assert.ok(token, "browser session token is present");
  let deck = null;
  const deadline = Date.now() + 18 * 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://localhost:8081/api/v1/decks/${deckId}`, {
      headers: { "x-session-token": token },
    });
    if (response.ok) {
      deck = (await response.json()).data;
      if (deck?.payload?.slides?.length === 5) break;
    }
    const retry = page.getByRole("button", { name: /Try Again|Retry Save/ });
    if (await retry.count() && await retry.first().isVisible()) {
      throw new Error(`Generation failed: ${(await page.locator('[role="alert"]').allTextContents()).join(" | ")}`);
    }
    await page.waitForTimeout(5_000);
  }
  assert.equal(deck?.payload?.slides?.length, 5, "all five slides were saved to the Docker API");
  const slides = deck.payload.slides;
  const summary = {
    deckId,
    title: deck.title,
    slideCount: slides.length,
    transitions: slides.map((slide) => slide.transition ?? "none"),
    elements: slides.map((slide) => slide.ui?.elements?.length ?? 0),
    images: slides.map((slide) => (slide.ui?.elements ?? []).filter((element) => element.type === "image").length),
    pageErrors: errors,
  };
  const traceRoot = resolve(here, "../.generation-traces");
  const trace = readdirSync(traceRoot).map((id) => join(traceRoot, id, "events.ndjson"))
    .find((path) => existsSync(path) && readFileSync(path, "utf8").includes(deckId));
  const events = trace ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [];
  summary.warnings = events.filter((event) => event.type === "warning").map((event) => event.message);
  summary.trace = trace ? trace.split("\\").at(-2) : null;
  assert.ok(summary.transitions.slice(1).some((transition) => transition !== "none"), "generated deck has planned transitions");
  assert.ok(summary.elements.every((count) => count > 0), "every saved slide has editable elements");
  assert.ok(!summary.warnings.some((message) => /AI layout was replaced/i.test(message)), "the model produced real slide layouts");
  assert.ok(summary.images.some((count) => count > 0), "the requested 3D visual produced an image element");
  writeFileSync(join(output, "deck-summary.json"), JSON.stringify(summary, null, 2));
  await page.screenshot({ path: join(output, "editor.png"), fullPage: true });
  console.log(`Saved ${summary.slideCount} slides; transitions: ${summary.transitions.join(", ")}`);

  await page.getByRole("button", { name: "Present", exact: true }).click();
  await page.getByRole("button", { name: "Slide overview" }).click();
  await page.getByRole("button", { name: "Go to slide 1" }).click();
  await page.keyboard.press("ArrowRight");
  await page.getByText("2 / 5", { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(output, "presentation.png"), fullPage: true });
  await page.keyboard.press("Escape");
  console.log("Presentation navigation and overview: passed");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("menuitem", { name: "Export to PPTX" }).click();
  const download = await downloadPromise;
  const pptxPath = join(output, `generated-${deckId}.pptx`);
  await download.saveAs(pptxPath);
  const zip = await JSZip.loadAsync(readFileSync(pptxPath));
  const slideXml = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slideXml.length, 5, "downloaded PPTX has five slide XML parts");
  const xml = await Promise.all(slideXml.map((name) => zip.files[name].async("string")));
  assert.ok(xml.every((content) => content.includes("<p:sp") || content.includes("<p:pic")), "each PPTX slide has actual elements");
  saveStatus("passed", { pptxPath, slideCount: slideXml.length, summary });
  console.log(`PPTX preserved: ${pptxPath}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  saveStatus("failed", { error: error instanceof Error ? error.message : String(error), pageErrors: errors });
  throw error;
} finally {
  await browser.close();
}
