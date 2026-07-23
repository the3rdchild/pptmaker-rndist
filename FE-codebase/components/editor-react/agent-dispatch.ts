// Pure transformation functions that apply agent actions to slide `ui`
// objects. Every function here is deterministic and reuses the SAME
// mutation primitives the manual toolbars already use (mergeFont from
// model/element-model.ts) — the agent only supplies WHAT to change, this
// module (and the manual toolbar code it's copied from) decides HOW.
//
// Known limitation: the Template V2 "ui" layout has no first-class deck-wide
// "theme" concept — set_theme below is a best-effort approximation (background
// + font color only), not a full theme system.

import { mergeFont } from "@/components/slide-editor/model/element-model";
import type { SlideData } from "@/store/presentationGeneration";
import { EDITOR_STAGE_WIDTH, EDITOR_STAGE_HEIGHT } from "@/components/slide-editor/types";
import { appendInsertedContent } from "@/components/slide-editor/model/inserted-content";
import {
  createCustomFormulaInsertElements,
  createElementInsertElements,
  createIconInsertElement,
  createAiTextInsertElements,
  createAiChartInsertElements,
  createAiTableInsertElements,
  createImageInsertContent,
  chartTypeFromPaletteId,
} from "@/components/slide-editor/insert/insert-elements";
import { applyBackgroundStyle } from "@/components/editor-react/background-panel";
import type { BackgroundStyle } from "@/components/slide-editor/surface/SlideBackground";
import { PresentationGenerationApi } from "@/app/(presentation-generator)/services/api/presentation-generation";
import type { RawUi } from "@/components/slide-editor/model/core";
import { setComponentPositionsInUi, componentBox } from "@/components/slide-editor/model/model";

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Recursively visits every element in a component tree (container.child is
// singular, flex/grid/group.children is an array) — matches the exact
// recursion shape described in components/slide-editor/types.ts.
function walkElements(elements: unknown[], visit: (el: AnyRecord) => AnyRecord): AnyRecord[] {
  return elements.filter(isRecord).map((raw) => {
    let next = visit(raw);
    if (Array.isArray(next.children)) {
      next = { ...next, children: walkElements(next.children, visit) };
    }
    if (isRecord(next.child)) {
      next = { ...next, child: walkElements([next.child], visit)[0] };
    }
    return next;
  });
}

function walkUi(ui: AnyRecord, visit: (el: AnyRecord) => AnyRecord): AnyRecord {
  const components = Array.isArray(ui.components) ? ui.components : [];
  return {
    ...ui,
    components: components.filter(isRecord).map((c) => ({
      ...c,
      elements: walkElements(Array.isArray(c.elements) ? c.elements : [], visit),
    })),
  };
}

// Finds the first element (depth-first) matching a predicate, across every
// component in a ui object. Returns the element plus enough breadcrumbs to
// know it was found — callers only need the element itself here.
function findElement(ui: AnyRecord, predicate: (el: AnyRecord) => boolean): AnyRecord | null {
  const components = Array.isArray(ui.components) ? ui.components : [];
  const searchList = (elements: unknown[]): AnyRecord | null => {
    for (const raw of elements) {
      if (!isRecord(raw)) continue;
      if (predicate(raw)) return raw;
      if (Array.isArray(raw.children)) {
        const found = searchList(raw.children);
        if (found) return found;
      }
      if (isRecord(raw.child)) {
        const found = searchList([raw.child]);
        if (found) return found;
      }
    }
    return null;
  };
  for (const c of components) {
    if (!isRecord(c) || !Array.isArray(c.elements)) continue;
    const found = searchList(c.elements);
    if (found) return found;
  }
  return null;
}

function elementArea(el: AnyRecord): number {
  const size = isRecord(el.size) ? el.size : null;
  const w = typeof size?.width === "number" ? size.width : 0;
  const h = typeof size?.height === "number" ? size.height : 0;
  return w * h;
}

// ── set_font ──

export function applyFontToAllSlides(slides: SlideData[], fontFamily: string): SlideData[] {
  return slides.map((slide) => {
    if (!isRecord(slide.ui)) return slide;
    const newUi = walkUi(slide.ui, (el) => {
      if (el.type === "text" || el.type === "text-list") {
        return mergeFont(el as never, { family: fontFamily }) as AnyRecord;
      }
      return el;
    });
    return { ...slide, ui: newUi };
  });
}

// ── set_theme (best-effort: background fill + text color only) ──

export function applyThemeToAllSlides(
  slides: SlideData[],
  opts: { background?: string; fontColor?: string },
): SlideData[] {
  return slides.map((slide) => {
    if (!isRecord(slide.ui)) return slide;
    let newUi = walkUi(slide.ui, (el) => {
      let next = el;
      if (opts.fontColor && (el.type === "text" || el.type === "text-list")) {
        next = mergeFont(next as never, { color: opts.fontColor }) as AnyRecord;
      }
      // Full-slide background rectangle heuristic: a rectangle whose size
      // matches the stage dimensions (within a small tolerance).
      if (opts.background && el.type === "rectangle" && isRecord(el.size)) {
        const w = el.size.width as number;
        const h = el.size.height as number;
        const isFullStage =
          Math.abs(w - EDITOR_STAGE_WIDTH) < 4 && Math.abs(h - EDITOR_STAGE_HEIGHT) < 4;
        if (isFullStage) {
          next = { ...next, fill: { ...(isRecord(next.fill) ? next.fill : {}), color: opts.background } };
        }
      }
      return next;
    });
    return { ...slide, ui: newUi };
  });
}

// ── add_slide (clone a real template layout, replace its text content —
// never hand-author a layout from scratch) ──

let cachedGeneralLayout: AnyRecord | null = null;

async function loadContentLayout(): Promise<AnyRecord> {
  if (cachedGeneralLayout) return structuredClone(cachedGeneralLayout);
  const res = await fetch("/templates/general/template.json");
  const template = await res.json();
  const layouts = (template.layouts ?? []) as AnyRecord[];
  // split_content_layout: headline + body copy, the simplest content-only shape.
  const layout = layouts.find((l) => typeof l.id === "string" && l.id.startsWith("split_content_layout")) ?? layouts[0];
  cachedGeneralLayout = layout;
  return structuredClone(layout);
}

function setRunsText(el: AnyRecord, text: string): AnyRecord {
  const baseFont = Array.isArray(el.runs) && isRecord(el.runs[0]) ? (el.runs[0] as AnyRecord).font : el.font;
  return { ...el, runs: [{ text, font: baseFont }] };
}

export async function buildAddSlideUi(
  title: string,
  items: { title: string; text: string }[],
): Promise<AnyRecord> {
  const ui = await loadContentLayout();
  const bodyText = items.map((i) => (i.title ? `${i.title}: ${i.text}` : i.text)).join("\n");

  return walkUi(ui, (el) => {
    if (el.type !== "text") return el;
    if (el.name === "headline_text") return setRunsText(el, title);
    if (el.name === "body_copy") return setRunsText(el, bodyText);
    return el;
  });
}

// ── update_text (find title/content element by name, fall back to
// position-based heuristics if no name match) ──

export function updateSlideText(
  ui: AnyRecord,
  target: "title" | "content",
  newText: string,
): AnyRecord | null {
  const nameHints = target === "title" ? ["headline", "title"] : ["body", "content", "description"];
  const byName = findElement(
    ui,
    (el) =>
      el.type === "text" &&
      typeof el.name === "string" &&
      nameHints.some((hint) => (el.name as string).toLowerCase().includes(hint)),
  );
  if (byName) {
    return walkUi(ui, (el) => (el === byName ? setRunsText(el, newText) : el));
  }

  // Fallback: title = largest-font text element, content = largest-area
  // text element that isn't the title target.
  const components = Array.isArray(ui.components) ? ui.components : [];
  const candidates: AnyRecord[] = [];
  const collect = (elements: unknown[]) => {
    for (const raw of elements) {
      if (!isRecord(raw)) continue;
      if (raw.type === "text") candidates.push(raw);
      if (Array.isArray(raw.children)) collect(raw.children);
      if (isRecord(raw.child)) collect([raw.child]);
    }
  };
  for (const c of components) {
    if (isRecord(c) && Array.isArray(c.elements)) collect(c.elements);
  }
  if (candidates.length === 0) return null;

  function runFontSize(el: AnyRecord): number {
    // Font size lives on runs[0].font.size (Presenton layout) or el.font.size
    if (isRecord(el.font) && typeof el.font.size === "number") return el.font.size;
    const runs = Array.isArray(el.runs) ? el.runs : [];
    const first = runs.find(isRecord);
    if (first && isRecord(first.font) && typeof first.font.size === "number") {
      return first.font.size;
    }
    return 0;
  }

  const target_el =
    target === "title"
      ? candidates.reduce((a, b) => (runFontSize(a) >= runFontSize(b) ? a : b))
      : candidates.reduce((a, b) => (elementArea(a) >= elementArea(b) ? a : b));

  return walkUi(ui, (el) => (el === target_el ? setRunsText(el, newText) : el));
}

// ── insert_formula / insert_shape / insert_icon (all reuse the exact same
// factories + merge helper the manual "Insert" panel uses — the agent just
// supplies the args a human would've picked from that panel) ──

export function insertFormulaIntoSlide(ui: AnyRecord, latex: string): AnyRecord | null {
  const elements = createCustomFormulaInsertElements(latex);
  if (!elements.length) return null;
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

export function insertShapeIntoSlide(ui: AnyRecord, kind: string): AnyRecord | null {
  const elements = createElementInsertElements(kind);
  if (!elements.length) return null;
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

export async function insertIconIntoSlide(
  ui: AnyRecord,
  query: string,
): Promise<AnyRecord | null> {
  const matches = await PresentationGenerationApi.searchIcons({ query, limit: 1 });
  const iconUrl = matches[0];
  if (!iconUrl) return null;
  const elements = [createIconInsertElement(iconUrl)];
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

// ── set_background ──

export function setSlideBackground(ui: AnyRecord, style: BackgroundStyle): AnyRecord {
  return applyBackgroundStyle(ui as RawUi, style) as AnyRecord;
}

// ── insert_text / insert_chart / insert_table (real AI-supplied content,
// unlike the manual Insert panel's canned presets) ──

export function insertTextIntoSlide(
  ui: AnyRecord,
  text: string,
  style?: string,
): AnyRecord | null {
  const validStyle =
    style === "title" || style === "subtitle" || style === "quote" || style === "body"
      ? style
      : undefined;
  const elements = createAiTextInsertElements(text, validStyle);
  if (!elements.length) return null;
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

export function insertChartIntoSlide(
  ui: AnyRecord,
  chartTypeRaw: string,
  title: string,
  categories: string[],
  series: { name: string; values: number[] }[],
): AnyRecord | null {
  const chartType = chartTypeFromPaletteId(chartTypeRaw);
  if (!chartType) return null;
  const elements = createAiChartInsertElements(chartType, title, categories, series);
  if (!elements.length) return null;
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

export function insertTableIntoSlide(
  ui: AnyRecord,
  headers: string[],
  rows: string[][],
): AnyRecord | null {
  const elements = createAiTableInsertElements(headers, rows);
  if (!elements.length) return null;
  return appendInsertedContent(ui as RawUi, elements as AnyRecord[], []) as AnyRecord;
}

// ── insert_image (Magic Media): insert a placeholder immediately, then
// patch its `data` once the async DeepInfra generation call resolves —
// mirrors the exact heroImage placeholder-then-patch pattern regenerate_slide
// already uses in editor-react-client.tsx. ──

export function insertImagePlaceholderIntoSlide(
  ui: AnyRecord,
  label: string,
): { ui: AnyRecord; componentId: string } {
  const elements = createImageInsertContent("image").elements ?? [];
  if (!elements.length) return { ui, componentId: "" };
  const newUi = appendInsertedContent(ui as RawUi, elements as AnyRecord[], [], label) as AnyRecord;
  const components = Array.isArray(newUi.components) ? (newUi.components as AnyRecord[]) : [];
  const last = components[components.length - 1];
  return { ui: newUi, componentId: String((last as AnyRecord | undefined)?.id ?? "") };
}

export function patchInsertedImage(
  ui: AnyRecord,
  componentId: string,
  dataUrl: string,
): AnyRecord {
  const components = Array.isArray(ui.components) ? (ui.components as AnyRecord[]) : [];
  const nextComponents = components.map((component) => {
    if (component.id !== componentId) return component;
    const elements = Array.isArray(component.elements) ? (component.elements as AnyRecord[]) : [];
    return {
      ...component,
      elements: elements.map((el) => (el.type === "image" ? { ...el, data: dataUrl } : el)),
    };
  });
  return { ...ui, components: nextComponents };
}

// ── move_element: reposition an existing component on the slide. Dragging on
// canvas always writes to the wrapping COMPONENT's position/size (confirmed
// via TemplateV2KonvaSlide.tsx's handleComponentDragEnd), never the inner
// element's own position — so this mutates the same field a manual drag
// would, via the same setComponentPositionsInUi helper. `element_index` is a
// flat 0-based index matching ai-assistant-panel.tsx's buildDeckSummary(),
// which walks `components -> component.elements` with no recursion — this
// resolves that same flat index back to which component it falls in. ──

const ANCHOR_POSITIONS = [
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
export type AnchorPosition = (typeof ANCHOR_POSITIONS)[number];

const ANCHOR_MARGIN = 24;

function anchorToXY(anchor: string, size: { width: number; height: number }): { x: number; y: number } | null {
  if (!ANCHOR_POSITIONS.includes(anchor as AnchorPosition)) return null;
  const [vertical, horizontal] = anchor === "center" ? ["middle", "center"] : anchor.split("-");
  const x =
    horizontal === "left" ? ANCHOR_MARGIN
    : horizontal === "right" ? EDITOR_STAGE_WIDTH - size.width - ANCHOR_MARGIN
    : (EDITOR_STAGE_WIDTH - size.width) / 2;
  const y =
    vertical === "top" ? ANCHOR_MARGIN
    : vertical === "bottom" ? EDITOR_STAGE_HEIGHT - size.height - ANCHOR_MARGIN
    : (EDITOR_STAGE_HEIGHT - size.height) / 2;
  return { x, y };
}

function resolveComponentIndexForFlatElementIndex(ui: AnyRecord, flatIndex: number): number | null {
  const components = Array.isArray(ui.components) ? (ui.components as AnyRecord[]) : [];
  let counter = 0;
  for (let i = 0; i < components.length; i += 1) {
    const elements = Array.isArray(components[i].elements) ? (components[i].elements as AnyRecord[]) : [];
    for (let j = 0; j < elements.length; j += 1) {
      if (counter === flatIndex) return i;
      counter += 1;
    }
  }
  return null;
}

export function moveElementInSlide(
  ui: AnyRecord,
  flatElementIndex: number,
  target: { anchor?: string; x?: number; y?: number },
): AnyRecord | null {
  const componentIndex = resolveComponentIndexForFlatElementIndex(ui, flatElementIndex);
  if (componentIndex === null) return null;

  const components = Array.isArray(ui.components) ? (ui.components as AnyRecord[]) : [];
  const box = componentBox(components[componentIndex] as never);

  const position = target.anchor
    ? anchorToXY(target.anchor, box)
    : typeof target.x === "number" && typeof target.y === "number"
      ? { x: target.x, y: target.y }
      : null;
  if (!position) return null;

  return setComponentPositionsInUi(ui as RawUi, [{ componentIndex, position }]) as AnyRecord;
}
