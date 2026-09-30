import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationCost, recordGenerationCost, withGenerationCost } from "./generation-cost.js";

test("sums provider and image charges once and preserves sub-cent precision", async () => {
  const ledger = createGenerationCost();
  await withGenerationCost(ledger, async () => {
    recordGenerationCost({ cost: 0.00032 });
    recordGenerationCost({ cost: 0.018 });
  });
  assert.equal(ledger.totalUsd(), 0.01832);
});

test("an unreported paid call makes the total unavailable", async () => {
  const ledger = createGenerationCost();
  await withGenerationCost(ledger, async () => {
    recordGenerationCost({ cost: 0.01 });
    recordGenerationCost(null);
  });
  assert.equal(ledger.totalUsd(), null);
});

test("parallel generations keep their charges isolated", async () => {
  const first = createGenerationCost();
  const second = createGenerationCost();
  await Promise.all([
    withGenerationCost(first, async () => { await Promise.resolve(); recordGenerationCost({ cost: 0.02 }); }),
    withGenerationCost(second, async () => { await Promise.resolve(); recordGenerationCost({ cost: 0.03 }); }),
  ]);
  assert.equal(first.totalUsd(), 0.02);
  assert.equal(second.totalUsd(), 0.03);
});
