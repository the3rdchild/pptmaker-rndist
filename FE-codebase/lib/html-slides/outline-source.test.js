import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";

import * as outlineSource from "./outline-source.js";

const { normalizeOutline, outlineFromMarkdown } = outlineSource;

test("retries an empty model outline once with a larger JSON budget", async () => {
  let calls = 0;
  const budgets = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    budgets.push(JSON.parse(body).max_tokens);
    calls += 1;
    const content = calls === 1 ? "" : JSON.stringify({
      title: "Kopi di Rumah",
      slides: [{ role: "cover", heading: "Pilih biji yang kamu suka", brief: "Cek aromanya.", visual: "Biji kopi di meja." }],
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.OPENROUTER_API_KEY, base: process.env.OPENROUTER_BASE_URL };
  process.env.OPENROUTER_API_KEY = "local-outline-test";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await outlineSource.buildOutline({ topic: "Kopi rumahan", slideCount: 1, provider: "openrouter-deepseek-flash" });
    assert.equal(result.outline.slides[0].heading, "Pilih biji yang kamu suka");
    assert.deepEqual(budgets, [3500, 6000]);
  } finally {
    for (const [name, value] of [["OPENROUTER_API_KEY", previous.key], ["OPENROUTER_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("passes the approved page image brief to the HTML slide plan", () => {
  const outline = outlineFromMarkdown(`# Wisata Jepang

## Kyoto di Musim Gugur
Kuil bersejarah dan budaya lokal.
Visual: A quiet stone path at a Kyoto temple covered by vivid red maple leaves.
- Fushimi Inari
- Daun momiji`);

  assert.equal(
    outline.slides[0].visual,
    "A quiet stone path at a Kyoto temple covered by vivid red maple leaves.",
  );
  assert.doesNotMatch(outline.slides[0].brief, /Visual:/);
});

test("normalizes a free-text outline reply that omitted the visual field", () => {
  assert.equal(typeof normalizeOutline, "function");
  const normalized = normalizeOutline({
    title: "Pesisir",
    slides: [{ role: "content", heading: "Mangrove", brief: "Akar menahan abrasi." }],
  });

  assert.equal(normalized.slides[0].visual, "Mangrove — Akar menahan abrasi.");
});

test("derives a useful image brief for an older approved outline", () => {
  const outline = outlineFromMarkdown(`# Wisata Jepang
## Kyoto di Musim Gugur
Kuil bersejarah dan budaya lokal.
- Fushimi Inari`);

  assert.equal(
    outline.slides[0].visual,
    "Kyoto di Musim Gugur — Kuil bersejarah dan budaya lokal.",
  );
});

test("approved pages retain their order while clear evidence chooses story roles", () => {
  const outline = outlineFromMarkdown(`# Pertumbuhan Bisnis
## Pembuka
Peluang pasar.
## Hasil naik 28%
Pendapatan naik 28% dari tahun lalu.
## Sebelum vs sesudah
Bandingkan dua pendekatan yang nyata.
## Tiga langkah implementasi
Urutan dari riset hingga peluncuran.
## Peluang berikutnya
Rencana untuk kuartal depan.
## Penutup
Terima kasih.`);

  assert.deepEqual(outline.slides.map((slide) => slide.role), [
    "cover", "stat", "comparison", "process", "content", "closing",
  ]);
  assert.deepEqual(outline.slides.map((slide) => slide.heading), [
    "Pembuka", "Hasil naik 28%", "Sebelum vs sesudah",
    "Tiga langkah implementasi", "Peluang berikutnya", "Penutup",
  ]);
});

test("an explicitly requested 3D visual gets a visual-led slide role", () => {
  const outline = outlineFromMarkdown(`# Markets
## Opening
Expansion plan.
## Regional footprint
Our presence across Asia.
Visual: 3D render of a globe with Jakarta and Singapore marked.
## Closing
Next markets.`);
  assert.equal(outline.slides[1].role, "visual");
  assert.match(outline.slides[1].visual, /3D render of a globe/);
});

test("a model cannot request a statistic layout without a supplied figure", () => {
  const outline = normalizeOutline({ title: "Plan", slides: [
    { role: "cover", heading: "Plan", brief: "Opening" },
    { role: "stat", heading: "Strong progress", brief: "The team improved its workflow." },
    { role: "closing", heading: "Next", brief: "Closing" },
  ] });
  assert.equal(outline.slides[1].role, "content");
});
