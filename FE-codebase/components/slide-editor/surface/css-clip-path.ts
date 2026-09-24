import type Konva from "konva";
import {
  readString,
  type Point,
  type RawElement,
} from "@/components/slide-editor/model/model";

export type ParsedImageClipPath =
  | { kind: "polygon"; points: Point[] }
  | { kind: "path"; data: string; scale?: boolean }
  | {
    kind: "inset";
    top: number;
    right: number;
    bottom: number;
    left: number;
    radius: number;
  }
  | { kind: "rect"; x: number; y: number; width: number; height: number; radius: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "ellipse"; x: number; y: number; radiusX: number; radiusY: number };

export function imageClipPath(element: RawElement): string | null {
  const raw = readString(element.clippath ?? element.clipPath ?? element.clip_path);
  const clipPath = raw?.trim();
  return clipPath && clipPath.toLowerCase() !== "none" ? clipPath : null;
}

export function drawImageClipPath(
  context: Konva.Context,
  clipPath: string,
  width: number,
  height: number,
) {
  const parsed = parseImageClipPath(clipPath, width, height);
  if (!parsed) {
    context.rect(0, 0, width, height);
    return;
  }

  if (parsed.kind === "path") {
    if (typeof Path2D !== "undefined") {
      try {
        const path = new Path2D(parsed.data);
        if (!parsed.scale) return [new Path2D(parsed.data)] as [Path2D];
        // Normalized frame path (authored in a 100×100 box) — scale it onto
        // the element so the clip reshapes when the frame is resized.
        const scaled = new Path2D();
        scaled.addPath(path, new DOMMatrix().scale(width / 100, height / 100));
        return [scaled] as [Path2D];
      } catch {
        // Fall through to the basic path drawer below.
      }
    }
    if (drawBasicSvgClipPath(context, parsed.data)) return;
    context.rect(0, 0, width, height);
    return;
  }

  if (parsed.kind === "polygon") {
    parsed.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    return;
  }

  if (parsed.kind === "inset") {
    const x = parsed.left;
    const y = parsed.top;
    const insetWidth = Math.max(0, width - parsed.left - parsed.right);
    const insetHeight = Math.max(0, height - parsed.top - parsed.bottom);
    const radius = Math.min(parsed.radius, insetWidth / 2, insetHeight / 2);
    if (radius > 0) {
      context.roundRect(x, y, insetWidth, insetHeight, radius);
    } else {
      context.rect(x, y, insetWidth, insetHeight);
    }
    return;
  }

  if (parsed.kind === "rect") {
    const radius = Math.min(parsed.radius, parsed.width / 2, parsed.height / 2);
    if (radius > 0) {
      context.roundRect(parsed.x, parsed.y, parsed.width, parsed.height, radius);
    } else {
      context.rect(parsed.x, parsed.y, parsed.width, parsed.height);
    }
    return;
  }

  if (parsed.kind === "circle") {
    context.arc(parsed.x, parsed.y, parsed.radius, 0, Math.PI * 2);
    return;
  }

  context.ellipse(
    parsed.x,
    parsed.y,
    parsed.radiusX,
    parsed.radiusY,
    0,
    0,
    Math.PI * 2,
  );
}

function parseImageClipPath(
  value: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  // frame-path("…") — normalized 100×100 frame shapes from the Elements tab.
  // Checked first: plain path() clips (pptx imports) stay absolute.
  const frameData = framePathDataFromValue(value);
  if (frameData) return { kind: "path", data: frameData, scale: true };

  const pathData = clipPathDataFromValue(value);
  if (pathData) return { kind: "path", data: pathData };

  const clipFunction = readCssClipFunction(value);
  if (!clipFunction) return null;

  const { kind, body } = clipFunction;
  if (kind === "polygon") return parsePolygonClipPath(body, width, height);
  if (kind === "inset") return parseInsetClipPath(body, width, height);
  if (kind === "rect") return parseRectClipPath(body, width, height);
  if (kind === "xywh") return parseXywhClipPath(body, width, height);
  if (kind === "circle") return parseCircleClipPath(body, width, height);
  if (kind === "ellipse") return parseEllipseClipPath(body, width, height);
  return null;
}

function parsePolygonClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const pointSource = body.replace(/^(evenodd|nonzero)\s*,\s*/i, "");
  const rawPoints = pointSource.split(/\s*,\s*/).filter(Boolean);
  const points =
    rawPoints.length >= 3
      ? rawPoints.map((point) => parseClipPoint(point, width, height))
      : parseClipPointPairs(splitCssTokens(pointSource), width, height);

  if (points.length < 3 || points.some((point) => point == null)) return null;
  return {
    kind: "polygon",
    points: points as Point[],
  };
}

function parseInsetClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [insetPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(insetPart);
  if (values.length === 0) return null;

  const top = parseClipLength(values[0], height);
  const right = parseClipLength(values[1] ?? values[0], width);
  const bottom = parseClipLength(values[2] ?? values[0], height);
  const left = parseClipLength(values[3] ?? values[1] ?? values[0], width);
  if (top == null || right == null || bottom == null || left == null) {
    return null;
  }

  const radius = parseClipBoxRadius(radiusPart, width, height);
  return {
    kind: "inset",
    top,
    right,
    bottom,
    left,
    radius,
  };
}

function parseRectClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [rectPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(rectPart);
  if (values.length < 4) return null;

  const top = parseClipLength(values[0], height);
  const right = parseClipLength(values[1], width);
  const bottom = parseClipLength(values[2], height);
  const left = parseClipLength(values[3], width);
  if (top == null || right == null || bottom == null || left == null) {
    return null;
  }

  return {
    kind: "rect",
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    radius: parseClipBoxRadius(radiusPart, width, height),
  };
}

function parseXywhClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [boxPart, radiusPart] = splitCssRound(body);
  const values = splitCssTokens(boxPart);
  if (values.length < 4) return null;

  const x = parseClipLength(values[0], width);
  const y = parseClipLength(values[1], height);
  const rectWidth = parseClipLength(values[2], width);
  const rectHeight = parseClipLength(values[3], height);
  if (x == null || y == null || rectWidth == null || rectHeight == null) {
    return null;
  }

  return {
    kind: "rect",
    x,
    y,
    width: Math.max(0, rectWidth),
    height: Math.max(0, rectHeight),
    radius: parseClipBoxRadius(radiusPart, width, height),
  };
}

function parseCircleClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [radiusPart, positionPart] = splitCssAt(body);
  const radiusToken = splitCssTokens(radiusPart)[0];
  const center = parseClipPosition(positionPart, width, height);
  if (!center) return null;
  const radius = radiusToken
    ? parseCircleRadius(radiusToken, center, width, height)
    : Math.min(center.x, width - center.x, center.y, height - center.y);
  if (radius == null || !center) return null;
  return {
    kind: "circle",
    x: center.x,
    y: center.y,
    radius,
  };
}

function parseEllipseClipPath(
  body: string,
  width: number,
  height: number,
): ParsedImageClipPath | null {
  const [radiusPart, positionPart] = splitCssAt(body);
  const radiusTokens = splitCssTokens(radiusPart);
  const center = parseClipPosition(positionPart, width, height);
  if (!center) return null;
  const radiusX = radiusTokens[0]
    ? parseEllipseRadius(radiusTokens[0], center.x, width)
    : Math.min(center.x, width - center.x);
  const radiusY = radiusTokens[1]
    ? parseEllipseRadius(radiusTokens[1], center.y, height)
    : radiusTokens[0]
      ? parseEllipseRadius(radiusTokens[0], center.y, height)
      : Math.min(center.y, height - center.y);
  if (radiusX == null || radiusY == null || !center) return null;
  return {
    kind: "ellipse",
    x: center.x,
    y: center.y,
    radiusX,
    radiusY,
  };
}

function parseClipBoxRadius(
  value: string | null,
  width: number,
  height: number,
) {
  const radiusToken = value ? splitCssTokens(value)[0] : null;
  return radiusToken
    ? parseClipLength(radiusToken, Math.min(width, height)) ?? 0
    : 0;
}

function parseCircleRadius(
  token: string,
  center: Point,
  width: number,
  height: number,
) {
  const normalized = token.toLowerCase();
  if (normalized === "closest-side") {
    return Math.min(center.x, width - center.x, center.y, height - center.y);
  }
  if (normalized === "farthest-side") {
    return Math.max(center.x, width - center.x, center.y, height - center.y);
  }
  return parseClipLength(token, Math.min(width, height));
}

function parseEllipseRadius(token: string, center: number, size: number) {
  const normalized = token.toLowerCase();
  if (normalized === "closest-side") return Math.min(center, size - center);
  if (normalized === "farthest-side") return Math.max(center, size - center);
  return parseClipLength(token, size);
}

function drawBasicSvgClipPath(context: Konva.Context, data: string) {
  const tokens =
    data.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ??
    [];
  let index = 0;
  let command = "";
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };
  let lastCubicControl: Point | null = null;
  let lastQuadraticControl: Point | null = null;

  const isCommand = (token: string | undefined) =>
    Boolean(token && /^[A-Za-z]$/.test(token));
  const readPathNumber = () => {
    const token = tokens[index];
    if (token == null || isCommand(token)) return null;
    index += 1;
    const value = Number.parseFloat(token);
    return Number.isFinite(value) ? value : null;
  };
  const readPoint = (relative: boolean): Point | null => {
    const x = readPathNumber();
    const y = readPathNumber();
    if (x == null || y == null) return null;
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };
  const reflectPoint = (point: Point | null) =>
    point ? { x: current.x * 2 - point.x, y: current.y * 2 - point.y } : current;

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index] ?? "";
      index += 1;
    } else if (!command) {
      return false;
    }

    const relative = command === command.toLowerCase();
    switch (command.toLowerCase()) {
      case "m": {
        const point = readPoint(relative);
        if (!point) return false;
        context.moveTo(point.x, point.y);
        current = point;
        subpathStart = point;
        command = relative ? "l" : "L";
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "l": {
        const point = readPoint(relative);
        if (!point) return false;
        context.lineTo(point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "h": {
        const value = readPathNumber();
        if (value == null) return false;
        current = { x: relative ? current.x + value : value, y: current.y };
        context.lineTo(current.x, current.y);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "v": {
        const value = readPathNumber();
        if (value == null) return false;
        current = { x: current.x, y: relative ? current.y + value : value };
        context.lineTo(current.x, current.y);
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      case "c": {
        const control1 = readPoint(relative);
        const control2 = readPoint(relative);
        const point = readPoint(relative);
        if (!control1 || !control2 || !point) return false;
        context.bezierCurveTo(
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          point.x,
          point.y,
        );
        current = point;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        break;
      }
      case "s": {
        const control1 = reflectPoint(lastCubicControl);
        const control2 = readPoint(relative);
        const point = readPoint(relative);
        if (!control2 || !point) return false;
        context.bezierCurveTo(
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          point.x,
          point.y,
        );
        current = point;
        lastCubicControl = control2;
        lastQuadraticControl = null;
        break;
      }
      case "q": {
        const control = readPoint(relative);
        const point = readPoint(relative);
        if (!control || !point) return false;
        context.quadraticCurveTo(control.x, control.y, point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = control;
        break;
      }
      case "t": {
        const control = reflectPoint(lastQuadraticControl);
        const point = readPoint(relative);
        if (!point) return false;
        context.quadraticCurveTo(control.x, control.y, point.x, point.y);
        current = point;
        lastCubicControl = null;
        lastQuadraticControl = control;
        break;
      }
      case "z": {
        context.closePath();
        current = subpathStart;
        command = "";
        lastCubicControl = null;
        lastQuadraticControl = null;
        break;
      }
      default:
        return false;
    }
  }

  return true;
}

function parseClipPoint(
  value: string,
  width: number,
  height: number,
): Point | null {
  const [rawX, rawY] = splitCssTokens(value);
  const x = parseClipLength(rawX, width);
  const y = parseClipLength(rawY, height);
  return x == null || y == null ? null : { x, y };
}

function parseClipPointPairs(
  tokens: string[],
  width: number,
  height: number,
) {
  const points: Array<Point | null> = [];
  for (let index = 0; index < tokens.length; index += 2) {
    points.push(parseClipPoint(`${tokens[index]} ${tokens[index + 1]}`, width, height));
  }
  return points;
}

function parseClipPosition(
  value: string | null,
  width: number,
  height: number,
): Point | null {
  const tokens = splitCssTokens(value ?? "");
  if (tokens.length === 0) return { x: width / 2, y: height / 2 };
  if (tokens.length === 1) {
    const token = tokens[0].toLowerCase();
    if (token === "center") return { x: width / 2, y: height / 2 };
    if (token === "left" || token === "right") {
      return {
        x: parseClipPositionLength(token, width, "left", "right") ?? width / 2,
        y: height / 2,
      };
    }
    if (token === "top" || token === "bottom") {
      return {
        x: width / 2,
        y: parseClipPositionLength(token, height, "top", "bottom") ?? height / 2,
      };
    }
    const x = parseClipLength(token, width);
    return x == null ? null : { x, y: height / 2 };
  }

  const x = parseClipPositionLength(tokens[0], width, "left", "right");
  const y = parseClipPositionLength(tokens[1], height, "top", "bottom");
  return x == null || y == null ? null : { x, y };
}

function parseClipPositionLength(
  token: string | undefined,
  reference: number,
  startKeyword: string,
  endKeyword: string,
) {
  if (!token) return null;
  const normalized = token.toLowerCase();
  if (normalized === "center") return reference / 2;
  if (normalized === startKeyword) return 0;
  if (normalized === endKeyword) return reference;
  return parseClipLength(normalized, reference);
}

function parseClipLength(token: string | undefined, reference: number) {
  if (!token) return null;
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith("%")) {
    const value = Number.parseFloat(normalized.slice(0, -1));
    return Number.isFinite(value) ? (value / 100) * reference : null;
  }
  if (normalized.endsWith("px")) {
    const value = Number.parseFloat(normalized.slice(0, -2));
    return Number.isFinite(value) ? value : null;
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function splitCssAt(value: string): [string, string | null] {
  const parts = value.split(/\s+at\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? null];
}

function splitCssRound(value: string): [string, string | null] {
  const parts = value.split(/\s+round\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? null];
}

function splitCssTokens(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function readCssClipFunction(value: string) {
  const match = /([a-z-]+)\(/i.exec(value);
  if (!match || match.index == null) return null;

  const kind = match[1].toLowerCase();
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  let quote: string | null = null;

  for (let index = bodyStart; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\" && index + 1 < value.length) {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          kind,
          body: value.slice(bodyStart, index).trim(),
        };
      }
    }
  }

  return null;
}

function clipPathDataFromValue(value: string) {
  const clipFunction = readCssClipFunction(value);
  if (clipFunction?.kind === "path") {
    const data = extractCssPathData(clipFunction.body);
    return data && isSafeSvgClipPathData(data) ? data : null;
  }

  const data = extractCssPathData(value);
  return data && isSafeSvgClipPathData(data) ? data : null;
}

const FRAME_PATH_PREFIX = "frame-path(";

/** Frame clip values (`frame-path("M…")`) carry a normalized 100×100 path —
 *  unlike imported absolute path() clips, these are scaled onto the element
 *  at draw time so resizing a frame reshapes the clip with it. */
function framePathDataFromValue(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed.toLowerCase().startsWith(FRAME_PATH_PREFIX) ||
    !trimmed.endsWith(")")
  ) {
    return null;
  }
  const body = trimmed.slice(FRAME_PATH_PREFIX.length, -1).trim();
  const data = extractCssPathData(body);
  return data && isSafeSvgClipPathData(data) ? data : null;
}

function extractCssPathData(value: string) {
  const body = value.trim().replace(/^(evenodd|nonzero)\s*,\s*/i, "");
  const quoted = /^(['"])([\s\S]*)\1$/.exec(body);
  return quoted ? quoted[2].trim() : body;
}

function isSafeSvgClipPathData(value: string) {
  return (
    /[A-Za-z]/.test(value) &&
    /^[AaCcHhLlMmQqSsTtVvZz0-9eE\s.,+\-]*$/.test(value)
  );
}
