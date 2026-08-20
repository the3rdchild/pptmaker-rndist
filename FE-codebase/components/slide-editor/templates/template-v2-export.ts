// Serializes an edited slide back into a Template V2 layout.
//
// This is deliberately NOT the inverse of template-v2-import.ts. That module
// is the *render* path: it turns raw layout JSON into the typed Slide the
// Konva surface draws. The editor itself stores `slide.ui` as the layout
// object verbatim (see editor-react-client's `{ ui: layout }`) and every
// toolbar mutation rewrites that same shape. So exporting is a matter of
// cleaning and annotating the ui record, not rebuilding it.

import { toStoredTemplateAssetUrl } from "@/utils/api";
import { LAYOUT_THEME_KEY } from "@/lib/templates/themes";
import {
  parseLayoutMeta,
  parseSlotMeta,
  type LayoutMeta,
} from "@/components/slide-editor/templates/slot-meta";
import type { SlideTransition } from "@/store/presentationGeneration";
import {
  isBackgroundComponent,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type RawComponent,
} from "@/components/slide-editor/model/model";

type Rec = Record<string, unknown>;

/** Element keys the import path synthesizes; re-emitting them would bake
 *  render-time bookkeeping into the saved template. */
const IMPORT_GENERATED_KEYS = new Set([
  "component_id",
  "component_instance_id",
  "component_description",
]);

/** Geometry is stored at 2dp — enough to survive a scale round trip without
 *  spraying float noise through the diff. */
const DECIMALS = 2;

export type ExportedLayout = Rec & {
  id: string;
  name?: string;
  description: string;
  meta?: LayoutMeta;
  /** Entrance transition picked in the Transition tab; top-level (not in
   *  `meta`) so it survives the schemaless layout JSON untouched and can be
   *  lifted back onto the slide when the layout is applied to a deck. */
  transition?: SlideTransition;
  components: Rec[];
};

export type ExportWarning = {
  level: "error" | "warning";
  message: string;
  /** Element name/slot the warning is about, when it maps to one. */
  target?: string;
};

export type ExportResult = {
  layout: ExportedLayout;
  warnings: ExportWarning[];
};

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** DECIMALS;
  return Math.round(value * factor) / factor;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Stable-ish layout id: a readable slug plus a short suffix, matching the
 *  `split_cover_layout_7212` convention the shipped packs already use. */
export function makeLayoutId(name: string, existingIds: string[] = []): string {
  const base = slugify(name) || "layout";
  let suffix = Math.abs(hash(base + existingIds.length)) % 10000;
  let candidate = `${base}_${String(suffix).padStart(4, "0")}`;
  const taken = new Set(existingIds);
  while (taken.has(candidate)) {
    suffix = (suffix + 1) % 10000;
    candidate = `${base}_${String(suffix).padStart(4, "0")}`;
  }
  return candidate;
}

function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i);
  return h | 0;
}

/** Recursively cleans one element: drops nulls and import bookkeeping, rounds
 *  geometry, and rewrites asset URLs into their stored pack-absolute form. */
function cleanElement(value: unknown, theme: string, warnings: ExportWarning[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cleanElement(item, theme, warnings));
  }
  if (typeof value === "number") return roundNumber(value);
  if (!isRecord(value)) return value;

  const out: Rec = {};
  const elementName =
    typeof value.name === "string" ? value.name : undefined;

  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;
    if (IMPORT_GENERATED_KEYS.has(key)) continue;
    if (key === LAYOUT_THEME_KEY) continue;

    if (key === "slot") {
      const slot = parseSlotMeta(raw);
      if (slot) out.slot = slot;
      continue;
    }

    // `component_slot` is derived from `name` on import — only keep it when it
    // actually carries information the name doesn't.
    if (key === "component_slot" && raw === elementName) continue;

    if (
      (key === "data" || key === "src" || key === "poster") &&
      typeof raw === "string"
    ) {
      if (raw.startsWith("data:")) {
        warnings.push({
          level: "warning",
          target: elementName,
          message:
            "Embedded (data:) asset — it will be inlined into the template JSON. Move the file into the theme's static/ folder to keep the template small.",
        });
        out[key] = raw;
      } else {
        out[key] = toStoredTemplateAssetUrl(raw, theme);
      }
      continue;
    }

    const cleaned = cleanElement(raw, theme, warnings);
    // Insert paths leave behind empty stubs like `font: {}` on shapes and
    // images. They mean nothing to the renderer and only add noise to the
    // saved template, so drop them rather than committing them.
    if (isRecord(cleaned) && Object.keys(cleaned).length === 0) continue;
    out[key] = cleaned;
  }

  return out;
}

/** Turns one top-level ui element into a Template V2 component. Groups carrying
 *  a component_id came from a component originally and are unwrapped back into
 *  one; anything else (a shape drawn straight onto the canvas) is wrapped in a
 *  component of its own so the output shape stays uniform. */
function elementToComponent(
  element: Rec,
  index: number,
  theme: string,
  warnings: ExportWarning[],
): Rec | null {
  const position = isRecord(element.position) ? element.position : null;
  const size = isRecord(element.size) ? element.size : null;

  const frame = {
    position: {
      x: roundNumber(Number(position?.x ?? 0)),
      y: roundNumber(Number(position?.y ?? 0)),
    },
    size: {
      width: roundNumber(Number(size?.width ?? 0)),
      height: roundNumber(Number(size?.height ?? 0)),
    },
  };

  const componentId =
    (typeof element.component_id === "string" && element.component_id) ||
    (typeof element.name === "string" && element.name) ||
    `component_${index}`;
  const description =
    (typeof element.component_description === "string" &&
      element.component_description) ||
    "";

  if (element.type === "group" && Array.isArray(element.children)) {
    const elements = element.children
      .map((child) => cleanElement(child, theme, warnings))
      .filter((child): child is Rec => isRecord(child));
    if (elements.length === 0) return null;
    return {
      id: componentId,
      description,
      ...frame,
      elements,
      ...(Array.isArray(element.design_variables) && element.design_variables.length
        ? { design_variables: element.design_variables }
        : {}),
    };
  }

  // Standalone element: the component frame is the element's own box, so the
  // element inside it sits at the origin (components hold local coordinates).
  const cleaned = cleanElement(
    { ...element, position: { x: 0, y: 0 } },
    theme,
    warnings,
  );
  if (!isRecord(cleaned)) return null;
  return { id: componentId, description, ...frame, elements: [cleaned] };
}

export function extractUiElements(ui: Rec): Rec[] {
  if (Array.isArray(ui.elements) && ui.elements.length > 0) {
    return ui.elements.filter(isRecord);
  }
  if (Array.isArray(ui.components)) {
    // Already component-shaped (an untouched template) — pass it through as-is
    // rather than round-tripping it through the group representation.
    return [];
  }
  return [];
}

const DEFAULT_BACKGROUND_COLOR = "#FFFFFF";

/** A full-bleed white rectangle, decorative and named "background" —
 *  matching exactly what the .pptx importer already synthesizes for a slide
 *  with no explicit background fill (see slideBackground/backgroundRect in
 *  pptx-import.ts), so every code path that produces a background element
 *  agrees on its shape. */
export function defaultBackgroundComponent(): Rec {
  return {
    id: "background",
    position: { x: 0, y: 0 },
    size: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
    elements: [
      {
        type: "rectangle",
        name: "background",
        decorative: true,
        position: { x: 0, y: 0 },
        size: { width: STAGE_WIDTH, height: STAGE_HEIGHT },
        fill: { type: "solid", color: DEFAULT_BACKGROUND_COLOR, opacity: 1 },
      },
    ],
  };
}

/** Every saved layout gets a background component, whether the author added
 *  one or not — a page with no background renders on bare white, which
 *  reads as visibly broken the moment the theme uses a dark canvas. Reuses
 *  isBackgroundComponent's geometric definition (full-bleed, no text/table/
 *  chart content) so this recognizes a background regardless of whether the
 *  author named it "background", used a rectangle vs an image, etc. —
 *  matching what the general editor's own Background panel already treats
 *  as "the" background. Inserted first (painted behind everything else)
 *  only when nothing already qualifies. */
export function ensureBackgroundComponent(components: Rec[]): Rec[] {
  const hasBackground = components.some((component) =>
    isBackgroundComponent(component as RawComponent),
  );
  return hasBackground ? components : [defaultBackgroundComponent(), ...components];
}

export function exportSlideAsLayout(
  ui: Rec,
  options: {
    theme: string;
    id?: string;
    name: string;
    description: string;
    meta?: LayoutMeta | null;
    /** Slide-level entrance transition; a sibling of `ui` on SlideData, so it
     *  never reaches this function inside the ui record itself. */
    transition?: SlideTransition;
    existingIds?: string[];
  },
): ExportResult {
  const warnings: ExportWarning[] = [];
  const theme = options.theme;

  let components: Rec[];
  if (Array.isArray(ui.components) && ui.components.length > 0) {
    components = ui.components
      .filter(isRecord)
      .map((component) => {
        const cleaned = cleanElement(component, theme, warnings);
        return isRecord(cleaned) ? cleaned : null;
      })
      .filter((component): component is Rec => Boolean(component));
  } else {
    components = extractUiElements(ui)
      .map((element, index) =>
        elementToComponent(element, index, theme, warnings),
      )
      .filter((component): component is Rec => Boolean(component));
  }

  if (components.length === 0) {
    warnings.push({
      level: "error",
      message: "The slide has no exportable content.",
    });
  }

  // After the emptiness check, not before — a page with only a background
  // still has no real content, and should still warn about that.
  components = ensureBackgroundComponent(components);

  const meta = parseLayoutMeta(options.meta ?? null);
  if (!meta?.slide_role) {
    warnings.push({
      level: "warning",
      message:
        "No slide role set — the generator picks layouts by role, so an unlabelled layout will rarely be chosen.",
    });
  }

  warnings.push(...auditSlots(components));

  const layout: ExportedLayout = {
    id: options.id ?? makeLayoutId(options.name, options.existingIds ?? []),
    // The display name is persisted too — auto-label authors it and the
    // manifest surfaces it to the generator next to the id.
    ...(options.name.trim() ? { name: options.name.trim() } : {}),
    description: options.description.trim(),
    ...(meta ? { meta } : {}),
    // "none" is the default — writing it would just be noise in the JSON.
    ...(options.transition && options.transition !== "none"
      ? { transition: options.transition }
      : {}),
    components,
  };

  return { layout, warnings };
}

/** Flags text slots the generator will have to guess at. */
function auditSlots(components: Rec[]): ExportWarning[] {
  const warnings: ExportWarning[] = [];
  let unlabelled = 0;
  let unnamed = 0;

  walkElements(components, (element) => {
    const type = element.type;
    if (type !== "text" && type !== "text-list") return;
    if (element.decorative === true) return;

    const name = typeof element.name === "string" ? element.name : null;
    if (!name) unnamed += 1;
    if (!isRecord(element.slot) || !element.slot.role) unlabelled += 1;
  });

  if (unnamed > 0) {
    warnings.push({
      level: "warning",
      message: `${unnamed} text slot${unnamed === 1 ? " has" : "s have"} no name — the generator addresses slots by name.`,
    });
  }
  if (unlabelled > 0) {
    warnings.push({
      level: "warning",
      message: `${unlabelled} text slot${unlabelled === 1 ? " has" : "s have"} no role — that slot will be filled with generic prose.`,
    });
  }
  return warnings;
}

/** Depth-first walk over every element inside a component list. */
export function walkElements(
  components: Rec[],
  visit: (element: Rec) => void,
): void {
  const visitElement = (element: unknown) => {
    if (Array.isArray(element)) {
      element.forEach(visitElement);
      return;
    }
    if (!isRecord(element)) return;
    if (typeof element.type === "string") visit(element);
    if (Array.isArray(element.children)) element.children.forEach(visitElement);
    if (isRecord(element.child)) visitElement(element.child);
    if (Array.isArray(element.elements)) element.elements.forEach(visitElement);
  };

  components.forEach((component) => {
    if (Array.isArray(component.elements)) {
      component.elements.forEach(visitElement);
    }
  });
}
