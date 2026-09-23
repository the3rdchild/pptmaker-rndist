import assert from "node:assert/strict";
import test from "node:test";

import { contrastRatio, themeContrastProblems } from "./contrast.js";
import { STARTER_HTML_THEMES } from "./seeds.js";

test("black on white is the full 21:1 range", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
});

test("the curated starter themes all meet the bar freestyle themes are held to", () => {
  for (const theme of STARTER_HTML_THEMES) {
    assert.deepEqual(themeContrastProblems(theme.colors), [], theme.id);
  }
});

test("names the failing pair and the ratio it needs", () => {
  const [problem] = themeContrastProblems({
    background: "#FFFFFF", surface: "#FFFFFF", text: "#DDDDDD", muted: "#000000",
  });
  assert.match(problem, /colors\.text #DDDDDD on colors\.background #FFFFFF/);
  assert.match(problem, /4\.5:1/);
});
