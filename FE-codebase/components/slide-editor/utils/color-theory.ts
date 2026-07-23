// Turns ONE seed hex color into an explicit, role-based palette instead of
// leaving AI-generated decks to whatever flat color a template pack bakes
// in. Spec (given explicitly, not guessed): a 5-step monochromatic
// lightness ramp at full saturation from the seed's hue — background takes
// the lightest step, card/shape accents take the 2nd-darkest step, text is
// pure black/white by contrast, and icons take tetradic (h+90/180/270)
// hues off the same base so they read as a deliberate accent, not just
// another shade of the same color.

export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { h, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Pure black or white — whichever contrasts better against `hex`, using
// relative luminance (not raw HSL lightness) so a vivid, "dark-ish" hue like
// pure blue still correctly gets white text.
export function contrastColor(hex: string): "#000000" | "#FFFFFF" {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.35 ? "#000000" : "#FFFFFF";
}

// A deck picks ONE harmony scheme for its cards so sibling cards in a grid
// vary within a coherent color family (like Canva) instead of every card being
// the same single accent tone. "monochrome" varies lightness at the base hue;
// the rest fan hues off the base by the classic harmony offsets.
export type CardScheme =
  | "monochrome"
  | "analogous"
  | "complementary"
  | "triadic"
  | "tetradic"
  | "split";

const SCHEME_HUE_OFFSETS: Record<Exclude<CardScheme, "monochrome">, number[]> = {
  analogous: [0, 28, -28, 56, -56],
  complementary: [0, 180],
  triadic: [0, 120, 240],
  tetradic: [0, 90, 180, 270],
  split: [0, 150, 210],
};

const CARD_SCHEMES: CardScheme[] = [
  "monochrome",
  "analogous",
  "complementary",
  "triadic",
  "tetradic",
  "split",
];

function hashStr(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = (hash * 33) ^ s.charCodeAt(i);
  return hash >>> 0;
}

export interface GeneratedPalette {
  /** Very light wash — the slide's own page background. */
  background: string;
  /** Vivid mid-dark tone — the default card/shape accent (== shapes[0]). */
  shape: string;
  /** The deck's harmony scheme card colors, at the same lightness as `shape`
   * but varied by hue (or lightness, for monochrome) — rotated across sibling
   * cards in a grid so a feature row reads as a designed set, not a wall of
   * one color. shapes[0] equals `shape` for continuity. */
  shapes: string[];
  /** Which harmony scheme `shapes` was built from (for reference/debug). */
  scheme: CardScheme;
  /** Black or white, whichever reads on `background`. */
  textOnBackground: string;
  /** Black or white, whichever reads on `shape`. */
  textOnShape: string;
  /** Tetradic (h+90, h+180, h+270) hues at a vivid lightness — rotated
   * across a deck's icons so they read as a deliberate accent color. */
  iconHues: string[];
}

const RAMP_LIGHTNESS = [0.15, 0.325, 0.5, 0.675, 0.85];
// The lightness the base `shape` sits at — scheme cards share it so they read
// as one weight of color, only the hue changing.
const SHAPE_LIGHTNESS = RAMP_LIGHTNESS[1];

function buildSchemeShapes(h: number, scheme: CardScheme): string[] {
  if (scheme === "monochrome") {
    // Same hue, stepped lightness around the base shape tone.
    return [0, 0.09, -0.07, 0.16, -0.02].map((d) =>
      hslToHex(h, 1, Math.max(0.18, Math.min(0.52, SHAPE_LIGHTNESS + d))),
    );
  }
  return SCHEME_HUE_OFFSETS[scheme].map((offset) => hslToHex(h + offset, 1, SHAPE_LIGHTNESS));
}

export function buildPaletteFromSeed(seedHex: string, scheme?: CardScheme): GeneratedPalette {
  const { h } = hexToHsl(seedHex);
  const ramp = RAMP_LIGHTNESS.map((l) => hslToHex(h, 1, l));
  const background = ramp[ramp.length - 1];
  const iconHues = [90, 180, 270].map((offset) => hslToHex(h + offset, 1, 0.5));

  const chosenScheme = scheme ?? CARD_SCHEMES[hashStr(seedHex) % CARD_SCHEMES.length];
  const shapes = buildSchemeShapes(h, chosenScheme);
  const shape = shapes[0];

  return {
    background,
    shape,
    shapes,
    scheme: chosenScheme,
    textOnBackground: contrastColor(background),
    textOnShape: contrastColor(shape),
    iconHues,
  };
}
