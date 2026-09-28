import assert from "node:assert/strict";
import { test } from "node:test";

import { matchMorphPairs } from "./morph";

const text = (content: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  id: "headline",
  runs: [{ text: content }],
  ...extra,
});
const image = () => ({ type: "image", id: "photo", morph_id: "hero", data: "photo.png" });
const slide = (...elements: Record<string, unknown>[]) => ({ elements });

test("a linked headline with different words does not morph, while its linked image does", () => {
  const a = slide(text("Studi Kasus Fiktif", { morph_id: "title" }), image());
  const b = slide(text("Perbandingan Layanan", { morph_id: "title" }), image());
  const match = matchMorphPairs(a, b);

  assert.equal(match.pairs.length, 1);
  assert.deepEqual(match.pairs[0].selectionA.elementPath, [1]);
  assert.deepEqual(match.exitingA.length, 1);
  assert.deepEqual(match.enteringB.length, 1);
});

test("the id heuristic also rejects changed text, including a trailing space", () => {
  assert.equal(matchMorphPairs(slide(text("Same")), slide(text("Same "))).pairs.length, 0);
  assert.equal(matchMorphPairs(slide(text("Before")), slide(text("After"))).pairs.length, 0);
});

test("identical visible content morphs even when its styled runs are split differently", () => {
  const a = slide(text("unused", { morph_id: "title", runs: [{ text: "Studi " }, { text: "Kasus" }] }));
  const b = slide(text("unused", { morph_id: "title", runs: [{ text: "Studi Kasus" }] }));
  assert.equal(matchMorphPairs(a, b).pairs.length, 1);
});

test("legacy text fields follow the same exact-content rule", () => {
  const a = slide({ type: "text", id: "headline", text: "Digital" });
  const same = slide({ type: "text", id: "headline", text: "Digital" });
  const changed = slide({ type: "text", id: "headline", text: "Manual" });
  assert.equal(matchMorphPairs(a, same).pairs.length, 1);
  assert.equal(matchMorphPairs(a, changed).pairs.length, 0);
});

test("a linked card backdrop still morphs when other content overlaps it", () => {
  const frame = (x: number, width: number) => ({
    type: "rectangle", morph_id: "hero",
    position: { x, y: 200 }, size: { width, height: 380 },
  });
  const photo = { type: "image", position: { x: 65, y: 220 }, size: { width: 560, height: 240 } };
  const badge = (x: number) => ({
    type: "rectangle", morph_id: "badge",
    position: { x, y: 90 }, size: { width: 50, height: 40 },
  });
  const a = slide(frame(64, 340), badge(900));
  const b = slide(frame(64, 564), photo, badge(1000));
  const pairs = matchMorphPairs(a, b).pairs;
  assert.deepEqual(
    pairs.map((pair) => pair.selectionB.elementPath),
    [[0], [2]],
    "both author links remain recognized, including the covered card",
  );
});
