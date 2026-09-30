import assert from "node:assert/strict";
import { test } from "node:test";

import { fontFromRecord, fontToSource } from "./template-v2-text";
import { DEFAULT_FONT } from "./text-layout-measurement";

test("Public Sans always renders and serializes with zero letter spacing", () => {
  for (const spacing of [-2, 0, 1.5]) {
    const font = fontFromRecord({ family: "Public Sans", letter_spacing: spacing }, DEFAULT_FONT);
    assert.equal(font.letterSpacing, 0);
    assert.equal(fontToSource(font).letter_spacing, 0);
  }
  assert.equal(fontFromRecord({ family: "Fraunces", letter_spacing: 1.5 }, DEFAULT_FONT).letterSpacing, 1.5);
});
