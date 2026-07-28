// Derives a deck palette from a template's authored one by rotating hue.
//
// The template author fixes the *character* of a palette — how saturated, how
// light, how the brand colours relate to each other — and the generator only
// chooses a hue. That keeps every generated deck looking like the template it
// came from instead of like whatever colours the model felt like naming.
//
// Two groups behave differently on purpose:
//   brand   (primary/secondary/accent) rotate, related by a harmony rule
//   neutral (background/surface/text/muted/border) keep their lightness and
//           only pick up a trace of the brand hue
// Rotating neutrals outright would be pointless (white and near-black have no
// hue to rotate) and dangerous (coloured body text loses contrast), so they
// are tinted instead, then contrast-checked.

export type HarmonyRule =
  | "preserve"
  | "complementary"
  | "analogous"
  | "triadic"
  | "tetradic";

export const HARMONY_RULES: {
  id: HarmonyRule;
  label: string;
  /** Hue offsets from the primary, one per extra brand colour. */
  offsets: number[];
  hint: string;
}[] = [
  {
    id: "preserve",
    label: "Keep authored relationship",
    offsets: [],
    hint: "Rotate every brand colour by the same amount, keeping the gaps you designed.",
  },
  {
    id: "complementary",
    label: "Complementary",
    offsets: [180],
    hint: "Opposite the primary. Strongest contrast — good for a single accent.",
  },
  {
    id: "analogous",
    label: "Analogous",
    offsets: [30, -30],
    hint: "Neighbouring hues. Calmest option, hard to make clash.",
  },
  {
    id: "triadic",
    label: "Triadic",
    offsets: [120, 240],
    hint: "Three evenly spaced hues. Lively while staying balanced.",
  },
  {
    id: "tetradic",
    label: "Tetradic",
    offsets: [90, 180, 270],
    hint: "Two complementary pairs. Richest, but needs one hue to dominate.",
  },
];

/** Suggests a rule from how many brand colours the template actually uses —
 *  a tetradic scheme on a two-colour template just invents a colour nobody
 *  asked for. */
export function recommendHarmony(brandColorCount: number): HarmonyRule {
  if (brandColorCount <= 1) return "preserve";
  if (brandColorCount === 2) return "complementary";
  if (brandColorCount === 3) return "triadic";
  return "tetradic";
}

export type BrandRole = "primary" | "secondary" | "accent";
export type NeutralRole = "background" | "surface" | "text" | "muted" | "border";

export type PaletteSpec = {
  brand: Partial<Record<BrandRole, string>>;
  neutral: Partial<Record<NeutralRole, string>>;
  harmony?: HarmonyRule | null;
  /** 0..1 — how much of the brand hue bleeds into the neutrals. */
  neutral_tint?: number | null;
};

export type ResolvedPalette = Record<string, string>;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

const BRAND_ORDER: BrandRole[] = ["primary", "secondary", "accent"];
const NEUTRAL_ORDER: NeutralRole[] = [
  "background",
  "surface",
  "text",
  "muted",
  "border",
];

/** WCAG AA for body text. Tinting must never push below this. */
const MIN_TEXT_CONTRAST = 4.5;
/** Neutrals stay neutral: a tint may not saturate them past this. */
const MAX_NEUTRAL_SATURATION = 0.18;

export function parseHex(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (!rgbA || !rgbB) return 1;
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function rotate(hex: string, hue: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return toHex(hslToRgb({ ...hsl, h: hue }));
}

/** Nudges a colour's lightness until it clears the contrast floor against the
 *  background, moving away from the background rather than to an arbitrary
 *  black or white so the tint survives. */
function enforceContrast(
  color: string,
  background: string,
  minRatio = MIN_TEXT_CONTRAST,
): string {
  if (contrastRatio(color, background) >= minRatio) return color;

  const rgb = parseHex(color);
  const bgRgb = parseHex(background);
  if (!rgb || !bgRgb) return color;

  const hsl = rgbToHsl(rgb);
  const goDarker = relativeLuminance(bgRgb) > 0.5;
  let best = color;

  for (let step = 1; step <= 20; step++) {
    const l = goDarker
      ? Math.max(0, hsl.l - step * 0.05)
      : Math.min(1, hsl.l + step * 0.05);
    const candidate = toHex(hslToRgb({ ...hsl, l }));
    best = candidate;
    if (contrastRatio(candidate, background) >= minRatio) break;
  }
  return best;
}

export type RotateOptions = {
  /** Target hue in degrees for the primary. */
  hue: number;
  /** Overrides the palette's authored rule. */
  harmony?: HarmonyRule;
  /** Overrides the palette's authored tint strength (0..1). */
  neutralTint?: number;
};

/**
 * Produces a full palette at a new hue, preserving every colour's authored
 * saturation and lightness.
 */
export function rotatePalette(
  spec: PaletteSpec,
  options: RotateOptions,
): ResolvedPalette {
  const rule = options.harmony ?? spec.harmony ?? "preserve";
  const tint = Math.max(
    0,
    Math.min(1, options.neutralTint ?? spec.neutral_tint ?? 0),
  );
  const targetHue = ((options.hue % 360) + 360) % 360;

  const primaryHex = spec.brand.primary ?? spec.brand.accent ?? "#000000";
  const primaryHsl = rgbToHsl(parseHex(primaryHex) ?? { r: 0, g: 0, b: 0 });
  const shift = targetHue - primaryHsl.h;

  const out: ResolvedPalette = {};
  const ruleOffsets = HARMONY_RULES.find((r) => r.id === rule)?.offsets ?? [];

  BRAND_ORDER.forEach((role, index) => {
    const authored = spec.brand[role];
    if (!authored) return;
    if (role === "primary" || rule === "preserve") {
      // Same rotation for everything keeps the gaps the author designed.
      const hsl = rgbToHsl(parseHex(authored) ?? { r: 0, g: 0, b: 0 });
      out[role] = rotate(authored, hsl.h + shift);
      return;
    }
    // Harmony rules re-derive the gap from the primary instead.
    const offset = ruleOffsets[index - 1] ?? ruleOffsets[ruleOffsets.length - 1] ?? 0;
    out[role] = rotate(authored, targetHue + offset);
  });

  // Neutrals: keep lightness, adopt the brand hue at a fraction of strength.
  NEUTRAL_ORDER.forEach((role) => {
    const authored = spec.neutral[role];
    if (!authored) return;
    const rgb = parseHex(authored);
    if (!rgb) {
      out[role] = authored;
      return;
    }
    const hsl = rgbToHsl(rgb);
    // The ceiling caps how much tint we *add*; it must never pull an authored
    // neutral below the saturation the author chose, or rotating to the theme's
    // own hue would come back a different colour than it started.
    const saturation = Math.max(hsl.s, tint * MAX_NEUTRAL_SATURATION);
    out[role] = toHex(hslToRgb({ h: targetHue, s: saturation, l: hsl.l }));
  });

  // Tinting moves text and background independently, so re-check the pair the
  // reader actually has to resolve.
  const background = out.background ?? spec.neutral.background;
  if (background) {
    if (out.text) out.text = enforceContrast(out.text, background);
    if (out.muted) out.muted = enforceContrast(out.muted, background, 3);
  }

  return out;
}

/** Counts the distinct brand colours a palette actually defines. */
export function brandColorCount(spec: PaletteSpec): number {
  return new Set(
    BRAND_ORDER.map((role) => spec.brand[role]?.toUpperCase()).filter(Boolean),
  ).size;
}

/** Reads the legacy flat palette ({background, primary, …}) as a spec, so
 *  themes authored before the brand/neutral split keep working. */
export function toPaletteSpec(raw: unknown): PaletteSpec {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const nested = record.brand || record.neutral;
  if (nested) {
    return {
      brand: (record.brand ?? {}) as PaletteSpec["brand"],
      neutral: (record.neutral ?? {}) as PaletteSpec["neutral"],
      harmony: (record.harmony as HarmonyRule) ?? null,
      neutral_tint:
        typeof record.neutral_tint === "number" ? record.neutral_tint : null,
    };
  }

  const pick = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;

  return {
    brand: {
      primary: pick("primary"),
      secondary: pick("secondary"),
      accent: pick("accent"),
    },
    neutral: {
      background: pick("background"),
      surface: pick("surface"),
      text: pick("text"),
      muted: pick("muted"),
      border: pick("border"),
    },
    harmony: null,
    neutral_tint: null,
  };
}
