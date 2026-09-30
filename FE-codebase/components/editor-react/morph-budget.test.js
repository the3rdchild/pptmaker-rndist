import assert from "node:assert/strict";
import test from "node:test";

import { canAddMorphTexture, MAX_MORPH_TOTAL_PIXELS } from "./morph-budget.js";

test("morph allows more than 24 small moving elements within the texture budget", () => {
  let used = 0;
  for (let index = 0; index < 40; index += 1) {
    assert.equal(canAddMorphTexture(used, 200, 200), true);
    used += 200 * 200;
  }
  assert.ok(used < MAX_MORPH_TOTAL_PIXELS);
});

test("morph skips textures that would exceed the total budget", () => {
  assert.equal(canAddMorphTexture(MAX_MORPH_TOTAL_PIXELS - 100, 20, 20), false);
  assert.equal(canAddMorphTexture(MAX_MORPH_TOTAL_PIXELS - 100, 10, 10), true);
});
