// Copy a generated demo into an existing anonymous browser session so it appears on that dashboard.
// Usage: node e2e/copy-demo-to-session.mjs <source-deck-id> <target-session-id> <artifact-dir>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const [sourceId, targetSessionId, outputArg] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
assert.match(sourceId ?? "", uuid);
assert.match(targetSessionId ?? "", uuid);
assert.ok(outputArg, "artifact directory is required");
const output = resolve(outputArg);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sessionToken(where) {
  const token = execFileSync("docker", [
    "compose", "exec", "-T", "postgres", "psql", "-U", "ppt", "-d", "ppt_db", "-t", "-A", "-c",
    `select token from session where ${where}`,
  ], { cwd: repo, encoding: "utf8" }).trim();
  assert.ok(token, `session found for ${where}`);
  return token;
}

const sourceSessionId = execFileSync("docker", [
  "compose", "exec", "-T", "postgres", "psql", "-U", "ppt", "-d", "ppt_db", "-t", "-A", "-c",
  `select session_id from deck where id='${sourceId}'`,
], { cwd: repo, encoding: "utf8" }).trim();
assert.match(sourceSessionId, uuid);
const sourceToken = sessionToken(`id='${sourceSessionId}'`);
const targetToken = sessionToken(`id='${targetSessionId}'`);
const api = "http://localhost:8081/api/v1";
const headers = (token) => ({ "x-session-token": token });

const sourceResponse = await fetch(`${api}/decks/${sourceId}`, { headers: headers(sourceToken) });
assert.ok(sourceResponse.ok, `source deck is readable (${sourceResponse.status})`);
const source = (await sourceResponse.json()).data;
assert.equal(source.payload.slides.length, 5);
const title = "DEMO FIKTIF Layanan Publik Digital Kota Contoh — 3D";

const listResponse = await fetch(`${api}/decks`, { headers: headers(targetToken) });
assert.ok(listResponse.ok, `target deck list is readable (${listResponse.status})`);
const existing = (await listResponse.json()).data.find((deck) => deck.title === title);
let deckId = existing?.id;
if (!deckId) {
  const payload = structuredClone(source.payload);
  payload.title = title;
  const response = await fetch(`${api}/decks`, {
    method: "POST",
    headers: { ...headers(targetToken), "content-type": "application/json" },
    body: JSON.stringify({ title, payload }),
  });
  assert.ok(response.ok, `demo copy was saved (${response.status})`);
  deckId = (await response.json()).data.id;
}
assert.match(deckId, uuid);

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(({ token }) => {
    localStorage.setItem("ppt_session_token", token);
    localStorage.setItem("ppt-maker:onboarding-seen", "1");
  }, { token: targetToken });
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(output, "visible-dashboard.png"), fullPage: true });
  await page.goto(`http://localhost:3000/editor-react/${deckId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Present", exact: true }).waitFor({ timeout: 30_000 });
} finally {
  await browser.close();
}

writeFileSync(join(output, "visible-deck.json"), JSON.stringify({ sourceId, deckId, title, targetSessionId }, null, 2));
console.log(`Dashboard deck: ${deckId}`);
console.log(`Title: ${title}`);
console.log(`Screenshot: ${join(output, "visible-dashboard.png")}`);
