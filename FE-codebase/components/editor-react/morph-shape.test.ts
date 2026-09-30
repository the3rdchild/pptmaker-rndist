import assert from "node:assert/strict";
import { test } from "node:test";

import { contourPathAt, shapePathSpec } from "./morph-shape";

test("shape paths preserve rounded corners, circles, and arbitrary vector outlines", () => {
  const rect = shapePathSpec({ type: "rectangle", size: { width: 200, height: 100 }, border_radius: 20 });
  const circle = shapePathSpec({ type: "ellipse", size: { width: 100, height: 100 } });
  const triangle = shapePathSpec({ type: "path", size: { width: 100, height: 100 }, view_box: { width: 100, height: 100 }, d: "M 50 0 L 100 100 L 0 100 Z" });
  assert.match(rect!.d, /Q 200 0 200 20/);
  assert.match(circle!.d, /A 50 50/);
  assert.equal(triangle!.d, "M 50 0 L 100 100 L 0 100 Z");
});

test("contour interpolation moves every boundary point, including the stroke", () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const diamond = [{ x: .5, y: 0 }, { x: 1, y: .5 }, { x: .5, y: 1 }, { x: 0, y: .5 }];
  const middle = contourPathAt(square, diamond, .5);
  assert.match(middle, /M 250 0 L 1000 250 L 750 1000 L 0 750 Z/);
  assert.notEqual(middle, contourPathAt(square, diamond, 0));
  assert.notEqual(middle, contourPathAt(square, diamond, 1));
});
