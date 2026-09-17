import assert from "node:assert/strict";
import test from "node:test";

import * as deckPipeline from "./deck-pipeline.js";

const { mapWithConcurrency, resolveAcceptedFragmentPhotos } = deckPipeline;

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
