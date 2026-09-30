import { AsyncLocalStorage } from "node:async_hooks";

const activeCost = new AsyncLocalStorage();

/** Tracks billable provider calls within one server request. Unknown charges
 * make the reported total null instead of silently undercounting a deck. */
export function createGenerationCost() {
  let cents = 0;
  let calls = 0;
  let unknown = false;
  return {
    add(usage) {
      calls += 1;
      const cost = typeof usage === "number" ? usage : usage?.cost;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        unknown = true;
      } else {
        cents += cost;
      }
    },
    totalUsd() {
      return unknown || calls === 0 ? null : Number(cents.toFixed(8));
    },
  };
}

export function withGenerationCost(ledger, operation) {
  return activeCost.run(ledger, operation);
}

export function recordGenerationCost(usage) {
  activeCost.getStore()?.add(usage);
}
