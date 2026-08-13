// Converts DrawingML shape geometry into SVG path data.
//
// A .pptx states a shape's outline either as a freeform (`a:custGeom`, an
// ordered list of move/line/bezier/arc commands) or as one of ~180 named
// presets (`a:prstGeom`). The importer used to keep only the bounding box of
// either, which turns a dashed bezier connector into a dashed box the width of
// the slide and every arrow, chevron and star into a plain rectangle.
//
// ORDER MATTERS and is the reason this module reads raw XML rather than the
// parsed tree: fast-xml-parser groups siblings by tag name, so a path of
// moveTo → lnTo → cubicBezTo → lnTo comes back as {moveTo:[…], lnTo:[…, …],
// cubicBezTo:[…]} with the interleaving destroyed. The slide parser keeps
// `a:pathLst` as an unparsed string (`stopNodes`) and this scans it in
// document order.

/** Path data plus the coordinate space it is authored in. */
export type PathGeometry = {
  d: string;
  /** Emitted in destination px, so `view_box` matches the element's box at
   *  import size and the shape simply scales when the box is resized. */
  width: number;
  height: number;
};

type Point = { x: number; y: number };

const COMMAND = /<a:(moveTo|lnTo|cubicBezTo|quadBezTo)>([\s\S]*?)<\/a:\1>|<a:(arcTo)\b([^>]*?)\/?>|<a:(close)\s*\/>/g;
const POINT = /<a:pt\b([^>]*?)\/?>/g;
const PATH_BLOCK = /<a:path\b([^>]*?)>([\s\S]*?)<\/a:path>|<a:path\b([^>]*?)\/>/g;

function attr(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function attrNumber(source: string, name: string): number | null {
  const raw = attr(source, name);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function pointsOf(inner: string): Point[] | null {
  const points: Point[] = [];
  POINT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = POINT.exec(inner))) {
    const x = attrNumber(match[1], "x");
    const y = attrNumber(match[1], "y");
    // Coordinates can name a guide from a:gdLst instead of a literal. Those
    // need the whole formula evaluator; bail out so the caller keeps its
    // rectangle rather than drawing a shape with holes in it.
    if (x == null || y == null) return null;
    points.push({ x, y });
  }
  return points;
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Freeform geometry as SVG path data in a `boxWidth`×`boxHeight` space.
 *  `rawPathList` is the unparsed inner XML of `a:pathLst`; `extent` is the
 *  shape's own EMU size, used when a path declares no space of its own. */
export function custGeomToPath(
  rawPathList: string,
  extent: { cx: number; cy: number },
  boxWidth: number,
  boxHeight: number,
): PathGeometry | null {
  const segments: string[] = [];
  PATH_BLOCK.lastIndex = 0;
  let block: RegExpExecArray | null;
  let sawPath = false;

  while ((block = PATH_BLOCK.exec(rawPathList))) {
    sawPath = true;
    const header = block[1] ?? block[3] ?? "";
    const body = block[2] ?? "";
    // A path with no w/h of its own is authored directly in the shape's EMU
    // extent, per the spec's default.
    const pathWidth = attrNumber(header, "w") || extent.cx || boxWidth;
    const pathHeight = attrNumber(header, "h") || extent.cy || boxHeight;
    const sx = boxWidth / (pathWidth || 1);
    const sy = boxHeight / (pathHeight || 1);
    const X = (value: number) => fmt(value * sx);
    const Y = (value: number) => fmt(value * sy);

    let cursor: Point | null = null;
    COMMAND.lastIndex = 0;
    let command: RegExpExecArray | null;
    while ((command = COMMAND.exec(body))) {
      const kind = command[1] ?? command[3] ?? command[5];
      if (kind === "close") {
        segments.push("Z");
        continue;
      }
      if (kind === "arcTo") {
        if (!cursor) continue;
        const arc = arcToSegments(command[4] ?? "", cursor, sx, sy);
        if (!arc) return null;
        segments.push(arc.d);
        cursor = arc.end;
        continue;
      }

      const points = pointsOf(command[2] ?? "");
      if (!points) return null;
      if (kind === "moveTo" && points.length >= 1) {
        segments.push(`M${X(points[0].x)} ${Y(points[0].y)}`);
        cursor = points[0];
      } else if (kind === "lnTo" && points.length >= 1) {
        segments.push(`L${X(points[0].x)} ${Y(points[0].y)}`);
        cursor = points[0];
      } else if (kind === "cubicBezTo" && points.length >= 3) {
        segments.push(
          `C${X(points[0].x)} ${Y(points[0].y)} ${X(points[1].x)} ${Y(points[1].y)} ${X(points[2].x)} ${Y(points[2].y)}`,
        );
        cursor = points[2];
      } else if (kind === "quadBezTo" && points.length >= 2) {
        segments.push(`Q${X(points[0].x)} ${Y(points[0].y)} ${X(points[1].x)} ${Y(points[1].y)}`);
        cursor = points[1];
      }
    }
  }

  if (!sawPath || segments.length === 0) return null;
  return { d: segments.join(" "), width: boxWidth, height: boxHeight };
}

/** `a:arcTo` gives radii plus a start and sweep angle (60000ths of a degree)
 *  and takes its start point from wherever the pen already is — the centre is
 *  implied. SVG's arc wants the END point instead, so both are derived here.
 *  A sweep of 360° or more cannot be drawn by a single SVG arc (start and end
 *  would coincide), so every arc is emitted in slices of at most a half turn. */
function arcToSegments(
  header: string,
  from: Point,
  sx: number,
  sy: number,
): { d: string; end: Point } | null {
  const wR = attrNumber(header, "wR");
  const hR = attrNumber(header, "hR");
  const stAng = attrNumber(header, "stAng");
  const swAng = attrNumber(header, "swAng");
  if (wR == null || hR == null || stAng == null || swAng == null) return null;

  const start = (stAng / 60000) * (Math.PI / 180);
  const sweep = (swAng / 60000) * (Math.PI / 180);
  const centre = { x: from.x - wR * Math.cos(start), y: from.y - hR * Math.sin(start) };

  const slices = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI));
  const step = sweep / slices;
  const rx = fmt(Math.abs(wR * sx));
  const ry = fmt(Math.abs(hR * sy));
  // Both DrawingML and SVG measure positive angles clockwise on a y-down
  // canvas, so a positive sweep is a positive sweep-flag with no mirroring.
  const sweepFlag = sweep >= 0 ? 1 : 0;

  const parts: string[] = [];
  let cursor = from;
  for (let index = 1; index <= slices; index++) {
    const angle = start + step * index;
    const end = { x: centre.x + wR * Math.cos(angle), y: centre.y + hR * Math.sin(angle) };
    const largeArc = Math.abs(step) > Math.PI ? 1 : 0;
    parts.push(`A${rx} ${ry} 0 ${largeArc} ${sweepFlag} ${fmt(end.x * sx)} ${fmt(end.y * sy)}`);
    cursor = end;
  }
  return { d: parts.join(" "), end: cursor };
}
