import assert from "node:assert/strict";
import test from "node:test";

import { STARTER_HTML_THEMES, withStarterStoryRecipes } from "./seeds.js";
import * as schema from "./schema.js";

const { deleteFromHtmlThemeIndex, parseHtmlTheme, resolveHtmlThemeId, selectRecipe } = schema;

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

test("plans a deck without repeating a composition when an alternative exists", () => {
  const theme = STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass");
  const recipes = schema.planRecipes(theme, ["cover", "content", "content", "stat", "closing"]);
  assert.deepEqual(recipes.map((recipe) => recipe.composition), [
    "editorial-right", "metric-rail", "visual-focus", "metric-rail", "two-column",
  ]);
});

test("uses specialty story layouts only when the approved content supports them", () => {
  const theme = STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass");
  const recipes = schema.planRecipes(theme, [
    { role: "cover", heading: "Start" },
    { role: "content", heading: "Three benefits", brief: "- Faster setup\n- Lower cost\n- Clearer reports" },
    { role: "stat", heading: "Growth reached 28%", brief: "Revenue rose 28% year over year." },
    { role: "process", heading: "Three steps", brief: "Research, build, launch." },
    { role: "comparison", heading: "Before vs after", brief: "Compare current and proposed workflows." },
    { role: "closing", heading: "Next move" },
  ]);
  assert.deepEqual(recipes.slice(1, 5).map((recipe) => recipe.composition), [
    "bento-asymmetric", "big-number", "process-steps", "comparison-matrix",
  ]);

  const unsupported = schema.planRecipes(theme, [
    { role: "cover", heading: "Start" },
    { role: "stat", heading: "Progress", brief: "A clear qualitative improvement." },
    { role: "closing", heading: "Next move" },
  ]);
  assert.notEqual(unsupported[1].composition, "big-number");
});

test("upgrades an already saved default starter theme in memory without changing its styling", () => {
  const saved = structuredClone(STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass"));
  saved.recipes = saved.recipes.filter((recipe) => !["story-bento", "proof-number", "process-steps", "comparison-matrix"].includes(recipe.id));
  saved.colors.accent = "#11AABB";
  const upgraded = withStarterStoryRecipes(saved);
  assert.equal(upgraded.colors.accent, "#11AABB");
  assert.deepEqual(upgraded.recipes.slice(-4).map((recipe) => recipe.id), ["story-bento", "proof-number", "process-steps", "comparison-matrix"]);
  assert.equal(saved.recipes.length, 5, "the stored theme object stays untouched");
  assert.equal(withStarterStoryRecipes(upgraded).recipes.length, upgraded.recipes.length);
  const other = structuredClone(STARTER_HTML_THEMES.find((entry) => entry.id === "paper-editorial"));
  assert.equal(withStarterStoryRecipes(other), other);
});

test("treats a sourced audience count as metric evidence for a number slide", () => {
  const theme = STARTER_HTML_THEMES.find((entry) => entry.id === "corporate-tech-glass");
  const recipes = schema.planRecipes(theme, [
    { role: "cover", heading: "Start" },
    { role: "stat", heading: "400 users", brief: "400 users joined in June." },
    { role: "closing", heading: "Next" },
  ]);
  assert.equal(recipes[1].composition, "big-number");
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

test("keeps a generated background mode as a theme rule", () => {
  const theme = structuredClone(STARTER_HTML_THEMES[0]);
  theme.backgroundImageUrl = null;
  theme.backgroundImageMode = "generated";

  assert.equal(parseHtmlTheme(theme).backgroundImageMode, "generated");
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
