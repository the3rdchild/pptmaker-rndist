// Shared types threaded through the .pptx importer's shape builders: the
// per-shape/per-part/per-deck parsing context, plus the small geometry
// records (Box, NodeTransform) every shape builder resolves into. Split out
// of pptx-import.ts because every shape-building concern (geometry, shape
// frame, color, text runs, tables, image fills, font resolution) needs these
// same types, and none of them should import the orchestrator back.

import type JSZip from "jszip";

export type Rec = Record<string, unknown>;

export type GeoContext = { scale: number; offsetPxX: number; offsetPxY: number };

/** A resolved relationship: both maps are keyed for the two lookups the
 * importer needs — by r:id (images, layouts) and by relationship type
 * (walking slide -> layout -> master -> theme). Targets are already resolved
 * to absolute zip paths. */
export type Rels = { byId: Map<string, string>; byType: Map<string, string[]> };

export const EMPTY_RELS: Rels = { byId: new Map(), byType: new Map() };

/** Theme + master colour mapping, needed to resolve `a:schemeClr` references.
 * Decks authored in PowerPoint express nearly every colour that way, so
 * without this every such shape falls back to a placeholder grey. */
export type ThemeContext = {
  colors: Map<string, string>;
  clrMap: Record<string, string>;
  majorFont: string | null;
  minorFont: string | null;
};

/** Everything a slide needs that is shared across the whole deck. */
export type DeckContext = {
  zip: JSZip;
  geo: GeoContext;
  themeCache: Map<string, ThemeContext>;
  mediaCache: Map<string, string | null>;
  /** Layouts and masters, which every slide using them re-reads otherwise. */
  partCache: Map<string, { doc: Rec; rels: Rels; order: Map<string, number> } | null>;
};

/** Per-part context: the rels of the XML part a shape came from (a slide, or
 * a layout/master when inheriting a background) plus the resolved theme. */
export type PartContext = {
  deck: DeckContext;
  rels: Rels;
  theme: ThemeContext | null;
  /** Shape id -> position in the slide XML, see `shapeOrderIndex`. */
  order: Map<string, number>;
};

export type Box = { x: number; y: number; width: number; height: number };

/** `directChild` marks an element produced by a shape that hangs straight off
 * a top-level `p:grpSp` (as opposed to one nested inside a further group) —
 * used only to pick the anchor angle in `normalizeGroupImageRotation`. */
export type BuiltElement = { el: Rec; box: Box; directChild?: boolean };

/** A node's own transform composed with whatever group transform it's
 * nested inside (identity at the top level). Lets group children resolve to
 * final canvas coordinates without a separate recursive coordinate system. */
export type NodeTransform = { offX: number; offY: number; scaleX: number; scaleY: number };

export const IDENTITY_TRANSFORM: NodeTransform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };
