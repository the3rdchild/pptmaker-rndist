"use client";

import type { ComponentType } from "react";
import {
  Circle,
  Minus,
  Slash,
  Square,
  type LucideProps,
} from "lucide-react";
import { createElementInsertElements } from "@/components/slide-editor/insert/insert-elements";
import {
  SHAPE_INSERT_FILL,
  ShapePreview,
  shapeDataUri,
  type ShapeKind,
} from "@/components/editor-react/shape-icons";
import {
  IMAGE_FRAMES,
  buildFrameElement,
  FramePreview,
} from "@/components/editor-react/image-frames";
import { MOTIF_BUILDERS } from "@/components/editor-react/motif-library";
import type { TemplateV2InsertComponent } from "@/components/slide-editor/events/events";
import {
  EDITOR_STAGE_HEIGHT,
  EDITOR_STAGE_WIDTH,
  type SlideElement,
} from "@/components/slide-editor/types";

export type ElementCategory =
  | "frames"
  | "lines"
  | "basic"
  | "polygons"
  | "stars"
  | "arrows"
  | "flowchart"
  | "infographics";

/** dataTransfer MIME for dragging a catalog entry from the Elements tab onto
 *  the canvas. The payload is just the entry key; the drop side looks the
 *  entry up in ELEMENT_CATALOG and builds it at the drop point. */
export const ELEMENT_DRAG_MIME = "application/x-pptmaker-element";

/** Same idea for "My elements", which are uploads rather than catalog entries
 *  and so have no key to look up — the payload carries the item itself. */
export const CUSTOM_ELEMENT_DRAG_MIME = "application/x-pptmaker-custom-element";

/** Longest side of a drag preview, in CSS pixels. */
const DRAG_GHOST_SIZE = 88;

/** Drag preview for any Elements-tab card: the card's own artwork, enlarged and
 *  isolated.
 *
 *  Left alone the browser snapshots whatever element started the drag, so a
 *  card dragged its dark tile (and label) along and read as a grey box floating
 *  over the white canvas. Handing it the artwork node directly is not enough
 *  either — an `<img>` of a transparent PNG still came out on a dark rectangle,
 *  because the snapshot picks up the tile painted behind it. Only a copy with
 *  nothing behind it renders as just the artwork.
 *
 *  Three details this has to get right:
 *
 *  - The artwork is not always an `<svg>`. Uploads are `<img>`, and
 *    FramePreview draws frames whose outline is a CSS clip-path as a `<div>`
 *    with a background image. Sizing therefore goes through inline styles,
 *    which a div honours and which also outrank an svg's width/height
 *    attributes.
 *  - The copy is scaled by its longest side rather than forced square, so a
 *    landscape upload keeps its proportions.
 *  - It is mounted under the cursor, not off-screen: Chrome declines to
 *    snapshot an element outside the viewport and silently falls back to the
 *    default. Sitting where the drag image is about to appear, the single frame
 *    it exists for is invisible.
 *
 *  Cloning keeps the paint synchronous — inline SVG, an already-decoded
 *  background image and an already-decoded `<img>` all draw immediately, unlike
 *  a fresh element pointed at a URL the browser has yet to fetch. */
export function makeDragGhost(
  card: HTMLElement,
  clientX: number,
  clientY: number,
): { node: HTMLElement; offsetX: number; offsetY: number } | null {
  const artwork = card.querySelector(
    "img, svg, div[style*='background-image']",
  );
  if (!artwork) return null;
  const rect = artwork.getBoundingClientRect();
  const longest = Math.max(rect.width, rect.height);
  if (!(longest > 0)) return null;
  const scale = DRAG_GHOST_SIZE / longest;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));

  const clone = artwork.cloneNode(true) as HTMLElement;
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  // The card constrains its artwork with max-w/max-h; the clone is already
  // sized exactly, and those would only fight it.
  clone.style.maxWidth = "none";
  clone.style.maxHeight = "none";

  const host = document.createElement("div");
  host.style.cssText = [
    "position:fixed",
    `top:${clientY - height / 2}px`,
    `left:${clientX - width / 2}px`,
    `width:${width}px`,
    `height:${height}px`,
    // What `currentColor` inside a shape icon resolves against — the same fill
    // the shape is inserted with, so the preview matches what lands.
    `color:${SHAPE_INSERT_FILL}`,
    "pointer-events:none",
  ].join(";");
  host.appendChild(clone);
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 0);
  return { node: host, offsetX: width / 2, offsetY: height / 2 };
}

export type CustomElementDragPayload = {
  src: string;
  width: number;
  height: number;
};

export function readCustomElementDragPayload(
  raw: string,
): CustomElementDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CustomElementDragPayload>;
    if (typeof parsed?.src !== "string" || !parsed.src) return null;
    return {
      src: parsed.src,
      width: typeof parsed.width === "number" ? parsed.width : 200,
      height: typeof parsed.height === "number" ? parsed.height : 200,
    };
  } catch {
    return null;
  }
}

/** Scales a size down to fit a bound, keeping its ratio. */
function fitWithin(
  size: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = size.width / size.height || 1;
  let width = size.width;
  let height = size.height;
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / ratio);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ratio);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** The image element a "My elements" upload inserts as. Shared by the click
 *  path (Insert toolbar) and the drag path (canvas drop) so the two cannot
 *  drift — `decorative` keeps the generator from treating it as a fillable
 *  photo slot and swapping it out. Natural size comes from the manifest,
 *  recorded at upload time. The caller positions it; this centres it on the
 *  stage, which is what the click path wants. */
export function buildCustomElementImage(item: CustomElementDragPayload) {
  const size = fitWithin({ width: item.width, height: item.height }, 480, 360);
  return {
    type: "image",
    position: {
      x: Math.round((EDITOR_STAGE_WIDTH - size.width) / 2),
      y: Math.round((EDITOR_STAGE_HEIGHT - size.height) / 2),
    },
    size,
    data: item.src,
    fit: "contain",
    decorative: true,
  };
}

export type ElementCatalogEntry = {
  key: string;
  label: string;
  category: ElementCategory;
  icon:
    | { kind: "lucide"; Icon: ComponentType<LucideProps> }
    | { kind: "shape"; shape: ShapeKind }
    | { kind: "frame"; clippath: string | null };
  // Most entries insert loose elements (each becomes its own movable box).
  // Motifs return a single positioned component so their children move
  // together as one composed graphic while staying individually editable.
  build: () => SlideElement[] | TemplateV2InsertComponent;
};

const DEFAULT_SHAPE_POSITION = { x: 168, y: 176 };
const DEFAULT_SHAPE_SIZE = { width: 220, height: 220 };

function iconShapeElement(shape: ShapeKind): SlideElement {
  return {
    type: "image",
    position: { ...DEFAULT_SHAPE_POSITION },
    size: { ...DEFAULT_SHAPE_SIZE },
    data: shapeDataUri(shape),
    fit: "contain",
    name: shape,
  };
}

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  frames: "Image containers",
  lines: "Lines",
  basic: "Basic shapes",
  polygons: "Polygons",
  stars: "Stars",
  arrows: "Arrows",
  flowchart: "Flowchart shapes",
  infographics: "Infographics",
};

export const ELEMENT_CATALOG: ElementCatalogEntry[] = [
  // Image containers — cover-fit photos clipped to a shape (see
  // image-frames.tsx). Abstract clip-path shapes join this list in phase 2.
  ...IMAGE_FRAMES.map((frame) => ({
    key: `frame-${frame.key}`,
    label: frame.label,
    category: "frames" as const,
    icon: { kind: "frame" as const, clippath: frame.clippath },
    build: () => [buildFrameElement(frame)],
  })),
  {
    key: "line",
    label: "Line",
    category: "lines",
    icon: { kind: "lucide", Icon: Minus },
    build: () => createElementInsertElements("line"),
  },
  {
    key: "rectangle",
    label: "Rectangle",
    category: "basic",
    icon: { kind: "lucide", Icon: Square },
    build: () => createElementInsertElements("rectangle"),
  },
  {
    key: "rounded-rectangle",
    label: "Rounded rect",
    category: "basic",
    icon: { kind: "lucide", Icon: Square },
    build: () => createElementInsertElements("rounded-rectangle"),
  },
  {
    key: "square",
    label: "Square",
    category: "basic",
    icon: { kind: "lucide", Icon: Square },
    build: () => createElementInsertElements("square"),
  },
  {
    key: "circle",
    label: "Circle",
    category: "basic",
    icon: { kind: "lucide", Icon: Circle },
    build: () => createElementInsertElements("circle"),
  },
  {
    key: "ellipse",
    label: "Ellipse",
    category: "basic",
    icon: { kind: "lucide", Icon: Circle },
    build: () => createElementInsertElements("ellipse"),
  },
  {
    key: "triangle",
    label: "Triangle",
    category: "basic",
    icon: { kind: "shape", shape: "triangle" },
    build: () => [iconShapeElement("triangle")],
  },
  {
    key: "diamond",
    label: "Diamond",
    category: "polygons",
    icon: { kind: "shape", shape: "diamond" },
    build: () => [iconShapeElement("diamond")],
  },
  {
    key: "pentagon",
    label: "Pentagon",
    category: "polygons",
    icon: { kind: "shape", shape: "pentagon" },
    build: () => [iconShapeElement("pentagon")],
  },
  {
    key: "hexagon",
    label: "Hexagon",
    category: "polygons",
    icon: { kind: "shape", shape: "hexagon" },
    build: () => [iconShapeElement("hexagon")],
  },
  {
    key: "star",
    label: "Star",
    category: "stars",
    icon: { kind: "shape", shape: "star" },
    build: () => [iconShapeElement("star")],
  },
  {
    key: "arrow-right",
    label: "Right",
    category: "arrows",
    icon: { kind: "shape", shape: "arrow-right" },
    build: () => [iconShapeElement("arrow-right")],
  },
  {
    key: "arrow-left",
    label: "Left",
    category: "arrows",
    icon: { kind: "shape", shape: "arrow-left" },
    build: () => [iconShapeElement("arrow-left")],
  },
  {
    key: "arrow-up",
    label: "Up",
    category: "arrows",
    icon: { kind: "shape", shape: "arrow-up" },
    build: () => [iconShapeElement("arrow-up")],
  },
  {
    key: "arrow-down",
    label: "Down",
    category: "arrows",
    icon: { kind: "shape", shape: "arrow-down" },
    build: () => [iconShapeElement("arrow-down")],
  },
  {
    key: "flow-process",
    label: "Process",
    category: "flowchart",
    icon: { kind: "lucide", Icon: Square },
    build: () => createElementInsertElements("rectangle"),
  },
  {
    key: "flow-decision",
    label: "Decision",
    category: "flowchart",
    icon: { kind: "shape", shape: "diamond" },
    build: () => [iconShapeElement("diamond")],
  },
  {
    key: "flow-terminal",
    label: "Terminal",
    category: "flowchart",
    icon: { kind: "lucide", Icon: Slash },
    build: () => createElementInsertElements("pill"),
  },
  {
    key: "motif-radial-gauge",
    label: "Radial gauge",
    category: "infographics",
    icon: { kind: "shape", shape: "hexagon" },
    build: () => MOTIF_BUILDERS["radial-gauge"](),
  },
  {
    key: "motif-leader-callout",
    label: "Leader callout",
    category: "infographics",
    icon: { kind: "lucide", Icon: Minus },
    build: () => MOTIF_BUILDERS["leader-callout"](),
  },
  {
    key: "motif-bracket-frame",
    label: "Bracket frame",
    category: "infographics",
    icon: { kind: "lucide", Icon: Square },
    build: () => MOTIF_BUILDERS["bracket-frame"](),
  },
  {
    key: "motif-big-stat",
    label: "Big stat",
    category: "infographics",
    icon: { kind: "lucide", Icon: Circle },
    build: () => MOTIF_BUILDERS["big-stat"](),
  },
];

export function elementCategoryOrder(): ElementCategory[] {
  return ["frames", "infographics", "lines", "basic", "polygons", "stars", "arrows", "flowchart"];
}

export function renderCatalogIcon(entry: ElementCatalogEntry, size = 22) {
  if (entry.icon.kind === "shape") {
    return <ShapePreview kind={entry.icon.shape} size={size} />;
  }
  if (entry.icon.kind === "frame") {
    return <FramePreview clippath={entry.icon.clippath} size={size} />;
  }
  const Icon = entry.icon.Icon;
  return <Icon size={size} />;
}
