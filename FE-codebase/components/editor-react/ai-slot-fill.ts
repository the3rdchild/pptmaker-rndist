// Manifest-driven slide fill — the "phase 3" contract.
//
// Unlike the legacy AIPPTSlide path (ai-layout-fill.ts's fillLayout, where the
// model outputs a fixed 5-type union and the client GUESSES which slot gets
// what), here the model sees the theme's layout manifest — every slot with
// its authored role/hint/fill_condition/max_words/max_lines — and answers
// with exactly which slot gets which text. The client then only:
//   1. writes each fill into the named element (in document order, so a name
//      that occurs N times gets its N fills in order),
//   2. ENFORCES the authored budgets itself (the model is asked nicely, the
//      client guarantees it),
//   3. prunes conditional slots the model legitimately left out, and
//   4. backstops "always" slots the model forgot.
// Colors, positions, decorative elements, and fonts are never touched —
// the slide stays exactly as the template author designed it.

import {
  findAllPhotoSlots,
  findHeroImage,
  findSecondaryImages,
  fillPlaceholderIcons,
  pruneEmptyContainers,
  setText,
  type FilledSlide,
} from "@/components/editor-react/ai-layout-fill";
import {
  parseSlotMeta,
  type SlotMeta,
} from "@/components/slide-editor/templates/slot-meta";

type Rec = Record<string, unknown>;

interface TemplateLayout {
  id: string;
  description?: string;
  meta?: Rec;
  components: Rec[];
}

/** One fill entry from the model: which named slot, what text. */
export interface SlotFill {
  name: string;
  text: string;
}

/** The new JSONL contract — one line per slide:
 *  {"type":"slide","layout_id":"...","fills":[{"name":"...","text":"..."}, ...]} */
export interface ManifestSlideLine {
  type: "slide";
  layout_id: string;
  fills: SlotFill[];
}

/** Parses one streamed line into a ManifestSlideLine, or null when the line
 *  isn't the new contract (legacy AIPPTSlide / theme / error lines included). */
export function parseManifestSlideLine(line: string): ManifestSlideLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Rec;
  if (rec.type !== "slide") return null;
  if (typeof rec.layout_id !== "string" || !rec.layout_id) return null;
  const rawFills = Array.isArray(rec.fills) ? rec.fills : [];
  const fills: SlotFill[] = [];
  for (const f of rawFills) {
    if (!f || typeof f !== "object") continue;
    const { name, text } = f as Rec;
    if (typeof name === "string" && name && typeof text === "string") {
      fills.push({ name, text });
    }
  }
  return { type: "slide", layout_id: rec.layout_id, fills };
}

/* ------------------------- Constraint enforcement ------------------------- */

/** Truncates at a word boundary when `text` exceeds `maxWords`, appending an
 *  ellipsis. The model is TOLD the budget in the prompt; this is the
 *  guarantee for when it overshoots anyway. */
function enforceMaxWords(text: string, maxWords: number | null | undefined): string {
  if (!maxWords || maxWords <= 0) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[.,;:!?…]*$/, "") + "…";
}

/** Same story for the legacy character budget (`max_length`), which the new
 *  contract DOES treat as hard — unlike the old fill, where it was ignored
 *  (see the NOTE above fittedFontSize in ai-layout-fill.ts). Here the model
 *  saw the budget in the manifest, so a violation is a real violation. */
function enforceMaxLength(text: string, maxLength: unknown): string {
  const cap = typeof maxLength === "number" && Number.isFinite(maxLength) ? maxLength : null;
  if (!cap || cap <= 0 || text.length <= cap) return text;
  const sliced = text.slice(0, cap);
  const atSpace = sliced.lastIndexOf(" ");
  return (atSpace > cap * 0.6 ? sliced.slice(0, atSpace) : sliced).replace(/[.,;:!?…]*$/, "") + "…";
}

function enforceSlotBudgets(text: string, slot: SlotMeta | null, el: Rec): string {
  let out = text.trim();
  if (slot?.max_words != null) out = enforceMaxWords(out, slot.max_words);
  out = enforceMaxLength(out, el.max_length);
  return out;
}

/* ----------------------------- Slot collection ---------------------------- */

interface NamedTextSlot {
  el: Rec;
  name: string;
  slot: SlotMeta | null;
  /** Splices this element out of its parent array (children/elements). */
  remove: () => void;
}

function visitNamedText(el: Rec, out: NamedTextSlot[]): void {
  const children = el.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      // Removal is resolved by identity AT CALL TIME — several siblings can be
      // pruned in one pass without stale-index splices.
      collectOne(child, () => {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
      }, out);
    }
    return;
  }
  const child = el.child as Rec | undefined;
  if (child && typeof child === "object") {
    collectOne(child, () => {
      delete el.child;
    }, out);
  }
}

function collectOne(el: Rec, remove: () => void, out: NamedTextSlot[]): void {
  const type = el.type;
  if ((type === "text" || type === "text-list") && el.decorative !== true) {
    const name = typeof el.name === "string" ? el.name.trim() : "";
    if (name) {
      out.push({ el, name, slot: parseSlotMeta(el.slot), remove });
      return; // a named text leaf has no fillable descendants
    }
  }
  visitNamedText(el, out);
}

/** Every named, non-decorative text element in the layout, in document order. */
function collectNamedTextSlots(components: Rec[]): NamedTextSlot[] {
  const out: NamedTextSlot[] = [];
  for (const component of components) {
    const elements = (component.elements as Rec[]) ?? [];
    for (const el of elements) {
      if (!el || typeof el !== "object") continue;
      collectOne(el, () => {
        const idx = elements.indexOf(el);
        if (idx >= 0) elements.splice(idx, 1);
      }, out);
    }
  }
  return out;
}

/* --------------------------- Unfilled-slot policy -------------------------- */

/** Backstop for a slot the model was REQUIRED to fill ("always") but didn't.
 *  Derived from the slide's other fills / the deck topic — never invented
 *  facts. Returns "" when there's genuinely nothing sensible, which at least
 *  beats leaving the template's sample copy on screen. */
function fallbackForAlwaysSlot(
  slot: SlotMeta | null,
  headline: string,
  topic: string,
): string {
  switch (slot?.role) {
    case "headline":
      return headline || topic;
    case "subheadline":
    case "body":
    case "bullet":
    case "caption":
      return headline && headline !== topic ? topic : "";
    case "date":
      return String(new Date().getFullYear());
    case "step-number":
      return "01";
    default:
      return headline;
  }
}

/* --------------------------------- Fill ----------------------------------- */

/**
 * Fills `layout` with the model's slot-by-slot copy. Enforcement summary:
 *  - page-number slots     → stamped with the slide's ordinal (ctx.pageNumber)
 *                            — the model never sees them, the client owns them.
 *  - fill present          → budgets enforced, text written (font auto-fits).
 *  - missing + always      → role-based fallback from the deck's own material.
 *  - missing + prune flag  → element removed, empty containers pruned after.
 *  - missing + optional    → text cleared (never the author's sample copy).
 */
export function fillLayoutWithSlotMap(
  layout: TemplateLayout,
  line: ManifestSlideLine,
  ctx: { topic: string; pageNumber?: number },
): FilledSlide {
  const components = JSON.parse(JSON.stringify(layout.components)) as Rec[];
  const namedSlots = collectNamedTextSlots(components);

  // Group fills by slot name, preserving order — the Nth fill for a name goes
  // to the Nth element carrying that name (layouts repeat names, e.g. two
  // "body_paragraph" elements in one layout).
  const fillsByName = new Map<string, string[]>();
  for (const fill of line.fills) {
    const list = fillsByName.get(fill.name) ?? [];
    list.push(fill.text);
    fillsByName.set(fill.name, list);
  }

  const headline =
    line.fills.find((f) => /title|headline|heading/i.test(f.name))?.text ?? "";

  for (const named of namedSlots) {
    // Page numbers are the client's job — stamped from the slide's position
    // in the deck, never asked from the model (it can't know the final order).
    if (named.slot?.role === "page-number") {
      setText(named.el, ctx.pageNumber != null ? String(ctx.pageNumber) : "");
      continue;
    }
    const queue = fillsByName.get(named.name);
    const text = queue?.shift();
    if (text != null && text.trim()) {
      setText(named.el, enforceSlotBudgets(text, named.slot, named.el));
      continue;
    }
    // Unfilled:
    const condition = named.slot?.fill_condition ?? "always";
    if (condition === "always") {
      const fallback = fallbackForAlwaysSlot(named.slot, headline, ctx.topic);
      setText(named.el, enforceSlotBudgets(fallback, named.slot, named.el));
    } else if (named.slot?.prune_if_unfilled) {
      named.remove();
    } else {
      setText(named.el, "");
    }
  }

  // Removing elements can orphan container/group wrappers — drop the empties
  // so no hollow chrome box is left on the slide.
  for (const component of components) pruneEmptyContainers(component);

  const photoSlots = findAllPhotoSlots(components);
  const heroImage = findHeroImage(photoSlots);
  const secondaryImages = findSecondaryImages(photoSlots, heroImage);

  return { ui: { id: layout.id, components }, heroImage, secondaryImages };
}

/** High-level entry: fill + swap placeholder icons, mirroring
 *  mapAIPPTSlideToTemplateUi's role in the legacy path. Returns null when the
 *  layout id isn't in the pack (model hallucinated an id). */
export async function fillManifestSlide(
  layout: TemplateLayout | null,
  line: ManifestSlideLine,
  ctx: { topic: string; pageNumber?: number },
): Promise<FilledSlide | null> {
  if (!layout) return null;
  const filled = fillLayoutWithSlotMap(layout, line, ctx);
  const iconFallback =
    line.fills.find((f) => /title|headline|heading/i.test(f.name))?.text || ctx.topic;
  filled.ui = await fillPlaceholderIcons(filled.ui, iconFallback);
  return filled;
}
