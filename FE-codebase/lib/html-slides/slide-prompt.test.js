import assert from "node:assert/strict";
import test from "node:test";

import { buildOutlinePrompt } from "./slide-prompt.js";

test("outline brief gives the model story roles with evidence gates", () => {
  const prompt = buildOutlinePrompt("Pertumbuhan bisnis", 6);
  assert.match(prompt, /process/);
  assert.match(prompt, /stat.*angka nyata/is);
  assert.match(prompt, /satu gagasan utama per slide/i);
});
