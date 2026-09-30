import assert from "node:assert/strict";
import test from "node:test";
import { GenerationCostTotal } from "./generation-cost-total.ts";

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
