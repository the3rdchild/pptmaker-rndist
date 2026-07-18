import Konva from "konva";

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

export const MARQUEE_DRAG_THRESHOLD = 3;

const FILL = "rgba(59, 130, 246, 0.12)";
const STROKE = "#3B82F6";

export function boxFromPoints(start: Point, current: Point): Box {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function drawMarqueeRect(layer: Konva.Layer | null, box: Box) {
  if (!layer) return;
  layer.destroyChildren();
  layer.add(
    new Konva.Rect({
      ...box,
      fill: FILL,
      stroke: STROKE,
      strokeWidth: 1,
      listening: false,
      perfectDrawEnabled: false,
    }),
  );
  layer.batchDraw();
}

export function clearMarqueeRect(layer: Konva.Layer | null) {
  if (!layer) return;
  layer.destroyChildren();
  layer.batchDraw();
}
