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
import { ShapePreview, shapeDataUri, type ShapeKind } from "@/components/editor-react/shape-icons";
import type { SlideElement } from "@/components/slide-editor/types";

export type ElementCategory =
  | "lines"
  | "basic"
  | "polygons"
  | "stars"
  | "arrows"
  | "flowchart";

export type ElementCatalogEntry = {
  key: string;
  label: string;
  category: ElementCategory;
  icon:
    | { kind: "lucide"; Icon: ComponentType<LucideProps> }
    | { kind: "shape"; shape: ShapeKind };
  build: () => SlideElement[];
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
  lines: "Lines",
  basic: "Basic shapes",
  polygons: "Polygons",
  stars: "Stars",
  arrows: "Arrows",
  flowchart: "Flowchart shapes",
};

export const ELEMENT_CATALOG: ElementCatalogEntry[] = [
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
];

export function elementCategoryOrder(): ElementCategory[] {
  return ["lines", "basic", "polygons", "stars", "arrows", "flowchart"];
}

export function renderCatalogIcon(entry: ElementCatalogEntry, size = 22) {
  if (entry.icon.kind === "shape") {
    return <ShapePreview kind={entry.icon.shape} size={size} />;
  }
  const Icon = entry.icon.Icon;
  return <Icon size={size} />;
}
