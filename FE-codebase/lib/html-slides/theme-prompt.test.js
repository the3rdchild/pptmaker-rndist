import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_HTML_THEMES } from "../html-themes/seeds.js";
import { parseHtmlTheme } from "../html-themes/schema.js";
import { compileThemePrompt } from "./theme-prompt.js";

test("Corporate Tech Glass compiles its KPI recipe into explicit AI rules", () => {
  const theme = parseHtmlTheme(STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass"));
  const recipe = theme.recipes.find((entry) => entry.id === "content-kpi-rail");
  const prompt = compileThemePrompt(theme, recipe);
  assert.match(prompt, /#031024/i);
  assert.match(prompt, /Content \+ KPI/i);
  assert.match(prompt, /metric/i);
  assert.doesNotMatch(prompt, /backdrop-filter|mask-image|::before/i);
});

test("Image Tech requires a generated photo placeholder as the locked background", () => {
  const theme = parseHtmlTheme({
    ...STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass"),
    id: "image-tech-test",
    backgroundImageMode: "generated",
  });
  const prompt = compileThemePrompt(theme, theme.recipes[0]);

  assert.match(prompt, /photo theme-background/i);
  assert.match(prompt, /data-theme-background/i);
});

test("story layouts send composition and fact constraints to the slide model", () => {
  const theme = parseHtmlTheme(STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass"));
  const bento = compileThemePrompt(theme, theme.recipes.find((entry) => entry.id === "story-bento"));
  const number = compileThemePrompt(theme, theme.recipes.find((entry) => entry.id === "proof-number"));
  assert.match(bento, /one dominant tile.*two smaller supporting tiles/i);
  assert.match(number, /real number from the outline/i);
  assert.match(number, /never invent a metric/i);
  assert.match(number, /center the headline and number as one composition/i);
});
