import assert from "node:assert/strict";
import test from "node:test";

import { ensureThemeBackgroundPlaceholder, fillPhotos } from "./photo-fill.js";

test("adds one generated theme background as the first slide child", () => {
  const html = ensureThemeBackgroundPlaceholder(
    '<section class="slide"><h1>Ketapang</h1></section>',
    "cinematic ketapang leaves beside a river",
  );

  assert.match(html, /^<section class="slide"><div class="photo theme-background"/);
  assert.match(html, /data-theme-background/);
  assert.match(html, /data-theme-overlay="0.42"/);
});

test("does not duplicate a model-provided theme background", () => {
  const original = '<section class="slide"><div class="photo theme-background" data-theme-background data-brief="forest"></div></section>';
  assert.equal(ensureThemeBackgroundPlaceholder(original, "river"), original);
});

test("adds a generated background when the model uses single quotes", () => {
  const html = ensureThemeBackgroundPlaceholder(
    "<section class='slide'><h1>Ketapang</h1></section>",
    "cinematic ketapang leaves beside a river",
  );

  assert.match(html, /^<section class='slide'><div class="photo theme-background"/);
});

test("preserves the theme-background marker while filling its photo", async () => {
  const previousKey = process.env.UNSPLASH_ACCESS_KEY;
  const previousFetch = global.fetch;
  process.env.UNSPLASH_ACCESS_KEY = "test-key";
  global.fetch = async () => ({ ok: true, json: async () => ({ results: [{ urls: { regular: "https://example.test/forest.jpg" } }] }) });
  try {
    const result = await fillPhotos('<section class="slide"><div class="photo theme-background" data-theme-background="true" data-theme-overlay="0.42" data-brief="forest river"></div></section>');
    assert.match(result.html, /<img class="photo theme-background"[^>]*data-theme-background/);
  } finally {
    process.env.UNSPLASH_ACCESS_KEY = previousKey;
    global.fetch = previousFetch;
  }
});
