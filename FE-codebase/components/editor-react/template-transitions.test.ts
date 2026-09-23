import assert from "node:assert/strict";
import { test } from "node:test";

import { walkSlideElements } from "./morph";
import { linkMorphAnchors, plannedTransitions } from "./template-transitions";

const text = (content: string, size: number, extra: Record<string, unknown> = {}) => ({
  type: "text",
  position: { x: 64, y: 64 },
  size: { width: 600, height: size * 1.4 },
  font: { size },
  runs: [{ text: content }],
  ...extra,
});
const image = (width: number, height: number) => ({
  type: "image",
  position: { x: 1280 - width, y: 0 },
  size: { width, height },
  data: "https://img.example/a.jpg",
});
const slide = (elements: unknown[]) => ({
  components: [{ position: { x: 0, y: 0 }, size: { width: 1280, height: 720 }, elements }],
});
const morphIds = (ui: Record<string, unknown>) =>
  walkSlideElements(ui).map((ref) => [ref.element.type, ref.element.morph_id ?? null]);

test("links the headlines and the hero photos of two slides", () => {
  const a = slide([text("Body", 18), text("Cover title", 64), image(640, 720)]);
  const b = slide([text("Header", 40), text("Body", 18), image(500, 500)]);
  const linked = linkMorphAnchors(a, b);
  assert.deepEqual(morphIds(linked.a), [["text", null], ["text", "title"], ["image", "hero"]]);
  assert.deepEqual(morphIds(linked.b), [["text", "title"], ["text", null], ["image", "hero"]]);
  assert.equal(morphIds(a)[1][1], null, "inputs are not mutated");
});

test("an authored headline slot beats the largest type, and small images are not heroes", () => {
  const a = slide([text("Big stat", 96), text("The headline", 40, { slot: { role: "headline" } }), image(120, 120)]);
  const b = slide([text("Next headline", 44), image(640, 720)]);
  const linked = linkMorphAnchors(a, b);
  assert.deepEqual(morphIds(linked.a), [["text", null], ["text", "title"], ["image", null]]);
  assert.deepEqual(morphIds(linked.b), [["text", "title"], ["image", null]]);
});

test("the plan forces slide 1 to none and fills gaps with a fade", () => {
  const pages = [
    { transition: "morph" },
    { transition: "morph" },
    {},
  ] as Parameters<typeof plannedTransitions>[1];
  assert.deepEqual(plannedTransitions(4, pages), ["none", "morph", "fade-black", "fade-black"]);
});
