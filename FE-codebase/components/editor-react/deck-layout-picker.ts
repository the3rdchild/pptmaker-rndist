import {
  DEFAULT_THEME_ID,
  loadAllThemes,
} from "@/lib/templates/themes";

export type AIPPTSlide =
  | { type: "cover"; data: { title: string; text: string } }
  | { type: "contents"; data: { items: string[] } }
  | { type: "transition"; data: { title: string; text: string } }
  | { type: "content"; data: { title: string; items: { title: string; text: string }[] } }
  | { type: "end" };

export type Rec = Record<string, unknown>;

export interface TemplateLayout {
  id: string;
  description?: string;
  /** Authoring metadata from the template engine (slide_role, topics, items). */
  meta?: Rec;
  components: Rec[];
}

interface TemplatePack {
  layouts: TemplateLayout[];
  fonts?: Record<string, string> | null;
}

let packCache: Record<string, TemplatePack> | null = null;
let packNamesCache: string[] | null = null;

/** Every theme in the registry that actually has layouts to pick from, keyed
 *  by id. Themes hand back layouts whose asset paths are already resolved
 *  against their own folder, so filling a layout from any theme is safe.
 *  A theme id can be listed in index.json (so the template engine's picker
 *  still shows it for management) while holding zero layouts — never
 *  populated, or mid-rebuild. Excluded here so it can never be the pack a
 *  deck's seed hash lands on: an empty pack would leave that deck's
 *  generation with no layouts at all. */
async function loadAllPacks(): Promise<Record<string, TemplatePack>> {
  if (packCache) return packCache;
  const themes = (await loadAllThemes()).filter((theme) => theme.layouts.length > 0);
  packCache = Object.fromEntries(
    themes.map((theme) => [
      theme.id,
      { layouts: theme.layouts as unknown as TemplateLayout[], fonts: theme.fonts },
    ])
  );
  packNamesCache = themes.map((theme) => theme.id);
  return packCache;
}

// Derived from loadAllPacks() (not a separate listThemeIds() call) so the
// name pool a deck's seed hash picks from is always the SAME set that
// actually has a pack behind it — no window where an empty theme is
// choosable by name but resolves to nothing.
async function loadPackNames(): Promise<string[]> {
  if (packNamesCache) return packNamesCache;
  await loadAllPacks();
  return packNamesCache ?? [];
}

/** Lowercased, punctuation collapsed to single spaces, padded — so a key can be
 *  looked up with indexOf and still only match on whole words. */
function themeText(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Finds the theme the author asked for in the generation prompt, e.g.
 *  "buatkan ppt tentang kerjaan, gunakan theme cassual".
 *
 *  Matching is deliberately anchored to an explicit theme/tema/template word
 *  rather than scanning the whole prompt: theme NAMES here include `modern`,
 *  `general` and `standard`, so a deck that merely talks about "arsitektur
 *  modern" must not silently switch packs. Text after the anchor wins over text
 *  before it, which is what separates "…arsitektur modern, gunakan theme
 *  cassual" (cassual) from "use the modern theme" (modern).
 *
 *  Returns null when no theme is named, leaving the seed hash in charge. */
export async function resolveThemeFromPrompt(
  prompt: string,
): Promise<string | null> {
  if (!prompt) return null;
  const themes = await loadAllThemes();
  if (themes.length === 0) return null;

  // Longest first so a name that contains another still wins outright.
  const keys = themes
    .flatMap((theme) => {
      const names = [theme.name ?? "", theme.id].filter(Boolean);
      return names.map((name) => ({ id: theme.id, key: themeText(name) }));
    })
    .filter((entry) => entry.key.trim().length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  const lower = prompt.toLowerCase();
  const anchor = /\b(?:themes?|tema(?:nya)?|templates?)\b/g;

  const pick = (window: string, fromEnd: boolean): string | null => {
    const haystack = themeText(window);
    let best: { id: string; at: number } | null = null;
    for (const { id, key } of keys) {
      const at = fromEnd ? haystack.lastIndexOf(key) : haystack.indexOf(key);
      if (at < 0) continue;
      const closer = fromEnd ? at > (best?.at ?? -1) : at < (best?.at ?? Infinity);
      if (!best || closer) best = { id, at };
    }
    return best?.id ?? null;
  };

  for (let m = anchor.exec(lower); m; m = anchor.exec(lower)) {
    const end = m.index + m[0].length;
    const after = pick(lower.slice(end, end + 32), false);
    if (after) return after;
    const before = pick(lower.slice(Math.max(0, m.index - 26), m.index), true);
    if (before) return before;
  }
  return null;
}

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33) ^ seed.charCodeAt(i);
  return hash >>> 0;
}

/** The author's own `slide_role`, when the layout carries one. Authored in the
 *  template engine, so it beats guessing from id/description text. */
function slideRoleOf(layout: TemplateLayout): string | null {
  const meta = layout.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const role = (meta as Rec).slide_role;
  return typeof role === "string" && role ? role : null;
}

function isCoverLayout(layout: TemplateLayout): boolean {
  const role = slideRoleOf(layout);
  if (role) return role === "cover";
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("cover");
}

function isContentsLayout(layout: TemplateLayout): boolean {
  const role = slideRoleOf(layout);
  if (role) return role === "agenda";
  const s = `${layout.id} ${layout.description ?? ""}`.toLowerCase();
  return s.includes("index") || s.includes("contents") || s.includes("agenda") || s.includes("toc");
}

interface Buckets {
  cover: TemplateLayout[];
  contents: TemplateLayout[];
  /** Sign-off layouts. Without these an `end` slide fell back to the cover, so
   *  a deck opened and closed on the same design. */
  closing: TemplateLayout[];
  /** Chapter breaks. Same story: `transition` used to reuse the cover, which is
   *  why a deck showed its cover design three or four times over. */
  section: TemplateLayout[];
  content: TemplateLayout[];
  /** Layouts that need numeric/stat data the AI can't supply yet. Parked
   *  here so the picker never rotates them into a generated deck; they stay
   *  available for manual insert from the Templates panel. */
  metrics: TemplateLayout[];
}

// Layouts audited as needing real numeric data (big figures / stat cards).
// Excluded from AI generation until the AI can research actual figures — a
// metric card filled with prose reads as fabricated ("92% — [unrelated
// sentence]"). Detected by structure too (hasMetricCardSlot) so new layouts
// with the same shape are caught automatically.
const METRIC_LAYOUT_IDS = new Set([
  "centered_metrics_layout_9752",
  "split_content_metrics_4327",
  "stat_row_layout_4821",
  "two_column_metrics_7973",
  "top_header_metric_cards_2015",
  "icon_stat_tiles_5602",
  "two_column_layout_2710",
  "two_column_info_layout_8378",
]);

// True if the layout contains a grid/flex card whose subtree has a text leaf
// named like a metric/stat value — i.e. it expects numeric data per card.
function hasMetricCardSlot(layout: TemplateLayout): boolean {
  if (METRIC_LAYOUT_IDS.has(layout.id)) return true;
  const components = Array.isArray(layout.components) ? (layout.components as Rec[]) : [];
  for (const component of components) {
    const elements = Array.isArray(component?.elements) ? (component.elements as Rec[]) : [];
    for (const el of elements) {
      if (gridFlexHasMetricLeaf(el)) return true;
    }
  }
  return false;
}

function gridFlexHasMetricLeaf(el: Rec | null): boolean {
  if (!el) return false;
  const type = el.type;
  const children = el.children as Rec[] | undefined;
  if ((type === "grid" || type === "flex") && Array.isArray(children) && children.length > 1) {
    for (const card of children) {
      if (subtreeHasMetricLeaf(card)) return true;
    }
    return false;
  }
  return false;
}

function subtreeHasMetricLeaf(node: Rec | null | undefined): boolean {
  if (!node) return false;
  const type = node.type;
  if (type === "text" || type === "text-list") {
    if (/metric|stat/i.test(String(node.name ?? ""))) return true;
    return false;
  }
  const children = node.children as Rec[] | undefined;
  if (Array.isArray(children)) {
    for (const c of children) if (subtreeHasMetricLeaf(c)) return true;
    return false;
  }
  const child = node.child as Rec | undefined;
  if (child) return subtreeHasMetricLeaf(child);
  return false;
}

function bucketLayouts(layouts: TemplateLayout[]): Buckets {
  const cover: TemplateLayout[] = [];
  const contents: TemplateLayout[] = [];
  const closing: TemplateLayout[] = [];
  const section: TemplateLayout[] = [];
  const content: TemplateLayout[] = [];
  const metrics: TemplateLayout[] = [];
  for (const l of layouts) {
    const role = slideRoleOf(l);
    if (isCoverLayout(l)) cover.push(l);
    else if (isContentsLayout(l)) contents.push(l);
    else if (role === "closing") closing.push(l);
    else if (role === "section") section.push(l);
    // An authored `metrics` role is the layout author saying outright that this
    // one needs real figures — the structural sniff below only catches metric
    // cards nested in a grid/flex, which flat imported layouts never have.
    else if (role === "metrics" || hasMetricCardSlot(l)) metrics.push(l);
    else content.push(l);
  }
  return { cover, contents, closing, section, content, metrics };
}

/** Picks one template pack per deck (deterministic from a seed) and rotates
 * through its content layouts so consecutive content slides don't repeat. */
export class DeckLayoutPicker {
  private buckets: Buckets | null = null;
  private layouts: TemplateLayout[] = [];
  private contentCursor = 0;
  private seed: string;
  /** Resolved in ensureLoaded() — the theme list is fetched, not compiled in,
   *  so a theme added to storage is picked up without a code change. */
  private packName: string | null = null;
  private packFonts: Record<string, string> | null = null;

  /** A theme the author named in the prompt. Wins over the seed hash, which is
   *  arbitrary by design (it only exists to spread decks across the packs). */
  private preferred: string | null;

  constructor(seed: string, preferredThemeId?: string | null) {
    this.seed = seed;
    this.preferred = preferredThemeId ?? null;
  }

  async ensureLoaded(): Promise<void> {
    if (this.buckets) return;
    const names = await loadPackNames();
    const asked =
      this.preferred && names.includes(this.preferred) ? this.preferred : null;
    this.packName =
      this.packName ?? asked ?? names[hashSeed(this.seed) % Math.max(1, names.length)];
    const packs = await loadAllPacks();
    // this.packName (seed-hashed or explicitly asked for) and DEFAULT_THEME_ID
    // both name IDS, not guaranteed entries in `packs` — loadAllPacks already
    // dropped any theme with zero layouts, so either can be missing here.
    // Object.values(packs)[0] is the last resort: any real pack beats none.
    const pack = packs[this.packName] ?? packs[DEFAULT_THEME_ID] ?? Object.values(packs)[0];
    if (!pack) throw new Error("No template layouts are available in any theme.");
    this.layouts = pack.layouts;
    this.buckets = bucketLayouts(pack.layouts);
    this.packFonts = (pack.fonts ?? null) as Record<string, string> | null;
  }

  /** The theme this deck was assigned. Available after ensureLoaded(). */
  getThemeId(): string | null {
    return this.packName;
  }

  /** Every layout in the chosen pack, in authored order — used by the
   *  manifest-driven fill path where the MODEL picks the layout id. */
  getLayouts(): TemplateLayout[] {
    return this.layouts;
  }

  /** Looks up one layout in the chosen pack by its authored id. */
  getLayoutById(id: string): TemplateLayout | null {
    return this.layouts.find((l) => l.id === id) ?? null;
  }

  /** Best layout for an id the model may have got wrong.
   *
   *  Authored ids carry an arbitrary numeric suffix ("visual_1_8449"), which a
   *  model reproduces from memory and sometimes mistypes. Dropping the slide
   *  on a miss meant an approved outline page silently vanished from the deck,
   *  so a near miss falls back to a layout of the same family (same alphabetic
   *  stem) and an outright miss to the next content layout. The slide's own
   *  slot names then won't match, but finalizeStreamedSlide backstops "always"
   *  slots from the headline — a slide with the right title beats no slide. */
  resolveLayoutId(id: string): { layout: TemplateLayout; exact: boolean } | null {
    const exact = this.getLayoutById(id);
    if (exact) return { layout: exact, exact: true };
    if (this.layouts.length === 0) return null;

    const stem = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
    const wanted = stem(id);
    const sameFamily = wanted
      ? this.layouts.find((l) => stem(l.id) === wanted)
      : undefined;
    if (sameFamily) return { layout: sameFamily, exact: false };

    try {
      return { layout: this.pickFor("content"), exact: false };
    } catch {
      return null;
    }
  }

  /** The chosen pack's font map ({ family: cssUrl }). Available after
   *  ensureLoaded(). Used so the editor/present render path loads the right
   *  per-pack typeface instead of only the generic Google-Fonts fallback. */
  getFonts(): Record<string, string> | null {
    return this.packFonts;
  }

  private fallbackContent(): TemplateLayout {
    const b = this.buckets!;
    const pool = b.content.length ? b.content : [...b.cover, ...b.contents];
    const layout = pool[this.contentCursor % pool.length];
    this.contentCursor++;
    return layout;
  }

  pickFor(type: AIPPTSlide["type"]): TemplateLayout {
    const b = this.buckets;
    if (!b) throw new Error("DeckLayoutPicker not loaded — call ensureLoaded() first");
    switch (type) {
      case "cover":
        return b.cover[0] ?? this.fallbackContent();
      case "end":
        // Falling through to the cover is the last resort, not the default: a
        // deck that opens and closes on the same slide design reads as a bug.
        return b.closing[0] ?? b.cover[0] ?? this.fallbackContent();
      case "contents":
        return b.contents[0] ?? this.fallbackContent();
      case "transition":
        // A chapter break is not a cover. With no section layout authored,
        // rotating a content layout still beats showing the cover again.
        return b.section[0] ?? this.fallbackContent();
      case "content":
      default:
        return this.fallbackContent();
    }
  }
}
