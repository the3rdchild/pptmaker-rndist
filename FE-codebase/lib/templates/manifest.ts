// Compact, model-facing description of what a theme and its layouts can hold.
//
// This is the bridge to phase 3. The generator's current contract asks the
// model for a fixed 5-shape AIPPTSlide union and then mechanically stuffs
// title/bullets into whichever layout a keyword heuristic picked — so a richer
// template gains nothing. A manifest inverts that: the model is shown the
// themes, picks one, then picks layouts by role and fills named slots under
// their stated constraints.
//
// Keep the output small. It is prompt payload, not a data dump: geometry,
// colours, and decorative elements are all omitted on purpose.

import {
  type LayoutMeta,
  type SlideRole,
  type SlotFillCondition,
  type SlotMeta,
  type SlotRole,
  parseLayoutMeta,
  parseSlotMeta,
} from "@/components/slide-editor/templates/slot-meta";
import { walkElements } from "@/components/slide-editor/templates/template-v2-export";
import type { TemplateLayout, TemplateTheme } from "@/lib/templates/themes";
import {
  brandColorCount,
  recommendHarmony,
  toPaletteSpec,
} from "@/lib/templates/palette-engine";

type Rec = Record<string, unknown>;

export type SlotKind = "text" | "text-list" | "image" | "chart" | "table";

export type SlotManifestEntry = {
  name: string;
  kind: SlotKind;
  role?: SlotRole;
  hint?: string;
  fill_condition?: SlotFillCondition;
  prune_if_unfilled?: boolean;
  max_words?: number;
  max_lines?: number;
  max_length?: number;
  min_length?: number;
  /** Authored typography. The family is fixed by the theme; size and weight
   *  are reported so the model can judge how much text will fit, and may be
   *  adjusted to fit — the family may not. */
  font?: { family?: string; size?: number; bold?: boolean };
};

export type LayoutManifest = {
  theme: string;
  id: string;
  description: string;
  slide_role?: SlideRole;
  topics?: string[];
  items?: { min?: number; max?: number; ideal?: number };
  capabilities: string[];
  slots: SlotManifestEntry[];
  notes?: string;
};

/** What the generator is and isn't allowed to change. Spelled out rather than
 *  implied, because "here is a palette" reads as a suggestion to a model while
 *  "hue is yours, everything else is fixed" does not. */
export type ThemeConstraints = {
  color: {
    /** The generator picks this and nothing else about the colour. */
    choose: "hue";
    harmony: string;
    locked: string[];
    note: string;
  };
  typography: {
    families: string[];
    locked: "family";
    adjustable: string[];
    note: string;
  };
};

export type ThemeManifest = {
  id: string;
  name: string;
  description: string;
  when_to_use?: string;
  avoid_when?: string;
  tone?: string[];
  keywords?: string[];
  palette?: unknown;
  constraints: ThemeConstraints;
  layouts: LayoutManifest[];
};

function buildConstraints(theme: TemplateTheme): ThemeConstraints {
  const spec = toPaletteSpec(theme.palette);
  const harmony = spec.harmony ?? recommendHarmony(brandColorCount(spec));
  return {
    color: {
      choose: "hue",
      harmony,
      locked: ["saturation", "lightness", "contrast"],
      note: "Choose a single hue for the deck. Saturation, lightness and the relationships between brand colours come from the theme; neutrals keep their lightness and only pick up a trace of the chosen hue.",
    },
    typography: {
      families: Object.keys(theme.fonts ?? {}),
      locked: "family",
      adjustable: ["size", "weight"],
      note: "Use the theme's font family as-is. Size and weight may be adjusted to make text fit, but never substitute a different family.",
    },
  };
}

function isRecord(value: unknown): value is Rec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function slotKind(type: unknown): SlotKind | null {
  switch (type) {
    case "text":
      return "text";
    case "text-list":
      return "text-list";
    case "image":
      return "image";
    case "chart":
      return "chart";
    case "table":
      return "table";
    default:
      return null;
  }
}

function componentsOf(layout: TemplateLayout): Rec[] {
  return Array.isArray(layout.components)
    ? (layout.components.filter(isRecord) as Rec[])
    : [];
}

export function buildLayoutManifest(
  layout: TemplateLayout,
  themeId: string,
): LayoutManifest {
  const components = componentsOf(layout);
  const meta: LayoutMeta | null = parseLayoutMeta(layout.meta);

  const slots: SlotManifestEntry[] = [];
  const capabilities = new Set<string>();
  let imageSlots = 0;
  let iconSlots = 0;

  walkElements(components, (element) => {
    const kind = slotKind(element.type);
    if (!kind) return;

    if (kind === "chart") capabilities.add("chart");
    if (kind === "table") capabilities.add("table");
    if (kind === "image") {
      if (element.is_icon === true) {
        iconSlots += 1;
        capabilities.add("icons");
      } else if (element.decorative !== true) {
        imageSlots += 1;
        capabilities.add("image");
      }
    }

    // Decorative elements are the template author's design, never the model's
    // to fill — they must not appear in the prompt at all.
    if (element.decorative === true) return;
    if (kind === "image" && element.is_icon === true) return;

    const name = readString(element.name);
    if (!name) return;

    const slot: SlotMeta | null = parseSlotMeta(element.slot);
    const entry: SlotManifestEntry = { name, kind };
    if (slot?.role) entry.role = slot.role;
    if (slot?.hint) entry.hint = slot.hint;
    if (slot?.fill_condition) entry.fill_condition = slot.fill_condition;
    if (slot?.prune_if_unfilled) entry.prune_if_unfilled = true;
    if (slot?.max_words != null) entry.max_words = slot.max_words;
    if (slot?.max_lines != null) entry.max_lines = slot.max_lines;

    const maxLength = readNumber(element.max_length);
    if (maxLength != null) entry.max_length = maxLength;
    const minLength = readNumber(element.min_length);
    if (minLength != null) entry.min_length = minLength;

    const font = isRecord(element.font) ? element.font : null;
    if (font) {
      const family = readString(font.family);
      const size = readNumber(font.size);
      const bold = font.bold === true;
      if (family || size != null || bold) {
        entry.font = {
          ...(family ? { family } : {}),
          ...(size != null ? { size } : {}),
          ...(bold ? { bold } : {}),
        };
      }
    }

    slots.push(entry);
  });

  if (imageSlots > 1) capabilities.add(`image_slots:${imageSlots}`);
  if (iconSlots > 0) capabilities.add(`icon_slots:${iconSlots}`);

  const manifest: LayoutManifest = {
    theme: themeId,
    id: readString(layout.id) ?? "unknown",
    description: readString(layout.description) ?? "",
    capabilities: [...capabilities].sort(),
    slots,
  };

  if (meta?.slide_role) manifest.slide_role = meta.slide_role;
  if (meta?.topics?.length) manifest.topics = meta.topics;
  if (meta?.notes) manifest.notes = meta.notes;
  if (meta?.min_items != null || meta?.max_items != null || meta?.ideal_items != null) {
    manifest.items = {
      ...(meta.min_items != null ? { min: meta.min_items } : {}),
      ...(meta.max_items != null ? { max: meta.max_items } : {}),
      ...(meta.ideal_items != null ? { ideal: meta.ideal_items } : {}),
    };
  }

  return manifest;
}

export function buildThemeManifest(theme: TemplateTheme): ThemeManifest {
  const manifest: ThemeManifest = {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    palette: theme.palette ?? undefined,
    constraints: buildConstraints(theme),
    layouts: theme.layouts.map((layout) => buildLayoutManifest(layout, theme.id)),
  };

  const whenToUse = readString(theme.ai?.when_to_use);
  if (whenToUse) manifest.when_to_use = whenToUse;
  const avoidWhen = readString(theme.ai?.avoid_when);
  if (avoidWhen) manifest.avoid_when = avoidWhen;
  if (theme.ai?.tone?.length) manifest.tone = theme.ai.tone;
  if (theme.ai?.keywords?.length) manifest.keywords = theme.ai.keywords;

  return manifest;
}

/** Theme-level summary only — what the model needs to answer "which theme is
 *  this deck?" before it is shown any layout detail. Keeping theme selection
 *  as its own small step is what makes "pick a theme, then pick slides from
 *  it" cheap enough to run on every deck. */
export function buildThemeChoiceManifest(themes: TemplateTheme[]) {
  return themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    description: theme.description,
    when_to_use: readString(theme.ai?.when_to_use),
    avoid_when: readString(theme.ai?.avoid_when),
    tone: theme.ai?.tone ?? undefined,
    keywords: theme.ai?.keywords ?? undefined,
    slide_count: theme.layouts.length,
    roles: [
      ...new Set(
        theme.layouts
          .map((layout) => parseLayoutMeta(layout.meta)?.slide_role)
          .filter((role): role is SlideRole => Boolean(role)),
      ),
    ],
  }));
}
