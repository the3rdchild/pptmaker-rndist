import assert from "node:assert/strict";
import test from "node:test";
import {
  GenerationCostTotal,
  GenerationDurationTotal,
  formatGenerationDuration,
} from "./generation-cost-total.ts";

test("outline, deck, review and images accumulate without rounding away small charges", () => {
  const total = new GenerationCostTotal();
  for (const cost of [0.0003, 0.012, 0.0044, 0.001]) total.add(cost);
  assert.equal(total.usd(), 0.0177);
});

test("missing source charge prevents a misleading partial total", () => {
  const total = new GenerationCostTotal();
  total.add(0.01);
  total.add(null);
  assert.equal(total.usd(), null);
});

test("outline and deck durations add without counting the editing pause", () => {
  const total = new GenerationDurationTotal();
  total.add(48_200); // outline request
  total.add(632_200); // deck build and save, after an arbitrary editing pause
  assert.equal(total.ms(), 680_400);
  assert.equal(formatGenerationDuration(total.ms()), "11m 20s");
});

test("invalid carried duration is ignored and long durations include hours", () => {
  const total = new GenerationDurationTotal(Number.NaN);
  total.add(-1000);
  total.add(3_661_000);
  assert.equal(total.ms(), 3_661_000);
  assert.equal(formatGenerationDuration(total.ms()), "1h 1m 1s");
});
