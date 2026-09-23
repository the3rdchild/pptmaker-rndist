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
  const result = await fillPhotos(
    '<section class="slide"><div class="photo theme-background" data-theme-background="true" data-theme-overlay="0.42" data-brief="forest river"></div></section>',
    { resolvePhoto: async () => "https://example.test/forest.jpg" },
  );
  assert.match(result.html, /<img class="photo theme-background"[^>]*data-theme-background/);
});

test("keeps an unresolved placeholder instead of inserting an unrelated random photo", async () => {
  const original = '<section class="slide"><div class="photo" data-brief="specific mangrove restoration fieldwork"></div></section>';
  const result = await fillPhotos(original, { resolvePhoto: async () => null });

  assert.equal(result.html, original);
  assert.deepEqual(result.unresolved, ["specific mangrove restoration fieldwork"]);
  assert.doesNotMatch(result.html, /picsum\.photos/);
});

test("carries stock attribution into the extracted image markup", async () => {
  const result = await fillPhotos(
    '<section class="slide"><div class="photo" data-brief="coffee farmer"></div></section>',
    {
      resolvePhoto: async () => ({
        url: "https://example.test/coffee.jpg",
        extra: {
          credit: "Ayu Photo",
          credit_url: "https://photos.test/ayu",
          source_url: "https://photos.test/image/1",
        },
      }),
    },
  );

  assert.match(result.html, /data-credit="Ayu Photo"/);
  assert.match(result.html, /data-credit-url="https:\/\/photos\.test\/ayu"/);
  assert.match(result.html, /data-source-url="https:\/\/photos\.test\/image\/1"/);
});

test("passes authoritative slide context to every photo placeholder", async () => {
  const received = [];
  const photoContext = {
    slideNumber: 3,
    heading: "Jenis-Jenis Permainan Biliar",
    subject: "Pool, snooker, dan carom di arena biliar",
  };
  await fillPhotos(
    '<section class="slide"><div class="photo" data-brief="three billiards tables"></div></section>',
    {
      photoContext,
      resolvePhoto: async (brief, context) => {
        received.push({ brief, context });
        return "https://example.test/billiards.jpg";
      },
    },
  );

  assert.deepEqual(received, [{ brief: "three billiards tables", context: photoContext }]);
});

test("a morphed photo reuses the previous slide's picture and keeps its id", async () => {
  const searched = [];
  const { html, morphPhotos } = await fillPhotos(
    '<section class="slide"><div class="photo" data-morph="hero" data-brief="harbour"></div><div class="photo" data-brief="market"></div></section>',
    {
      resolvePhoto: async (brief) => {
        searched.push(brief);
        return `https://img.example/${brief}.jpg`;
      },
      reusePhotos: { hero: "https://img.example/previous-hero.jpg" },
    },
  );

  assert.deepEqual(searched, ["market"], "only the new photo is searched");
  assert.match(html, /<img class="photo" data-brief="harbour" data-morph="hero" src="https:\/\/img\.example\/previous-hero\.jpg"/);
  assert.deepEqual(morphPhotos, { hero: "https://img.example/previous-hero.jpg" });
});
