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

/** Named preset geometry as path data in a `w`×`h` space, or null when the
 * preset has no mapping here and the caller should keep its rectangle.
 *
 * `adj` reads a shape's adjust handles (`a:avLst/a:gd`), falling back to the
 * preset's documented default — a chevron with no avLst is still a chevron
 * with a half-width notch. Presets whose adjusts are stated relative to the
 * "shorter side" use `ss`, matching the spec's own guide formulas, so a wide
 * flat arrow gets a proportional head rather than one scaled to its width. */
export function presetToPath(
  prst: string,
  adj: (name: string, fallback: number) => number,
  w: number,
  h: number,
): PathGeometry | null {
  const ss = Math.min(w, h);
  const d = presetPathData(prst, adj, w, h, ss);
  return d ? { d, width: w, height: h } : null;
}

function presetPathData(
  prst: string,
  adj: (name: string, fallback: number) => number,
  w: number,
  h: number,
  ss: number,
): string | null {
  const P = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
  const poly = (points: [number, number][]) =>
    `M${P(points[0][0], points[0][1])} ${points.slice(1).map(([x, y]) => `L${P(x, y)}`).join(" ")} Z`;
  /** Adjust value as a fraction, clamped so a hand-edited handle can't invert
   *  the shape. */
  const frac = (name: string, fallback: number, max = 1) =>
    Math.max(0, Math.min(max, adj(name, fallback) / 100000));

  switch (prst) {
    case "triangle": {
      const apex = frac("adj", 50000) * w;
      return poly([[apex, 0], [w, h], [0, h]]);
    }
    case "rtTriangle":
      return poly([[0, 0], [0, h], [w, h]]);
    case "diamond":
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case "parallelogram": {
      const a = frac("adj", 25000) * ss;
      return poly([[a, 0], [w, 0], [w - a, h], [0, h]]);
    }
    case "trapezoid": {
      const a = frac("adj", 25000) * ss;
      return poly([[a, 0], [w - a, 0], [w, h], [0, h]]);
    }
    case "pentagon":
      return regularPolygon(w, h, 5);
    case "hexagon": {
      const a = frac("adj", 25000) * ss;
      return poly([[a, 0], [w - a, 0], [w, h / 2], [w - a, h], [a, h], [0, h / 2]]);
    }
    case "octagon": {
      const a = frac("adj", 29289) * ss;
      return poly([
        [a, 0], [w - a, 0], [w, a], [w, h - a],
        [w - a, h], [a, h], [0, h - a], [0, a],
      ]);
    }
    case "homePlate": {
      const a = frac("adj", 16667) * ss;
      return poly([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h]]);
    }
    case "chevron": {
      const a = frac("adj", 50000) * ss;
      return poly([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h], [a, h / 2]]);
    }
    case "plus": {
      const a = frac("adj", 25000) * ss;
      return poly([
        [a, 0], [w - a, 0], [w - a, a], [w, a], [w, h - a], [w - a, h - a],
        [w - a, h], [a, h], [a, h - a], [0, h - a], [0, a], [a, a],
      ]);
    }
    case "rightArrow": {
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(w, frac("adj2", 50000) * ss);
      return poly([
        [0, (h - t) / 2], [w - head, (h - t) / 2], [w - head, 0],
        [w, h / 2], [w - head, h], [w - head, (h + t) / 2], [0, (h + t) / 2],
      ]);
    }
    case "leftArrow": {
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(w, frac("adj2", 50000) * ss);
      return poly([
        [w, (h - t) / 2], [head, (h - t) / 2], [head, 0],
        [0, h / 2], [head, h], [head, (h + t) / 2], [w, (h + t) / 2],
      ]);
    }
    case "downArrow": {
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(h, frac("adj2", 50000) * ss);
      return poly([
        [(w - t) / 2, 0], [(w + t) / 2, 0], [(w + t) / 2, h - head],
        [w, h - head], [w / 2, h], [0, h - head], [(w - t) / 2, h - head],
      ]);
    }
    case "upArrow": {
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(h, frac("adj2", 50000) * ss);
      return poly([
        [(w - t) / 2, h], [(w - t) / 2, head], [0, head], [w / 2, 0],
        [w, head], [(w + t) / 2, head], [(w + t) / 2, h],
      ]);
    }
    case "leftRightArrow": {
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(w / 2, frac("adj2", 50000) * ss);
      return poly([
        [0, h / 2], [head, 0], [head, (h - t) / 2], [w - head, (h - t) / 2],
        [w - head, 0], [w, h / 2], [w - head, h], [w - head, (h + t) / 2],
        [head, (h + t) / 2], [head, h],
      ]);
    }
    case "stripedRightArrow": {
      // The stripes are separate subpaths; even-odd fill keeps them solid
      // rather than punching them out, which matches how they read.
      const t = frac("adj1", 50000) * ss;
      const head = Math.min(w, frac("adj2", 50000) * ss);
      const stripe = ss / 16;
      const body = poly([
        [stripe * 3, (h - t) / 2], [w - head, (h - t) / 2], [w - head, 0],
        [w, h / 2], [w - head, h], [w - head, (h + t) / 2], [stripe * 3, (h + t) / 2],
      ]);
      const bar = (x: number, width: number) =>
        poly([[x, (h - t) / 2], [x + width, (h - t) / 2], [x + width, (h + t) / 2], [x, (h + t) / 2]]);
      return `${bar(0, stripe)} ${bar(stripe * 1.5, stripe)} ${body}`;
    }
    case "star4":
      return star(w, h, 4, 0.3);
    case "star5":
      return star(w, h, 5, 0.381966);
    case "star6":
      return star(w, h, 6, 0.5);
    case "star8":
      return star(w, h, 8, 0.6);
    case "donut": {
      const t = frac("adj", 25000) * ss;
      return `${ellipsePath(w / 2, h / 2, w / 2, h / 2)} ${ellipsePath(w / 2, h / 2, w / 2 - t, h / 2 - t)}`;
    }
    case "pie":
    case "arc":
    case "chord": {
      // Angles are in 60000ths of a degree, measured clockwise from 3 o'clock.
      const start = adj("adj1", 0) / 60000;
      const end = adj("adj2", 16200000) / 60000;
      const close = prst === "pie" ? "centre" : prst === "chord" ? "chord" : "open";
      return wedgePath(w, h, start, end, close);
    }
    case "blockArc": {
      const start = adj("adj1", 10800000) / 60000;
      const end = adj("adj2", 0) / 60000;
      const t = frac("adj3", 25000) * ss;
      return blockArcPath(w, h, start, end, t);
    }
    case "teardrop": {
      // A circle with one corner pulled out to a point.
      const a = frac("adj", 100000, 2);
      return (
        `M0 ${fmt(h / 2)}` +
        ` A${fmt(w / 2)} ${fmt(h / 2)} 0 0 1 ${P(w / 2, 0)}` +
        ` L${P(w / 2 + (w / 2) * a, (h / 2) * (1 - a))}` +
        ` L${P(w, h / 2)}` +
        ` A${fmt(w / 2)} ${fmt(h / 2)} 0 0 1 ${P(w / 2, h)}` +
        ` A${fmt(w / 2)} ${fmt(h / 2)} 0 0 1 ${P(0, h / 2)} Z`
      );
    }
    case "heart":
      // Two lobes meeting at a point bottom-centre. Control points are kept
      // inside the box so the shape never paints outside its own bounds.
      return (
        `M${P(w / 2, h)}` +
        ` C${P(w * 0.15, h * 0.75)} ${P(0, h * 0.5)} ${P(0, h * 0.3)}` +
        ` C${P(0, h * 0.1)} ${P(w * 0.2, 0)} ${P(w * 0.35, 0)}` +
        ` C${P(w * 0.43, 0)} ${P(w / 2, h * 0.05)} ${P(w / 2, h * 0.15)}` +
        ` C${P(w / 2, h * 0.05)} ${P(w * 0.57, 0)} ${P(w * 0.65, 0)}` +
        ` C${P(w * 0.8, 0)} ${P(w, h * 0.1)} ${P(w, h * 0.3)}` +
        ` C${P(w, h * 0.5)} ${P(w * 0.85, h * 0.75)} ${P(w / 2, h)} Z`
      );
    // Connectors. A bent or curved connector reduced to a straight line (which
    // is what a `line` element draws) misses the whole point of the shape.
    case "straightConnector1":
    case "line":
      return `M0 0 L${P(w, h)}`;
    case "bentConnector2":
      return `M0 0 L${P(w, 0)} L${P(w, h)}`;
    case "bentConnector3": {
      const a = frac("adj1", 50000) * w;
      return `M0 0 L${P(a, 0)} L${P(a, h)} L${P(w, h)}`;
    }
    case "bentConnector4":
    case "bentConnector5": {
      const a = frac("adj1", 50000) * w;
      const b = frac("adj2", 50000) * h;
      return `M0 0 L${P(a, 0)} L${P(a, b)} L${P(w, b)} L${P(w, h)}`;
    }
    case "curvedConnector2":
      return `M0 0 Q${P(w, 0)} ${P(w, h)}`;
    case "curvedConnector3": {
      const a = frac("adj1", 50000) * w;
      return `M0 0 C${P(a, 0)} ${P(a, h)} ${P(w, h)}`;
    }
    default:
      return null;
  }
}

/** A regular n-gon inscribed in the box, first vertex at 12 o'clock. */
function regularPolygon(w: number, h: number, sides: number): string {
  const points: [number, number][] = [];
  for (let index = 0; index < sides; index++) {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    points.push([w / 2 + (w / 2) * Math.cos(angle), h / 2 + (h / 2) * Math.sin(angle)]);
  }
  return `M${fmt(points[0][0])} ${fmt(points[0][1])} ${points
    .slice(1)
    .map(([x, y]) => `L${fmt(x)} ${fmt(y)}`)
    .join(" ")} Z`;
}

function star(w: number, h: number, points: number, innerRatio: number): string {
  const vertices: string[] = [];
  for (let index = 0; index < points * 2; index++) {
    const radius = index % 2 === 0 ? 1 : innerRatio;
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const x = w / 2 + (w / 2) * radius * Math.cos(angle);
    const y = h / 2 + (h / 2) * radius * Math.sin(angle);
    vertices.push(`${index === 0 ? "M" : "L"}${fmt(x)} ${fmt(y)}`);
  }
  return `${vertices.join(" ")} Z`;
}

/** A closed ellipse as two half arcs — one arc command cannot return to its
 *  own start point. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return "";
  return (
    `M${fmt(cx - rx)} ${fmt(cy)}` +
    ` A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}` +
    ` A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`
  );
}

function pointOnEllipse(w: number, h: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [w / 2 + (w / 2) * Math.cos(radians), h / 2 + (h / 2) * Math.sin(radians)];
}

/** Pie slice (closed back through the centre), chord (closed straight across
 *  its own ends) or arc (left open — it is a stroked curve, not an area). */
function wedgePath(
  w: number,
  h: number,
  start: number,
  end: number,
  close: "centre" | "chord" | "open",
): string {
  const sweep = ((end - start) % 360 + 360) % 360;
  const [sx, sy] = pointOnEllipse(w, h, start);
  const [ex, ey] = pointOnEllipse(w, h, end);
  const large = sweep > 180 ? 1 : 0;
  const arc = `A${fmt(w / 2)} ${fmt(h / 2)} 0 ${large} 1 ${fmt(ex)} ${fmt(ey)}`;
  if (close === "open") return `M${fmt(sx)} ${fmt(sy)} ${arc}`;
  if (close === "chord") return `M${fmt(sx)} ${fmt(sy)} ${arc} Z`;
  return `M${fmt(w / 2)} ${fmt(h / 2)} L${fmt(sx)} ${fmt(sy)} ${arc} Z`;
}

/** Ring segment: out along the start radius, round the outer edge, back along
 *  the end radius, and round the inner edge the other way. */
function blockArcPath(w: number, h: number, start: number, end: number, thickness: number): string {
  const sweep = ((end - start) % 360 + 360) % 360;
  const large = sweep > 180 ? 1 : 0;
  const innerW = Math.max(0, w - thickness * 2);
  const innerH = Math.max(0, h - thickness * 2);
  const outer = (deg: number) => pointOnEllipse(w, h, deg);
  const inner = (deg: number) => {
    const radians = (deg * Math.PI) / 180;
    return [w / 2 + (innerW / 2) * Math.cos(radians), h / 2 + (innerH / 2) * Math.sin(radians)];
  };
  const [osx, osy] = outer(start);
  const [oex, oey] = outer(end);
  const [iex, iey] = inner(end);
  const [isx, isy] = inner(start);
  return (
    `M${fmt(osx)} ${fmt(osy)}` +
    ` A${fmt(w / 2)} ${fmt(h / 2)} 0 ${large} 1 ${fmt(oex)} ${fmt(oey)}` +
    ` L${fmt(iex)} ${fmt(iey)}` +
    ` A${fmt(innerW / 2)} ${fmt(innerH / 2)} 0 ${large} 0 ${fmt(isx)} ${fmt(isy)} Z`
  );
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
