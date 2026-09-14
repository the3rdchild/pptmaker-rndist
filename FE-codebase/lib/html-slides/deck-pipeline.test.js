import assert from "node:assert/strict";
import test from "node:test";

import { mapWithConcurrency } from "./deck-pipeline.js";

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
