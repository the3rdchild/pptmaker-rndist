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

  const target_el =
    target === "title"
      ? candidates.reduce((a, b) => (((isRecord(a.font) ? a.font.size : 0) as number) >= ((isRecord(b.font) ? b.font.size : 0) as number) ? a : b))
      : candidates.reduce((a, b) => (elementArea(a) >= elementArea(b) ? a : b));

  return walkUi(ui, (el) => (el === target_el ? setRunsText(el, newText) : el));
}
