import Konva from "konva";

type Box = { x: number; y: number; width: number; height: number };

const FILL = "rgba(245, 158, 11, 0.14)";
const STROKE = "#F59E0B";

export function drawFindHighlight(layer: Konva.Layer | null, box: Box) {
  if (!layer) return;
  layer.destroyChildren();
  layer.add(
    new Konva.Rect({
      ...box,
      fill: FILL,
      stroke: STROKE,
      strokeWidth: 2,
      dash: [6, 4],
      cornerRadius: 4,
      listening: false,
      perfectDrawEnabled: false,
      shadowForStrokeEnabled: false,
    }),
  );
  layer.batchDraw();
}

export function clearFindHighlight(layer: Konva.Layer | null) {
  if (!layer) return;
  layer.destroyChildren();
  layer.batchDraw();
}
