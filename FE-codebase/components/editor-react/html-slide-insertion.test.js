import assert from "node:assert/strict";
import test from "node:test";

import { insertHtmlSlideAt } from "./html-slide-insertion.js";

test("inserts out-of-order HTML slide events into logical outline order", () => {
  let state = { logicalIndices: [], slides: [] };
  state = insertHtmlSlideAt(state, 2, "slide-2");
  state = insertHtmlSlideAt(state, 0, "slide-0");
  state = insertHtmlSlideAt(state, 1, "slide-1");

  assert.deepEqual(state.logicalIndices, [0, 1, 2]);
  assert.deepEqual(state.slides, ["slide-0", "slide-1", "slide-2"]);
});

test("keeps an existing slide when the stream repeats its logical index", () => {
  const state = insertHtmlSlideAt(
    { logicalIndices: [0], slides: ["original"] },
    0,
    "duplicate",
  );

  assert.deepEqual(state.slides, ["original"]);
});
