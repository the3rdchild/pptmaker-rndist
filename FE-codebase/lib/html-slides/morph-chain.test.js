import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureMorphAnchor,
  groupMorphChains,
  morphAnchorsFrom,
  pairHeadingsIfUnmatched,
  sharedMorphIds,
} from "./morph-chain.js";
import { buildMorphSection } from "./slide-prompt.js";

const text = (content, size, extra = {}) => ({
  type: "text",
  position: { x: 64, y: 64 },
  size: { width: 600, height: size * 1.4 },
  font: { size },
  runs: [{ text: content }],
  ...extra,
});

test("morph slides join the chain of the slide before them", () => {
  const slides = [{ transition: "none" }, { transition: "morph" }, { transition: "morph" }, { transition: "fade-black" }, { transition: "morph" }];
  assert.deepEqual(groupMorphChains(slides), [[0, 1, 2], [3, 4]]);
  assert.deepEqual(groupMorphChains([{ transition: "morph" }]), [[0]], "the first slide never morphs in");
});

test("anchors are the bare ids only, described with text and box", () => {
  const anchors = morphAnchorsFrom({
    elements: [
      text("Kopi Nusantara", 64, { morph_id: "title" }),
      { type: "rectangle", morph_id: "card~1", position: { x: 0, y: 0 }, size: { width: 10, height: 10 } },
      { type: "image", morph_id: "hero", position: { x: 640.4, y: 0 }, size: { width: 640, height: 720 } },
    ],
  });
  assert.deepEqual(anchors.map((anchor) => [anchor.id, anchor.kind]), [["title", "text"], ["hero", "photo"]]);
  assert.equal(anchors[0].text, "Kopi Nusantara");
  assert.deepEqual(anchors[1].box, { x: 640, y: 0, width: 640, height: 720 });
});

test("the heading stands in when the model tagged nothing", () => {
  const ui = { elements: [text("small", 18), text("Judul Besar", 56), text("mid", 30)] };
  const tagged = ensureMorphAnchor(ui);
  assert.equal(tagged.elements[1].morph_id, "title");
  assert.equal(ui.elements[1].morph_id, undefined, "input is not mutated");
  const already = { elements: [text("x", 18, { morph_id: "stat" })] };
  assert.equal(ensureMorphAnchor(already), already);
});

test("unmatched morph-in pairs the headings, keeping the id unique", () => {
  const anchors = [{ id: "title", kind: "text", text: "A", box: {} }, { id: "hero", kind: "photo", text: "", box: {} }];
  const ui = { elements: [text("body", 18, { morph_id: "title" }), text("Heading", 48)] };
  assert.deepEqual(sharedMorphIds(anchors, ui), ["title"], "already shares — left alone");
  const unmatched = { elements: [text("body", 18), text("Heading", 48)] };
  const paired = pairHeadingsIfUnmatched(anchors, unmatched);
  assert.equal(paired.elements[1].morph_id, "title");
  assert.deepEqual(sharedMorphIds(anchors, paired), ["title"]);
});

test("the prompt shows the previous slide's anchors and asks for tags when the next slide morphs", () => {
  const section = buildMorphSection({
    from: { note: "judul mengecil", anchors: [{ id: "title", kind: "text", text: "Kopi", box: { x: 64, y: 200, width: 900, height: 120 } }] },
    toNext: { note: "foto geser ke kanan" },
  });
  assert.match(section, /Rencana: judul mengecil/);
  assert.match(section, /data-morph="title" — teks "Kopi", x=64 y=200 lebar=900 tinggi=120/);
  assert.match(section, /SLIDE BERIKUTNYA AKAN MORPH[\s\S]*foto geser ke kanan/);
  assert.equal(buildMorphSection(undefined), "");
});
