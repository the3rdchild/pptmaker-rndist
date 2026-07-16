import Konva from "konva";

/**
 * Canva-style alignment snapping for component drags.
 *
 * While a component is dragged we compare its axis-aligned bounding box
 * against snap "stops" collected from the stage (edges + center) and from
 * every other component (edges + centers). When an edge or center comes
 * within SNAP_THRESHOLD stage-pixels of a stop, the node is nudged onto it
 * and a magenta guide line is drawn on a dedicated overlay layer.
 */

export const SNAP_THRESHOLD = 6;
const GUIDE_COLOR = "#EC4899";
const MATCH_EPSILON = 0.5;

export type SnapStops = {
  vertical: number[];
  horizontal: number[];
};

export type SnapAdjustment = {
  dx: number;
  dy: number;
  verticalLines: number[];
  horizontalLines: number[];
};

type Box = { x: number; y: number; width: number; height: number };

function edgesOf(box: Box) {
  return {
    vertical: [box.x, box.x + box.width / 2, box.x + box.width],
    horizontal: [box.y, box.y + box.height / 2, box.y + box.height],
  };
}

export function stopsForBoxes(
  boxes: Box[],
  stageWidth: number,
  stageHeight: number,
): SnapStops {
  const vertical = [0, stageWidth / 2, stageWidth];
  const horizontal = [0, stageHeight / 2, stageHeight];
  for (const box of boxes) {
    vertical.push(box.x, box.x + box.width / 2, box.x + box.width);
    horizontal.push(box.y, box.y + box.height / 2, box.y + box.height);
  }
  return { vertical, horizontal };
}

function bestOffset(edges: number[], stops: number[]): number | null {
  let best: number | null = null;
  for (const edge of edges) {
    for (const stop of stops) {
      const offset = stop - edge;
      if (Math.abs(offset) > SNAP_THRESHOLD) continue;
      if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
    }
  }
  return best;
}

function matchedStops(edges: number[], stops: number[]): number[] {
  const matches = new Set<number>();
  for (const edge of edges) {
    for (const stop of stops) {
      if (Math.abs(stop - edge) <= MATCH_EPSILON) matches.add(stop);
    }
  }
  return [...matches];
}

export function computeSnap(box: Box, stops: SnapStops): SnapAdjustment {
  const edges = edgesOf(box);
  const dx = bestOffset(edges.vertical, stops.vertical) ?? 0;
  const dy = bestOffset(edges.horizontal, stops.horizontal) ?? 0;
  const snapped: Box = { ...box, x: box.x + dx, y: box.y + dy };
  const snappedEdges = edgesOf(snapped);
  return {
    dx,
    dy,
    verticalLines: matchedStops(snappedEdges.vertical, stops.vertical),
    horizontalLines: matchedStops(snappedEdges.horizontal, stops.horizontal),
  };
}

export function drawSnapGuides(
  layer: Konva.Layer | null,
  adjustment: Pick<SnapAdjustment, "verticalLines" | "horizontalLines">,
  stageWidth: number,
  stageHeight: number,
) {
  if (!layer) return;
  layer.destroyChildren();
  const style = {
    stroke: GUIDE_COLOR,
    strokeWidth: 1,
    dash: [5, 4],
    listening: false,
    perfectDrawEnabled: false,
  };
  for (const x of adjustment.verticalLines) {
    layer.add(new Konva.Line({ ...style, points: [x, 0, x, stageHeight] }));
  }
  for (const y of adjustment.horizontalLines) {
    layer.add(new Konva.Line({ ...style, points: [0, y, stageWidth, y] }));
  }
  layer.batchDraw();
}

export function clearSnapGuides(layer: Konva.Layer | null) {
  if (!layer) return;
  layer.destroyChildren();
  layer.batchDraw();
}
