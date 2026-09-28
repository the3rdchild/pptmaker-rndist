import assert from "node:assert/strict";
import test from "node:test";

import { loadStoredTransitions, storeTransitions, transitionsFromParams } from "./transition-preference.ts";

test("transitions are on for new decks and an explicit off link stays off", () => {
  assert.equal(transitionsFromParams(new URLSearchParams()), true);
  assert.equal(transitionsFromParams(new URLSearchParams("transitions=on")), true);
  assert.equal(transitionsFromParams(new URLSearchParams("transitions=off")), false);
});

test("an explicit off choice survives the next visit", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    assert.equal(loadStoredTransitions(), true);
    storeTransitions(false);
    assert.equal(loadStoredTransitions(), false);
    storeTransitions(true);
    assert.equal(loadStoredTransitions(), true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
