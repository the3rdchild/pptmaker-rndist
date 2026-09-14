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
