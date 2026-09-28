import assert from "node:assert/strict";
import test from "node:test";

import * as outlineSource from "./outline-source.js";

const { normalizeOutline, outlineFromMarkdown } = outlineSource;

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
