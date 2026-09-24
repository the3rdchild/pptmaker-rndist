import { asRecord } from "@/components/slide-editor/model/core";
import {
  asArray,
  readAttrBoolean,
  readAttrNumber,
  readAttrString,
  readText,
  round2,
} from "@/components/slide-editor/importing/pptx-xml-read";
import { colorOf, fillOf, styleRefFontColor } from "@/components/slide-editor/importing/pptx-color";
import {
  type Box,
  type GeoContext,
  type PartContext,
  type Rec,
  type ThemeContext,
} from "@/components/slide-editor/importing/pptx-context";

const EMU_PER_INCH = 914400;
const EMU_PER_POINT = EMU_PER_INCH / 72;

// ---------------------------------------------------------------------- text

/** `hasBackdrop` is set when the shape's own outline was already emitted as a
 * separate element underneath — the fill belongs to that, not to the text. */
export function textElement(node: Rec, ctx: PartContext, box: Box, hasBackdrop = false): Rec | null {
  const txBody = asRecord(node["p:txBody"]);
  if (!txBody) return null;

  const bodyPr = asRecord(txBody["a:bodyPr"]);
  const listStyle = asRecord(txBody["a:lstStyle"]);
  // PowerPoint's own shrink-to-fit. Ignoring it renders text at its authored
  // size in a box the author had already let PowerPoint shrink it to fit, so
  // it overflows here while looking fine in the source.
  const autofit = asRecord(bodyPr?.["a:normAutofit"]);
  const fontScale = (readAttrNumber(autofit, "@_fontScale") ?? 100000) / 100000;
  const lineReduction = (readAttrNumber(autofit, "@_lnSpcReduction") ?? 0) / 100000;
  const styleColor = styleRefFontColor(node, ctx.theme);

  let firstFont: Rec | null = null;
  let firstFontPt: number | null = null;
  let lineSpacing: { pct?: number; pts?: number } | null = null;
  let align: string | null = null;

  // Paragraphs are collected separately so trailing empty ones (very common —
  // they only exist to hold cursor state) don't leave stray blank lines, and
  // so a shape whose paragraphs are all bulleted can become a real list.
  const paragraphs: { runs: Rec[]; bullet: Bullet }[] = [];
  for (const p of asArray(txBody["a:p"])) {
    const para = asRecord(p);
    if (!para) continue;
    const pPr = asRecord(para["a:pPr"]);
    // Run properties are inherited from the list style entry for the
    // paragraph's OWN level. Reading lvl1pPr for every paragraph, as this did,
    // gives an indented sub-point the size and colour of a top-level one.
    const levelStyle = levelProperties(listStyle, readAttrNumber(pPr, "@_lvl") ?? 0);
    const paraDefaults = asRecord(pPr?.["a:defRPr"]) ?? asRecord(levelStyle?.["a:defRPr"]);
    if (align == null) align = readAttrString(pPr, "@_algn") ?? readAttrString(levelStyle, "@_algn");
    if (lineSpacing == null) lineSpacing = lineSpacingOf(pPr) ?? lineSpacingOf(levelStyle);

    const current: Rec[] = [];
    for (const r of asArray(para["a:r"])) {
      const run = asRecord(r);
      if (!run) continue;
      const text = readText(run["a:t"]);
      if (!text) continue;
      const rPr = asRecord(run["a:rPr"]);
      const sizePt = readAttrNumber(rPr, "@_sz") ?? readAttrNumber(paraDefaults, "@_sz");
      const font = runFont(rPr, paraDefaults, ctx, styleColor, fontScale);
      if (!firstFont && font) {
        firstFont = font;
        firstFontPt = sizePt == null ? null : (sizePt / 100) * fontScale;
      }
      current.push(font ? { text, font } : { text });
    }
    paragraphs.push({ runs: current, bullet: bulletOf(pPr, levelStyle) });
  }
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].runs.length === 0) {
    paragraphs.pop();
  }

  const filled = paragraphs.filter((paragraph) => paragraph.runs.length > 0);
  if (filled.length === 0) return null;

  const lineHeight = lineHeightOf(lineSpacing, firstFontPt, lineReduction);
  const elementFont: Rec = { ...(firstFont ?? {}) };
  if (lineHeight != null) elementFont.line_height = lineHeight;

  const alignment: Rec = {};
  const horizontal = horizontalAlignment(align);
  const vertical = verticalAlignment(readAttrString(bodyPr, "@_anchor"));
  if (horizontal) alignment.horizontal = horizontal;
  if (vertical) alignment.vertical = vertical;

  const fill = hasBackdrop ? null : fillOf(asRecord(node["p:spPr"]), ctx.theme);
  const common = {
    ...(Object.keys(elementFont).length ? { font: elementFont } : {}),
    ...(Object.keys(alignment).length ? { alignment } : {}),
    ...(fill ? { fill } : {}),
    size: { width: box.width, height: box.height },
  };

  // A shape whose paragraphs are ALL bulleted the same way is a list, and
  // becomes one — the list element draws its own markers with a hanging
  // indent, which is what the source looks like. Bullets used to be dropped
  // outright, leaving an unmarked block of lines.
  const marker = uniformMarker(filled);
  if (marker) {
    return {
      type: "text-list",
      marker,
      items: filled.map((paragraph) => paragraph.runs),
      ...common,
    };
  }

  // Mixed or partial bullets can't be one list, so the marker is written into
  // the text — still visibly a bullet, and still one editable block.
  const runs: Rec[] = [];
  // Auto-numbering counts NUMBERED paragraphs only. Using the paragraph index
  // would let a heading or a blank spacer above the list push the first item
  // to "2.".
  let numbered = 0;
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) runs.push({ text: "\n" });
    if (paragraph.runs.length === 0) return;
    const prefix = bulletPrefix(paragraph.bullet, numbered);
    if (paragraph.bullet.kind === "number") numbered += 1;
    if (prefix) runs.push({ text: prefix, ...(paragraph.runs[0].font ? { font: paragraph.runs[0].font } : {}) });
    runs.push(...paragraph.runs);
  });

  return { type: "text", runs, ...common };
}

/** How a paragraph is marked. `none` covers both "no bullet properties at
 * all" and an explicit `a:buNone`. */
type Bullet =
  | { kind: "none" }
  | { kind: "char"; char: string }
  | { kind: "number"; scheme: string; startAt: number };

/** The list-style entry for a paragraph's outline level (`lvl` is 0-based,
 * the elements are named from 1). Falls back to level 1, which is what a
 * shape with a single lstStyle entry means for all its levels. */
export function levelProperties(listStyle: Rec | null, level: number): Rec | null {
  if (!listStyle) return null;
  const clamped = Math.max(0, Math.min(8, level));
  return (
    asRecord(listStyle[`a:lvl${clamped + 1}pPr`]) ?? asRecord(listStyle["a:lvl1pPr"])
  );
}

function bulletOf(pPr: Rec | null, levelStyle: Rec | null): Bullet {
  for (const source of [pPr, levelStyle]) {
    if (!source) continue;
    if (source["a:buNone"] !== undefined) return { kind: "none" };
    const char = readAttrString(asRecord(source["a:buChar"]), "@_char");
    if (char) return { kind: "char", char };
    const auto = asRecord(source["a:buAutoNum"]);
    if (auto) {
      return {
        kind: "number",
        scheme: readAttrString(auto, "@_type") ?? "arabicPeriod",
        startAt: readAttrNumber(auto, "@_startAt") ?? 1,
      };
    }
  }
  return { kind: "none" };
}

/** "bullet"/"number" when every paragraph carries the same kind of marker,
 * otherwise null — a partly-bulleted shape is not a list. */
function uniformMarker(paragraphs: { bullet: Bullet }[]): "bullet" | "number" | null {
  if (paragraphs.length < 2) return null;
  const first = paragraphs[0].bullet.kind;
  if (first === "none") return null;
  if (paragraphs.some((paragraph) => paragraph.bullet.kind !== first)) return null;
  return first === "char" ? "bullet" : "number";
}

function bulletPrefix(bullet: Bullet, index: number): string | null {
  if (bullet.kind === "char") return `${bullet.char} `;
  if (bullet.kind === "number") return `${autoNumberLabel(bullet.scheme, bullet.startAt + index)} `;
  return null;
}

/** `a:buAutoNum`'s numbering schemes, of which only the shape of the label
 * matters here — the sequence itself is positional. */
function autoNumberLabel(scheme: string, value: number): string {
  const body = scheme.startsWith("alphaLc")
    ? alphaLabel(value).toLowerCase()
    : scheme.startsWith("alphaUc")
      ? alphaLabel(value)
      : scheme.startsWith("romanLc")
        ? romanLabel(value).toLowerCase()
        : scheme.startsWith("romanUc")
          ? romanLabel(value)
          : String(value);
  if (scheme.endsWith("ParenBoth")) return `(${body})`;
  if (scheme.endsWith("ParenR")) return `${body})`;
  return `${body}.`;
}

function alphaLabel(value: number): string {
  let remaining = Math.max(1, value);
  let label = "";
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

function romanLabel(value: number): string {
  const numerals: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = Math.max(1, value);
  let label = "";
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      label += numeral;
      remaining -= amount;
    }
  }
  return label;
}

export function runFont(
  rPr: Rec | null,
  defaults: Rec | null,
  ctx: PartContext,
  styleColor: { color: string; opacity: number } | null,
  fontScale = 1,
): Rec | null {
  const font: Rec = {};
  const sizePt = readAttrNumber(rPr, "@_sz") ?? readAttrNumber(defaults, "@_sz");
  if (sizePt != null) font.size = fontPx(sizePt * fontScale, ctx.deck.geo);

  const bold = readAttrBoolean(rPr, "@_b") ?? readAttrBoolean(defaults, "@_b");
  if (bold) font.bold = true;
  const italic = readAttrBoolean(rPr, "@_i") ?? readAttrBoolean(defaults, "@_i");
  if (italic) font.italic = true;
  const underline = readAttrString(rPr, "@_u") ?? readAttrString(defaults, "@_u");
  if (underline && underline !== "none") font.underline = true;

  const color =
    (rPr ? colorOf(asRecord(rPr["a:solidFill"]), ctx.theme) : null) ??
    (defaults ? colorOf(asRecord(defaults["a:solidFill"]), ctx.theme) : null) ??
    styleColor;
  if (color) {
    font.color = color.color;
    if (color.opacity < 1) font.opacity = color.opacity;
  }

  const family = fontFamilyOf(rPr, ctx.theme) ?? fontFamilyOf(defaults, ctx.theme);
  if (family) font.family = family;

  // Character spacing (`spc`, 1/100 pt) — without it text reflows wider than
  // PowerPoint's own rendering (tight tracking makes headlines fit one line
  // there, wrap here).
  const spacing = readAttrNumber(rPr, "@_spc") ?? readAttrNumber(defaults, "@_spc");
  if (spacing != null) font.letter_spacing = letterSpacingPx(spacing, ctx.deck.geo);

  return Object.keys(font).length ? font : null;
}

/** Point sizes are relative to the source slide, so they scale by exactly the
 * same factor as every position and length on it. */
function fontPx(sizeHundredthsPt: number, geo: GeoContext): number {
  return Math.max(1, Math.round((sizeHundredthsPt / 100) * EMU_PER_POINT * geo.scale));
}

/** Character spacing scales like any other length — but unlike fontPx it may
 * be zero or negative (tighter-than-default tracking), so no clamp-to-1. */
function letterSpacingPx(spcHundredthsPt: number, geo: GeoContext): number {
  return round2((spcHundredthsPt / 100) * EMU_PER_POINT * geo.scale);
}

function fontFamilyOf(rPr: Rec | null, theme: ThemeContext | null): string | null {
  const typeface = readAttrString(asRecord(rPr?.["a:latin"]), "@_typeface");
  if (!typeface) return null;
  if (typeface === "+mj-lt") return theme?.majorFont ?? null;
  if (typeface === "+mn-lt") return theme?.minorFont ?? null;
  return typeface;
}

function lineSpacingOf(pPr: Rec | null): { pct?: number; pts?: number } | null {
  const lnSpc = asRecord(pPr?.["a:lnSpc"]);
  if (!lnSpc) return null;
  const pct = readAttrNumber(asRecord(lnSpc["a:spcPct"]), "@_val");
  if (pct != null) return { pct: pct / 100000 };
  const pts = readAttrNumber(asRecord(lnSpc["a:spcPts"]), "@_val");
  if (pts != null) return { pts: pts / 100 };
  return null;
}

/** Exact (`spcPts`) line spacing is an absolute point height, so it only maps
 * onto the editor's multiplier once divided by the font size it applies to. */
function lineHeightOf(
  spacing: { pct?: number; pts?: number } | null,
  fontPt: number | null,
  /** `a:normAutofit/@lnSpcReduction` — the share of line spacing PowerPoint
   *  already took out to make the text fit its box. */
  reduction = 0,
): number | null {
  const scale = 1 - Math.max(0, Math.min(0.9, reduction));
  if (!spacing) return reduction > 0 ? round2(1.2 * scale) : null;
  if (spacing.pct != null) return round2(spacing.pct * scale);
  if (spacing.pts != null && fontPt && fontPt > 0) return round2((spacing.pts / fontPt) * scale);
  return null;
}

export function horizontalAlignment(algn: string | null): string | null {
  switch (algn) {
    case "ctr": return "center";
    case "r": return "right";
    case "l": case "just": case "justLow": case "dist": return "left";
    default: return null;
  }
}

function verticalAlignment(anchor: string | null): string | null {
  switch (anchor) {
    case "ctr": return "middle";
    case "b": return "bottom";
    case "t": return "top";
    default: return null;
  }
}
