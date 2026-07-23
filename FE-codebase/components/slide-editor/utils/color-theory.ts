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

export interface GeneratedPalette {
  /** Very light wash — the slide's own page background. */
  background: string;
  /** Vivid mid-dark tone — card/shape accents. */
  shape: string;
  /** Black or white, whichever reads on `background`. */
  textOnBackground: string;
  /** Black or white, whichever reads on `shape`. */
  textOnShape: string;
  /** Tetradic (h+90, h+180, h+270) hues at a vivid lightness — rotated
   * across a deck's icons so they read as a deliberate accent color. */
  iconHues: string[];
}

const RAMP_LIGHTNESS = [0.15, 0.325, 0.5, 0.675, 0.85];

export function buildPaletteFromSeed(seedHex: string): GeneratedPalette {
  const { h } = hexToHsl(seedHex);
  const ramp = RAMP_LIGHTNESS.map((l) => hslToHex(h, 1, l));
  const shape = ramp[1];
  const background = ramp[ramp.length - 1];
  const iconHues = [90, 180, 270].map((offset) => hslToHex(h + offset, 1, 0.5));

  return {
    background,
    shape,
    textOnBackground: contrastColor(background),
    textOnShape: contrastColor(shape),
    iconHues,
  };
}
