import assert from "node:assert/strict";
import test from "node:test";

import { assessSlideLayout } from "./layout-quality.js";

const text = (x, y, width, height) => ({
  type: "text",
  position: { x, y },
  size: { width, height },
  font: { size: 24 },
  runs: [{ text: "Sample text" }],
});

test("rejects an extracted slide when text leaves the fixed canvas", () => {
  const result = assessSlideLayout({
    elements: [text(80, 640, 560, 120)],
    warnings: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.feedback, /outside the 1280x720 canvas/i);
});

test("rejects an extracted slide when the DOM reports clipped text", () => {
  const result = assessSlideLayout({
    elements: [text(80, 80, 560, 80)],
    warnings: ['text "Long heading" is clipped by 20px'],
  });

  assert.equal(result.ok, false);
  assert.match(result.feedback, /clipped/i);
});

test("accepts a bounded slide without extraction warnings", () => {
  const result = assessSlideLayout({
    elements: [text(80, 80, 560, 80)],
    warnings: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.feedback, "");
});
