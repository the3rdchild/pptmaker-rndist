import Konva from "konva";

/**
 * Canva-style spacing badges: while dragging a component, show a small pill
 * with the pixel gap to the nearest neighboring component on each side
 * (left/right/top/bottom), but only when the two boxes actually overlap on
 * the perpendicular axis (so a badge only appears between components that
 * are plausibly "next to" each other, not diagonal neighbors).
 */

export type SpacingBadge = {
  x: number;
  y: number;
  distance: number;
  axis: "horizontal" | "vertical";
};

type Box = { x: number; y: number; width: number; height: number };

const MAX_GAP = 400;
const MIN_GAP = 1;
const BADGE_COLOR = "#EC4899";
const PILL_HEIGHT = 20;
const PILL_PAD_X = 8;
const FONT_SIZE = 11;

function verticalOverlap(a: Box, b: Box): [number, number] | null {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return bottom > top ? [top, bottom] : null;
}

function horizontalOverlap(a: Box, b: Box): [number, number] | null {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  return right > left ? [left, right] : null;
}

export function computeSpacingBadges(
  dragged: Box,
  others: Box[],
): SpacingBadge[] {
  const badges: SpacingBadge[] = [];
  let leftGap = Infinity;
  let leftMidY = 0;
  let rightGap = Infinity;
  let rightMidY = 0;
  let topGap = Infinity;
  let topMidX = 0;
  let bottomGap = Infinity;
  let bottomMidX = 0;

  for (const other of others) {
    const vOverlap = verticalOverlap(dragged, other);
    if (vOverlap) {
      const midY = (vOverlap[0] + vOverlap[1]) / 2;
      if (other.x + other.width <= dragged.x) {
        const gap = dragged.x - (other.x + other.width);
        if (gap >= MIN_GAP && gap < leftGap) {
          leftGap = gap;
          leftMidY = midY;
        }
      } else if (other.x >= dragged.x + dragged.width) {
        const gap = other.x - (dragged.x + dragged.width);
        if (gap >= MIN_GAP && gap < rightGap) {
          rightGap = gap;
          rightMidY = midY;
        }
      }
    }

    const hOverlap = horizontalOverlap(dragged, other);
    if (hOverlap) {
      const midX = (hOverlap[0] + hOverlap[1]) / 2;
      if (other.y + other.height <= dragged.y) {
        const gap = dragged.y - (other.y + other.height);
        if (gap >= MIN_GAP && gap < topGap) {
          topGap = gap;
          topMidX = midX;
        }
      } else if (other.y >= dragged.y + dragged.height) {
        const gap = other.y - (dragged.y + dragged.height);
        if (gap >= MIN_GAP && gap < bottomGap) {
          bottomGap = gap;
          bottomMidX = midX;
        }
      }
    }
  }

  if (Number.isFinite(leftGap) && leftGap <= MAX_GAP) {
    badges.push({
      x: dragged.x - leftGap / 2,
      y: leftMidY,
      distance: Math.round(leftGap),
      axis: "horizontal",
    });
  }
  if (Number.isFinite(rightGap) && rightGap <= MAX_GAP) {
    badges.push({
      x: dragged.x + dragged.width + rightGap / 2,
      y: rightMidY,
      distance: Math.round(rightGap),
      axis: "horizontal",
    });
  }
  if (Number.isFinite(topGap) && topGap <= MAX_GAP) {
    badges.push({
      x: topMidX,
      y: dragged.y - topGap / 2,
      distance: Math.round(topGap),
      axis: "vertical",
    });
  }
  if (Number.isFinite(bottomGap) && bottomGap <= MAX_GAP) {
    badges.push({
      x: bottomMidX,
      y: dragged.y + dragged.height + bottomGap / 2,
      distance: Math.round(bottomGap),
      axis: "vertical",
    });
  }

  return badges;
}

export function drawSpacingBadges(
  layer: Konva.Layer | null,
  badges: SpacingBadge[],
) {
  if (!layer) return;
  layer.destroyChildren();
  for (const badge of badges) {
    const label = String(badge.distance);
    const width = Math.max(26, label.length * (FONT_SIZE * 0.62) + PILL_PAD_X * 2);
    const group = new Konva.Group({
      x: badge.x - width / 2,
      y: badge.y - PILL_HEIGHT / 2,
      listening: false,
    });
    group.add(
      new Konva.Rect({
        width,
        height: PILL_HEIGHT,
        cornerRadius: PILL_HEIGHT / 2,
        fill: BADGE_COLOR,
        perfectDrawEnabled: false,
      }),
    );
    group.add(
      new Konva.Text({
        text: label,
        width,
        height: PILL_HEIGHT,
        align: "center",
        verticalAlign: "middle",
        fontSize: FONT_SIZE,
        fontStyle: "600",
        fill: "#FFFFFF",
        listening: false,
      }),
    );
    layer.add(group);
  }
  layer.batchDraw();
}

export function clearSpacingBadges(layer: Konva.Layer | null) {
  if (!layer) return;
  layer.destroyChildren();
  layer.batchDraw();
}
