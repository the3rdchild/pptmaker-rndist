import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  resizeRootElement,
  unclampedPositionFromNodeInParent,
  type RawElement,
} from "./model";

describe("root element canvas transforms", () => {
  test("keeps drag positions outside every stage edge", () => {
    const negativeNode = {
      absolutePosition: () => ({ x: -80, y: -45 }),
      offsetX: () => 0,
      offsetY: () => 0,
    };
    const overflowNode = {
      absolutePosition: () => ({ x: 1410, y: 840 }),
      offsetX: () => 0,
      offsetY: () => 0,
    };
    const parent = { x: 0, y: 0, width: 1280, height: 720 };
    const box = { x: 0, y: 0, width: 240, height: 120 };

    assert.deepEqual(
      unclampedPositionFromNodeInParent(negativeNode as never, parent, box),
      { x: -80, y: -45 },
    );
    assert.deepEqual(
      unclampedPositionFromNodeInParent(overflowNode as never, parent, box),
      { x: 1410, y: 840 },
    );
  });

  test("side-handle resize changes text bounds without stretching text metrics", () => {
    const element = {
      type: "text",
      position: { x: 80, y: 70 },
      size: { width: 400, height: 140 },
      font: { family: "Arial", size: 64, letter_spacing: 2 },
      runs: [
        {
          text: "Indonesia, Negeri dengan Keindahan yang Beragam",
          font: { family: "Arial", size: 64, letter_spacing: 2 },
        },
      ],
    } satisfies RawElement;

    const resized = resizeRootElement(
      element,
      {
        x: -30,
        y: 70,
        width: 510,
        height: 140,
        scaleX: 1.275,
        scaleY: 1,
        rotation: 0,
      },
      "resize-bounds",
    );

    assert.deepEqual(resized.position, { x: -30, y: 70 });
    assert.deepEqual(resized.size, { width: 510, height: 140 });
    assert.equal((resized.font as { size: number }).size, 64);
    assert.equal(
      ((resized.runs as Array<{ font: { size: number } }>)[0]?.font.size),
      64,
    );
  });

  test("corner resize scales text metrics and preserves overflow coordinates", () => {
    const element = {
      type: "text",
      position: { x: 900, y: 500 },
      size: { width: 300, height: 120 },
      font: { family: "Arial", size: 40, letter_spacing: 1 },
      runs: [
        {
          text: "Canvas text",
          font: { family: "Arial", size: 40, letter_spacing: 1 },
        },
      ],
    } satisfies RawElement;

    const resized = resizeRootElement(
      element,
      {
        x: 1100,
        y: 690,
        width: 600,
        height: 240,
        scaleX: 2,
        scaleY: 2,
        rotation: 12,
      },
      "scale-content",
    );

    assert.deepEqual(resized.position, { x: 1100, y: 690 });
    assert.deepEqual(resized.size, { width: 600, height: 240 });
    assert.equal(resized.rotation, 12);
    assert.equal((resized.font as { size: number }).size, 80);
    assert.equal(
      ((resized.runs as Array<{ font: { size: number } }>)[0]?.font.size),
      80,
    );
  });
});
