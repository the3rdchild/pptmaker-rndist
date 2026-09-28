// Manual follow-up to live-generation.mjs: duplicate its demo deck, replace
// one requested 3D visual, then keep a separate PPTX beside the original.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import JSZip from "jszip";

const [originalId, outputArg] = process.argv.slice(2);
assert.match(originalId ?? "", /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const output = resolve(outputArg);
const token = execFileSync("docker", [
  "compose", "exec", "-T", "postgres", "psql", "-U", "ppt", "-d", "ppt_db", "-t", "-A", "-c",
  `select s.token from deck d join session s on s.id=d.session_id where d.id='${originalId}'`,
], { cwd: resolve(".."), encoding: "utf8" }).trim();
assert.ok(token, "the original deck owner session was found");

const api = "http://localhost:8081/api/v1";
const current = await fetch(`${api}/decks/${originalId}`, { headers: { "x-session-token": token } });
assert.ok(current.ok, "the original generated deck is readable");
const original = (await current.json()).data;
const payload = original.payload;
assert.equal(payload.slides.length, 5);
const image = payload.slides[3].ui.elements.find((element) => element.type === "image" && /^3D render/i.test(element.prompt ?? ""));
assert.ok(image, "slide four has the requested 3D image slot");
image.data = `data:image/png;base64,${readFileSync(join(output, "refined-3d.png")).toString("base64")}`;
const title = `${original.title} - 3D refined`;
payload.title = title;
const createdResponse = await fetch(`${api}/decks`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-session-token": token },
  body: JSON.stringify({ title, payload }),
});
assert.ok(createdResponse.ok, `refined deck copy was saved (${createdResponse.status})`);
const created = (await createdResponse.json()).data;
assert.ok(created?.id);
writeFileSync(join(output, "refined-deck.json"), JSON.stringify({
  sourceDeckId: originalId, refinedDeckId: created.id, title, slideCount: payload.slides.length,
}, null, 2));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(({ sessionToken }) => {
  localStorage.setItem("ppt_session_token", sessionToken);
  localStorage.setItem("ppt-maker:onboarding-seen", "1");
}, { sessionToken: token });
try {
  await page.goto(`http://localhost:3000/editor-react/${created.id}?present=1#4`, { waitUntil: "domcontentloaded" });
  await page.getByText("4 / 5", { exact: true }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: join(output, "refined-3d-presentation.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("menuitem", { name: "Export to PPTX" }).click();
  const download = await pending;
  const pptxPath = join(output, `generated-${created.id}-refined-3d.pptx`);
  await download.saveAs(pptxPath);
  const zip = await JSZip.loadAsync(readFileSync(pptxPath));
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 5);
  console.log(`Refined 3D PPTX preserved: ${pptxPath}`);
  console.log(`Refined deck id: ${created.id}`);
} finally {
  await browser.close();
}
