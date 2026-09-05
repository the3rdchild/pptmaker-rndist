// Pushes out/deck.json into the running API as a real deck, so the extraction
// can be opened in the editor and dragged around.
//
//   node html-slides/import-deck.js [--api http://localhost:8081] [--fe http://localhost:3000]
//
// `--fe` only shapes the URL printed at the end; pass it when the dev server
// landed on a port other than 3000 (autoPort moves it when 3000 is taken).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const api = arg("api", "http://localhost:8081");
const fe = arg("fe", "http://localhost:3000");
const token = arg("token", "html-slides-spike");

const deck = JSON.parse(readFileSync(join(HERE, "out", "deck.json"), "utf8"));

const response = await fetch(`${api}/api/v1/decks`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-session-token": token },
  body: JSON.stringify({ title: deck.title, payload: deck }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`POST /api/v1/decks -> ${response.status}\n${body.slice(0, 600)}`);
  process.exit(1);
}

const id = JSON.parse(body)?.data?.id;
console.log(`deck  : ${deck.title}`);
console.log(`id    : ${id}`);
console.log(`token : ${token}`);
console.log(`open  : ${fe}/editor-react/${id}`);
console.log(`\nThe deck belongs to session token "${token}", so the browser must`);
console.log(`carry it too. Once per browser, in the devtools console on ${fe}:`);
console.log(`  localStorage.setItem('ppt_session_token', '${token}')`);
