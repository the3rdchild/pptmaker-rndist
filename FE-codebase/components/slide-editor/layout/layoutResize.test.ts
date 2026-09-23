import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deleteLayoutChildFromArray } from "./layoutResize";

const text = (id: string) => ({ type: "text", id, text: id });

describe("deleteLayoutChildFromArray", () => {
  test("removes a leaf at the top level instead of leaving the array unchanged", () => {
    const elements = [text("a"), text("b"), text("c")];
    const next = deleteLayoutChildFromArray(elements, [1]);
    assert.deepEqual(next, [text("a"), text("c")]);
    assert.equal(elements.length, 3, "input is not mutated");
  });

  test("removes a nested leaf inside a non-flow group", () => {
    const group = { type: "group", children: [text("x"), text("y")] };
    const next = deleteLayoutChildFromArray([group], [0, 1]);
    assert.deepEqual(next, [{ type: "group", children: [text("x")] }]);
  });

  test("removes a whole container when the path ends on it", () => {
    const group = { type: "group", children: [text("x")] };
    assert.deepEqual(deleteLayoutChildFromArray([group, text("z")], [0]), [text("z")]);
  });

  test("ignores an out-of-range index", () => {
    const elements = [text("a")];
    assert.equal(deleteLayoutChildFromArray(elements, [4]), elements);
  });
});
