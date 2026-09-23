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
