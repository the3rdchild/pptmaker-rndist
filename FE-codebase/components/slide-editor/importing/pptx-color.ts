// -------------------------------------------------------------------- colors

import { asRecord } from "@/components/slide-editor/model/core";
import { rgbToHex } from "@/lib/color-conversion";
import {
  asArray,
  clamp01,
  clampByte,
  readAttrNumber,
  readAttrString,
  round2,
} from "@/components/slide-editor/importing/pptx-xml-read";
import {
  type GeoContext,
  type Rec,
  type ThemeContext,
} from "@/components/slide-editor/importing/pptx-context";

/** Reads whichever colour choice a fill/reference element carries, applying
 * the DrawingML colour transforms (alpha/lum/shade/tint) layered on top. */
export function colorOf(container: Rec | null, theme: ThemeContext | null): { color: string; opacity: number } | null {
  if (!container) return null;

  const srgb = asRecord(container["a:srgbClr"]);
  const scheme = asRecord(container["a:schemeClr"]);
  const sys = asRecord(container["a:sysClr"]);
  const scrgb = asRecord(container["a:scrgbClr"]);
  const node = srgb ?? scheme ?? sys ?? scrgb;
  if (!node) return null;

  let base: string | null = null;
  if (srgb) {
    const val = readAttrString(srgb, "@_val");
    base = val ? `#${val.toUpperCase()}` : null;
  } else if (scheme) {
    base = schemeColor(readAttrString(scheme, "@_val"), theme);
  } else if (sys) {
    const val = readAttrString(sys, "@_lastClr");
    base = val ? `#${val.toUpperCase()}` : null;
  } else if (scrgb) {
    const r = readAttrNumber(scrgb, "@_r");
    const g = readAttrNumber(scrgb, "@_g");
    const b = readAttrNumber(scrgb, "@_b");
    if (r != null && g != null && b != null) {
      base = rgbToHex([
        Math.round((r / 100000) * 255),
        Math.round((g / 100000) * 255),
        Math.round((b / 100000) * 255),
      ]);
    }
  }
  if (!base) return null;

  let rgb = hexToRgb(base);
  const lumMod = readAttrNumber(asRecord(node["a:lumMod"]), "@_val");
  const lumOff = readAttrNumber(asRecord(node["a:lumOff"]), "@_val");
  const shade = readAttrNumber(asRecord(node["a:shade"]), "@_val");
  const tint = readAttrNumber(asRecord(node["a:tint"]), "@_val");
  if (lumMod != null || lumOff != null) rgb = applyLuminance(rgb, lumMod, lumOff);
  if (shade != null) rgb = rgb.map((c) => clampByte(c * (shade / 100000))) as [number, number, number];
  if (tint != null) {
    const k = tint / 100000;
    rgb = rgb.map((c) => clampByte(c * k + 255 * (1 - k))) as [number, number, number];
  }

  const alpha = readAttrNumber(asRecord(node["a:alpha"]), "@_val");
  return { color: rgbToHex(rgb), opacity: alpha == null ? 1 : clamp01(alpha / 100000) };
}

function schemeColor(val: string | null, theme: ThemeContext | null): string | null {
  if (!val || !theme) return null;
  // bg1/tx1/bg2/tx2 are indirections the master's colour map resolves.
  const mapped = theme.clrMap[val] ?? val;
  return theme.colors.get(mapped) ?? theme.colors.get(val) ?? null;
}

/** Solid fill, or a gradient approximated by its first stop — a flat colour in
 * roughly the right hue beats the grey placeholder a dropped fill produced. */
export function fillOf(spPr: Rec | null, theme: ThemeContext | null): { color: string; opacity: number } | null {
  if (!spPr) return null;
  if (spPr["a:noFill"] !== undefined) return null;
  const solid = colorOf(asRecord(spPr["a:solidFill"]), theme);
  if (solid) return solid;
  const stops = asArray(asRecord(asRecord(spPr["a:gradFill"])?.["a:gsLst"])?.["a:gs"]);
  for (const stop of stops) {
    const color = colorOf(asRecord(stop), theme);
    if (color) return color;
  }
  return null;
}

export function strokeOf(
  ln: Rec | null,
  theme: ThemeContext | null,
  geo: GeoContext,
): { color: string; opacity: number; width: number; dash?: number[] } | null {
  if (!ln) return null;
  if (ln["a:noFill"] !== undefined) return null;
  const color = colorOf(asRecord(ln["a:solidFill"]), theme);
  if (!color) return null;
  const widthEmu = readAttrNumber(ln, "@_w");
  const width = widthEmu ? Math.max(1, Math.round(widthEmu * geo.scale)) : 1;
  const dash = dashOf(ln, width);
  return { ...color, width, ...(dash ? { dash } : {}) };
}

/** ECMA-376 preset dash patterns, as multiples of the line width — which is
 * how PowerPoint defines them, so a thick dashed line gets proportionally
 * longer dashes rather than the same dashes as a hairline. */
const PRESET_DASH: Record<string, number[]> = {
  dot: [1, 3],
  dash: [4, 3],
  lgDash: [8, 3],
  dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** Dash pattern in canvas px, or null for a solid line. Both the preset
 * (`a:prstDash`) and custom (`a:custDash`) forms are expressed relative to the
 * line width, so the px pattern is only known once the width is scaled. */
function dashOf(ln: Rec, width: number): number[] | null {
  const preset = readAttrString(asRecord(ln["a:prstDash"]), "@_val");
  if (preset && preset !== "solid") {
    const pattern = PRESET_DASH[preset];
    if (pattern) return pattern.map((n) => round2(n * width));
  }

  // <a:custDash><a:ds d="400000" sp="300000"/>… — d/sp are 1000ths of a
  // percent of the line width, alternating dash then gap.
  const stops = asArray(asRecord(ln["a:custDash"])?.["a:ds"]);
  const custom: number[] = [];
  for (const stop of stops) {
    const rec = asRecord(stop);
    const d = readAttrNumber(rec, "@_d");
    const sp = readAttrNumber(rec, "@_sp");
    if (d == null || sp == null) continue;
    custom.push(round2((d / 100000) * width), round2((sp / 100000) * width));
  }
  return custom.length ? custom : null;
}

/** PowerPoint shapes very often carry no explicit fill and get their colour
 * from the theme's style matrix instead (`p:style`). The indexed matrix entry
 * isn't resolved here, but its colour reference is — which is the part that
 * actually determines what the shape looks like. */
export function styleRefFill(node: Rec, theme: ThemeContext | null): { color: string; opacity: number } | null {
  return colorOf(asRecord(asRecord(node["p:style"])?.["a:fillRef"]), theme);
}

export function styleRefStroke(
  node: Rec,
  theme: ThemeContext | null,
): { color: string; opacity: number; width: number } | null {
  const color = colorOf(asRecord(asRecord(node["p:style"])?.["a:lnRef"]), theme);
  return color ? { ...color, width: 1 } : null;
}

export function styleRefFontColor(node: Rec, theme: ThemeContext | null): { color: string; opacity: number } | null {
  return colorOf(asRecord(asRecord(node["p:style"])?.["a:fontRef"]), theme);
}

function applyLuminance(
  rgb: [number, number, number],
  lumMod: number | null,
  lumOff: number | null,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(rgb);
  let lum = l;
  if (lumMod != null) lum *= lumMod / 100000;
  if (lumOff != null) lum += lumOff / 100000;
  return hslToRgb(h, s, clamp01(lum));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    clampByte(channel(h + 1 / 3) * 255),
    clampByte(channel(h) * 255),
    clampByte(channel(h - 1 / 3) * 255),
  ];
}
