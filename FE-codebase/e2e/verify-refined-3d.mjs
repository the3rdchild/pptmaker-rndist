import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";
import JSZip from "jszip";

const output = resolve(process.argv[2]);
const { refinedDeckId: deckId } = JSON.parse(readFileSync(join(output, "refined-deck.json"), "utf8"));
assert.match(deckId, /^[0-9a-f-]{36}$/i);
const token = execFileSync("docker", [
  "compose", "exec", "-T", "postgres", "psql", "-U", "ppt", "-d", "ppt_db", "-t", "-A", "-c",
  `select s.token from deck d join session s on s.id=d.session_id where d.id='${deckId}'`,
], { cwd: resolve(".."), encoding: "utf8" }).trim();
assert.ok(token);

const pptx = join(output, `generated-${deckId}-refined-3d.pptx`);
const zip = await JSZip.loadAsync(readFileSync(pptx));
const expected = createHash("sha256").update(readFileSync(join(output, "refined-3d.png"))).digest("hex");
let embedded = false;
for (const [name, file] of Object.entries(zip.files)) {
  if (!/^ppt\/media\//.test(name)) continue;
  const hash = createHash("sha256").update(await file.async("nodebuffer")).digest("hex");
  if (hash === expected) embedded = true;
}
assert.ok(embedded, "the refined 3D PNG is embedded in the PPTX");

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(({ sessionToken }) => {
  localStorage.setItem("ppt_session_token", sessionToken);
  localStorage.setItem("ppt-maker:onboarding-seen", "1");
}, { sessionToken: token });
try {
  await page.goto(`http://localhost:3000/editor-react/${deckId}?present=1#4`, { waitUntil: "domcontentloaded" });
  await page.getByText("4 / 5", { exact: true }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4_000);
  await page.screenshot({ path: join(output, "refined-3d-presentation.png"), fullPage: true });
  console.log("Refined 3D media is embedded in PPTX and the presentation screenshot was captured.");
} finally {
  await browser.close();
}
