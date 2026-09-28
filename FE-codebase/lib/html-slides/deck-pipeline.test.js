import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { STARTER_HTML_THEMES } from "../html-themes/seeds.js";

import * as deckPipeline from "./deck-pipeline.js";
import { createGenerationTrace } from "./generation-trace.js";

const { mapWithConcurrency, resolveAcceptedFragmentPhotos } = deckPipeline;

test("switches a reasoning-only Hy3 layout to Sol with enough budget for visible HTML", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { model, max_tokens: maxTokens } = JSON.parse(body);
    requests.push({ model, maxTokens });
    const emptyReasoning = model === "hy3";
    const content = '<style>h1 { position:absolute; left:80px; top:80px; font:48px Arial }</style><section class="slide"><h1>Biliar 1</h1></section>';
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: emptyReasoning ? "" : content }, finish_reason: emptyReasoning ? "length" : "stop" }] })}\n\n`);
    response.end(`data: ${JSON.stringify({ usage: { completion_tokens: emptyReasoning ? maxTokens : 200, completion_tokens_details: { reasoning_tokens: emptyReasoning ? maxTokens : 50 } }, choices: [] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.CODEBUDDY_API_KEY, base: process.env.CODEBUDDY_BASE_URL };
  process.env.CODEBUDDY_API_KEY = "local-regression-test";
  process.env.CODEBUDDY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const trace = createGenerationTrace({ generationId: `test-reasoning-fallback-${randomUUID()}` });
    const deck = await trace.run(() => deckPipeline.generateDeck({
      topic: "# Biliar\n## Biliar 1\nTeknik dan presisi.",
      slideCount: 1,
      theme: STARTER_HTML_THEMES.find((theme) => theme.id === "corporate-tech-glass"),
      provider: "codebuddy",
      outDir: trace.directory,
    }));
    assert.deepEqual(requests, [{ model: "hy3", maxTokens: 4000 }, { model: "gpt-5.6-sol", maxTokens: 8000 }]);
    assert.equal(deck.slides.length, 1);
    assert.equal(deck.warnings.length, 0, "successful Sol output must avoid the bounded fallback");
    assert.ok(deck.slides[0].ui.elements.some((element) => element.runs?.some((run) => run.text === "Biliar 1")));
  } finally {
    for (const [name, value] of [["CODEBUDDY_API_KEY", previous.key], ["CODEBUDDY_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// Keep Chrome, layout assessment, extraction and morph chaining real. Only
// the external model is replaced, so malformed output cannot disappear in a mock.
for (const failure of ["model HTML", "resolved photo layout", "optional morph repair", "cancellation", "token limit", "token limit exhausted"]) {
test(failure === "cancellation" ? "aborts a morph chain without recovering cancellation as a fallback slide" : `finishes all five slides when ${failure} breaks partway through a morph chain`, async () => {
  const events = [];
  const requested = [];
  const budgets = [];
  const abort = new AbortController();
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { messages, max_tokens: maxTokens } = JSON.parse(body);
    const prompt = messages[0].content;
    const index = Number(prompt.match(/SLIDE (\d+) dari/)[1]);
    requested.push(index);
    if (index === 2) budgets.push(maxTokens);
    if (failure === "cancellation" && index === 2) abort.abort();
    let content = `<style>h1 { position:absolute; left:${60 + index * 20}px; top:80px; font:48px Arial }</style><section class="slide" data-debug="local-regression-test"><h1 data-morph="title">Biliar ${index}</h1></section>`;
    let finishReason = "stop";
    if (index === 2 && failure.startsWith("token limit")) {
      if (maxTokens < 8000 || failure === "token limit exhausted") {
        finishReason = "length";
        content = '<style>.slide { color: white }</style><section class="slide"><h1>Truncated';
      }
    } else if (index === 2) {
      if (failure === "model HTML" || (failure === "optional morph repair" && requested.filter((value) => value === 2).length > 1)) {
        content = '<style>.slide { color: white }</style><section class="slide"><h1>Truncated';
      } else if (failure === "resolved photo layout") {
        content = '<style>.photo {width:1000px;height:180px} img.photo {height:700px} h1 {width:500px;font:48px Arial}</style><section class="slide"><div class="photo" data-brief="billiards"></div><h1 data-morph="title">Biliar 2</h1></section>';
      } else {
        content = content.replace(' data-morph="title"', '');
      }
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }], usage: { completion_tokens: finishReason === "length" ? maxTokens : 150 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { key: process.env.DEEPINFRA_API_KEY, base: process.env.DEEPINFRA_BASE_URL };
  process.env.DEEPINFRA_API_KEY = "local-regression-test";
  process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const trace = createGenerationTrace({ generationId: `test-${failure.replaceAll(" ", "-")}-${randomUUID()}`, deckId: "pipeline-regression", signal: abort.signal });
  const outDir = trace.directory;
  try {
    const generated = trace.run(() => deckPipeline.generateDeck({
      topic: '# Biliar\n' + [1, 2, 3, 4, 5].map((index) =>
        `## Biliar ${index}\nTeknik dan presisi.\nTransisi: ${index === 1 ? "none" : "morph"}`,
      ).join("\n"),
      theme: STARTER_HTML_THEMES.find((theme) => theme.id === "corporate-tech-glass"),
      provider: "deepinfra",
      outDir,
      transitions: true,
      signal: abort.signal,
      resolvePhoto: async () => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="1000" height="700" fill="green"/></svg>'),
      onEvent: (event) => events.push(event),
    }));
    if (failure === "cancellation") {
      await assert.rejects(generated, (error) => error.name === "AbortError");
      assert.deepEqual(events.filter((event) => event.type === "slide").map((slide) => slide.index), [0]);
      assert.deepEqual(requested, [1, 2], "do not schedule retries or later slides after cancellation");
      const diagnostics = readFileSync(join(outDir, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(diagnostics.at(-1).phase, "cancelled");
      return;
    }
    const deck = await generated;
    assert.equal(deck.slides.length, 5);
    const slides = events.filter((event) => event.type === "slide");
    assert.deepEqual(slides.map((slide) => slide.index), [0, 1, 2, 3, 4]);
    assert.deepEqual(slides.map((slide) => slide.transition), ["none", "morph", "morph", "morph", "morph"]);
    if (failure === "token limit") {
      assert.deepEqual(budgets, [4000, 8000]);
      assert.ok(slides[1].ui.elements.some((element) => element.position.x === 100 && element.runs?.some((run) => run.text === "Biliar 2")), "the larger reply must supply slide 2 instead of the fallback");
      assert.ok(!events.some((event) => event.type === "warning" && /safe bounded/.test(event.message)));
    } else {
      assert.ok(events.some((event) => event.type === "warning" && event.slide === 2));
    }
    if (failure === "token limit exhausted") assert.deepEqual(budgets, [4000, 8000, 12000]);
    assert.ok(requested.includes(5), "generation must continue after the broken reply");
    const diagnostics = readFileSync(join(outDir, "events.ndjson"), "utf8").trim().split("\n").map(JSON.parse);
    assert.doesNotMatch(readFileSync(join(outDir, "slide-1.html"), "utf8"), /local-regression-test/, "retained HTML must apply the same credential redaction as raw replies");
    const layoutChecks = diagnostics.filter((event) => event.type === "layout");
    assert.ok(layoutChecks.some((event) => event.slide === 1 && event.stage === "before-photos" && event.ok), "persist accepted geometry before photo replacement");
    assert.ok(layoutChecks.some((event) => event.slide === 1 && event.stage === "after-photos" && event.ok), "persist layout review after photo replacement");
    assert.ok(layoutChecks.every((event) => event.checks.visionReview === false), "do not imply a visual model review ran");
    const secondHeading = slides[1].ui.elements.find((element) => element.type === "text" && element.runs?.some((run) => run.text === "Biliar 2"));
    assert.ok(secondHeading, "the failed slide retains its approved heading");
    if (failure === "resolved photo layout") {
      assert.ok(events.some((event) => event.type === "warning" && /Photo fill was skipped/.test(event.message)));
      assert.equal(secondHeading.position.y, 180, "restore the layout reviewed before photo replacement");
      assert.equal(slides[1].ui.elements.filter((element) => element.type === "image").length, 0);
    }
    if (failure === "optional morph repair") {
      assert.equal(secondHeading.position.x, 100, "keep the accepted design when the optional retry fails");
    }
    for (let index = 1; index < slides.length; index += 1) {
      const previousIds = new Set(slides[index - 1].ui.elements.map((element) => element.morph_id).filter(Boolean));
      assert.ok(slides[index].ui.elements.some((element) => previousIds.has(element.morph_id)), "every planned morph pairs a real element");
    }
  } finally {
    for (const [name, value] of [["DEEPINFRA_API_KEY", previous.key], ["DEEPINFRA_BASE_URL", previous.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
}

test("keeps shared render resources alive until other workers finish after a failure", async () => {
  let release;
  let settled = false;
  const result = mapWithConcurrency([0, 1], 2, async (index) => {
    if (index === 0) throw new Error("render failed");
    await new Promise((resolve) => { release = resolve; });
  });
  const checked = assert.rejects(result, /render failed/).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeRelease = settled;
  release();
  await checked;
  assert.equal(settledBeforeRelease, false, "cleanup must wait for the in-flight sibling render");
});

test("runs at most two jobs and returns results in source order", async () => {
  const starts = [];
  const releases = new Map();
  let active = 0;
  let maxActive = 0;
  let firstCompletedBeforeAllReleased = false;

  const jobs = [0, 1, 2].map((index) => ({ index }));
  const resultPromise = mapWithConcurrency(jobs, 2, async (job) => {
    starts.push(job.index);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => releases.set(job.index, resolve));
    active -= 1;
    if (job.index === 0) firstCompletedBeforeAllReleased = releases.size < jobs.length;
    return `slide-${job.index}`;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, [0, 1]);
  assert.equal(maxActive, 2);

  releases.get(0)?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, [0, 1, 2]);
  assert.equal(firstCompletedBeforeAllReleased, true);

  releases.get(1)?.();
  releases.get(2)?.();
  assert.deepEqual(await resultPromise, ["slide-0", "slide-1", "slide-2"]);
});

test("resolves photos once for the accepted fragment", async () => {
  assert.equal(typeof resolveAcceptedFragmentPhotos, "function");
  let calls = 0;
  const receivedContexts = [];
  const photoContext = {
    slideNumber: 1,
    heading: "Apa Itu Biliar?",
    subject: "Pemain membidik bola di meja biliar",
  };
  const fragment = {
    sectionHtml: '<section class="slide"><div class="photo" data-brief="one"></div><div class="photo" data-brief="two"></div></section>',
  };

  const resolved = await resolveAcceptedFragmentPhotos(fragment, async (brief, context) => {
    calls += 1;
    receivedContexts.push(context);
    return { url: `https://example.test/${brief}.jpg` };
  }, photoContext);

  assert.equal(calls, 2);
  assert.deepEqual(receivedContexts, [photoContext, photoContext]);
  assert.match(resolved.sectionHtml, /one\.jpg/);
  assert.match(resolved.sectionHtml, /two\.jpg/);
});
