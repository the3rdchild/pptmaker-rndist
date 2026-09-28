import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { STARTER_HTML_THEMES } from "../html-themes/seeds.js";
import * as pipeline from "./deck-pipeline.js";
const { generateDeck } = pipeline;
import { createGenerationTrace } from "./generation-trace.js";
import { ChromeSession } from "./chrome-session.js";

test("visual repair feedback keeps CSS and photo intent without embedding image bytes", () => {
  const feedback = pipeline.buildVisualRepairFeedback?.({
    styleBlock: "<style>.photo{width:600px;height:300px}</style>",
    sectionHtml: `<section class="slide"><img class="photo" data-morph="hero" data-brief="hand bridge on a pool table" src="data:image/png;base64,${"A".repeat(200000)}"><h1>Technique</h1></section>`,
  }, [{ slot: "photo-1", kind: "image", problem: "Wrong image" }], [{ type: "image", prompt: "hand bridge on a pool table" }]);
  assert.equal(typeof feedback, "string", "HTML repairs need a bounded feedback builder");
  assert.ok(feedback.length < 2000);
  assert.match(feedback, /Current CSS: <style>\.photo/);
  assert.match(feedback, /<div class="photo" data-morph="hero" data-brief="hand bridge on a pool table"><\/div>/);
  assert.doesNotMatch(feedback, /data:image|<img|AAAA/);
});

for (const outcome of ["repaired", "still failing", "provider failure", "cancelled"]) {
  test(`visual review ${outcome}: bounds repair and preserves valid slides or cancellation`, async () => {
    const requested = [];
    const reviewed = [];
    const events = [];
    const abort = new AbortController();
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const prompt = JSON.parse(body).messages[0].content;
      const index = Number(prompt.match(/SLIDE (\d+) dari/)[1]);
      const isRepair = prompt.includes("VISUAL REVIEW");
      requested.push({ index, isRepair, prompt });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: `<style>h1 {position:absolute;left:${isRepair ? 180 : 100}px;top:80px;font:48px Arial}</style><section class="slide"><h1 data-morph="title">Slide ${index}</h1></section>` }, finish_reason: "stop" }] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const previous = { key: process.env.DEEPINFRA_API_KEY, base: process.env.DEEPINFRA_BASE_URL };
    process.env.DEEPINFRA_API_KEY = "local-regression-test";
    process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const trace = createGenerationTrace({ generationId: `test-visual-${randomUUID()}`, signal: abort.signal });
    try {
      const result = trace.run(() => generateDeck({
        topic: '# Retained visual review test\n## Slide 1\nFirst.\nTransisi: none\n## Slide 2\nSecond.\nTransisi: morph\n## Slide 3\nThird.\nTransisi: morph',
        provider: "deepinfra",
        theme: STARTER_HTML_THEMES.find((theme) => theme.id === "corporate-tech-glass"),
        transitions: true,
        signal: abort.signal,
        outDir: trace.directory,
        onEvent: (event) => events.push(event),
        reviewSlide: async (input) => {
          assert.match(input.image, /^data:image\/png;base64,iVBOR/);
          assert.equal(input.signal, abort.signal);
          const heading = input.fills.find((fill) => fill.text === "Slide 2");
          if (!heading) return [];
          reviewed.push(input);
          if (outcome === "cancelled") { abort.abort(); abort.signal.throwIfAborted(); }
          if (outcome === "provider failure") throw new Error("Vision provider unavailable");
          if (reviewed.length === 1 || outcome === "still failing") return [{ slot: heading.name, problem: "Heading is visibly crowded", kind: "text" }];
          return [];
        },
      }));
      if (outcome === "cancelled") {
        await assert.rejects(result, { name: "AbortError" });
        assert.deepEqual(events.filter((event) => event.type === "slide").map((event) => event.index), [0]);
        assert.deepEqual(requested.map((call) => call.index), [1, 2]);
        return;
      }
      const deck = await result;
      assert.equal(deck.slides.length, 3);
      assert.equal(reviewed.length, outcome === "provider failure" ? 1 : 2, "review the accepted image and at most one repaired image");
      assert.equal(requested.filter((call) => call.isRepair).length, outcome === "provider failure" ? 0 : 1);
      for (const call of requested.filter((call) => call.isRepair)) assert.match(call.prompt, /Current CSS: <style>h1 \{position:absolute;left:100px/, "the repair must receive the accepted design's actual CSS");
      const heading = deck.slides[1].ui.elements.find((element) => element.runs?.some((run) => run.text === "Slide 2"));
      assert.equal(heading.position.x, outcome === "repaired" ? 180 : 100, "keep the pre-repair layout if the repair/review does not pass");
      if (outcome !== "repaired") assert.ok(events.some((event) => event.type === "warning" && event.slide === 2 && /visual/i.test(event.message)));
    } finally {
      for (const [name, value] of [["DEEPINFRA_API_KEY", previous.key], ["DEEPINFRA_BASE_URL", previous.base]]) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

test("keeps the already accepted slide if Chrome becomes unavailable after visual review fails", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: '<style>h1{position:absolute;left:100px;top:80px;font:48px Arial}</style><section class="slide"><h1>Accepted slide</h1></section>' }, finish_reason: "stop" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.DEEPINFRA_API_KEY, base: process.env.DEEPINFRA_BASE_URL, launch: ChromeSession.launch };
  process.env.DEEPINFRA_API_KEY = "local-regression-test";
  process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const events = [];
  const trace = createGenerationTrace({ generationId: `test-visual-restore-${randomUUID()}` });
  try {
    const deck = await trace.run(() => generateDeck({
      topic: '# Retained restore test\n## Accepted slide\nKeep this valid slide.',
      provider: "deepinfra", theme: STARTER_HTML_THEMES[0], outDir: trace.directory,
      onEvent: (event) => events.push(event),
      reviewSlide: async () => {
        ChromeSession.launch = async () => { throw new Error("Chrome unavailable after review"); };
        throw new Error("Visual provider unavailable");
      },
    }));
    assert.equal(deck.slides.length, 1);
    assert.ok(deck.slides[0].ui.elements.some((element) => element.runs?.some((run) => run.text === "Accepted slide")));
    assert.ok(events.some((event) => event.type === "warning" && /Visual provider unavailable/.test(event.message)));
  } finally {
    ChromeSession.launch = previous.launch;
    for (const [name, value] of [["DEEPINFRA_API_KEY", previous.key], ["DEEPINFRA_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a photo mismatch repair replaces the flagged morph photo instead of reusing it", async () => {
  const resolved = [];
  const photo = (color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="240"><rect width="500" height="240" fill="${color}"/></svg>`);
  const oldPhoto = photo("red");
  const repairedPhoto = photo("green");
  let secondSlideReviews = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).messages[0].content;
    const index = Number(prompt.match(/SLIDE (\d+) dari/)[1]);
    const brief = prompt.includes("VISUAL REVIEW") ? "hand bridge" : "wide pool table";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: `<style>h1{position:absolute;left:64px;top:60px;font:48px Arial}.photo{position:absolute;left:64px;top:200px;width:500px;height:240px}</style><section class="slide"><h1 data-morph="title">Slide ${index}</h1><div class="photo" data-morph="hero" data-brief="${brief}"></div></section>` }, finish_reason: "stop" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.DEEPINFRA_API_KEY, base: process.env.DEEPINFRA_BASE_URL };
  process.env.DEEPINFRA_API_KEY = "local-regression-test";
  process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const trace = createGenerationTrace({ generationId: `test-visual-photo-${randomUUID()}` });
  try {
    const deck = await trace.run(() => generateDeck({
      topic: '# Retained photo repair\n## Slide 1\nPool table.\nTransisi: none\n## Slide 2\nHand bridge.\nTransisi: morph',
      provider: "deepinfra", theme: STARTER_HTML_THEMES[0], outDir: trace.directory, transitions: true,
      resolvePhoto: async (brief) => { resolved.push(brief); return brief === "hand bridge" ? repairedPhoto : oldPhoto; },
      reviewSlide: async (input) => {
        if (!input.fills.some((fill) => fill.text === "Slide 2")) return [];
        secondSlideReviews += 1;
        return secondSlideReviews === 1 ? [{ slot: input.photos[0].name, kind: "image", problem: "The photo needs a hand bridge, not a generic pool table", suggestedPhotoPrompt: "hand bridge" }] : [];
      },
    }));
    assert.equal(secondSlideReviews, 2);
    assert.deepEqual(resolved, ["wide pool table", "hand bridge"], "the rejected image must not be reused by its morph id");
    assert.equal(deck.slides[1].ui.elements.find((element) => element.type === "image").data, repairedPhoto);
  } finally {
    for (const [name, value] of [["DEEPINFRA_API_KEY", previous.key], ["DEEPINFRA_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
