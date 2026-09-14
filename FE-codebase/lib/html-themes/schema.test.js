import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_HTML_THEMES } from "./seeds.js";
import {
  deleteFromHtmlThemeIndex,
  parseHtmlTheme,
  resolveHtmlThemeId,
  selectRecipe,
} from "./schema.js";

test("maps legacy paper and midnight IDs to persistent starter IDs", () => {
  assert.equal(resolveHtmlThemeId("paper"), "paper-editorial");
  assert.equal(resolveHtmlThemeId("midnight"), "midnight-signal");
  assert.equal(resolveHtmlThemeId("corporate-tech-glass"), "corporate-tech-glass");
});

test("cycles matching role recipes by slide index", () => {
  const theme = parseHtmlTheme(STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass"));
  const matches = theme.recipes.filter((recipe) => recipe.roles.includes("content"));
  assert.ok(matches.length >= 2);
  assert.equal(selectRecipe(theme, "content", 0).id, matches[0].id);
  assert.equal(selectRecipe(theme, "content", 1).id, matches[1].id);
  assert.equal(selectRecipe(theme, "quote", 99).id, "quote-statement");
});

test("rejects unsupported fonts and raw CSS-shaped values", () => {
  const invalid = structuredClone(STARTER_HTML_THEMES[0]);
  invalid.typography.headingFont = "<style>bad</style>";
  assert.throws(() => parseHtmlTheme(invalid), /headingFont/);
});

test("keeps an optional full-bleed background asset as a theme rule", () => {
  const theme = structuredClone(STARTER_HTML_THEMES[0]);
  theme.backgroundImageUrl = "/html-themes/full-image-tech-background.png";

  assert.equal(
    parseHtmlTheme(theme).backgroundImageUrl,
    "/html-themes/full-image-tech-background.png",
  );
});

test("deleting the default chooses a remaining theme and refuses the final record", () => {
  assert.deepEqual(
    deleteFromHtmlThemeIndex(
      { schemaVersion: 1, defaultThemeId: "a", themes: ["a", "b"] },
      "a",
    ),
    { schemaVersion: 1, defaultThemeId: "b", themes: ["b"] },
  );
  assert.throws(
    () =>
      deleteFromHtmlThemeIndex(
        { schemaVersion: 1, defaultThemeId: "a", themes: ["a"] },
        "a",
      ),
    /last remaining/i,
  );
});
