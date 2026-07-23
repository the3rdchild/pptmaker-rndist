// LaTeX -> SVG rendering for the "formula" slide element. Uses MathJax's
// component-less "lite" pipeline (no real DOM needed) with SVG output, since
// that's the only MathJax output mode that produces a standalone <svg> we can
// embed directly as a Konva.Image (unlike KaTeX, which renders HTML+CSS and
// would need an extra html-to-image/html2canvas rasterization step).
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

// fontCache "none" makes every conversion self-contained (glyph paths inlined
// instead of shared <defs> refs) — required since each formula becomes its
// own standalone data: URI, with no shared document to hold a glyph cache.
const texInputJax = new TeX({ packages: AllPackages });
const svgOutputJax = new SVG({ fontCache: "none" });
const mathDocument = mathjax.document("", {
  InputJax: texInputJax,
  OutputJax: svgOutputJax,
});

export type LatexSvgResult = {
  svg: string;
  /** Intrinsic width/height in the SVG's own viewBox units — only their ratio matters. */
  width: number;
  height: number;
};

const cache = new Map<string, LatexSvgResult | null>();

/** Converts a LaTeX source string to a self-contained SVG markup string plus
 * its intrinsic aspect ratio. Returns null if the source is empty or fails
 * to parse (e.g. unbalanced braces while the user is still typing). */
export function latexToSvg(latex: string): LatexSvgResult | null {
  const trimmed = latex.trim();
  if (!trimmed) return null;
  const cached = cache.get(trimmed);
  if (cached !== undefined) return cached;

  let result: LatexSvgResult | null = null;
  try {
    const node = mathDocument.convert(trimmed, { display: true });
    const svgNode =
      adaptor.childNodes(node).find((child) => adaptor.kind(child) === "svg") ??
      adaptor.firstChild(node);
    if (svgNode) {
      const markup = adaptor.outerHTML(svgNode as never);
      // viewBox is "minX minY width height" — minX/minY are frequently
      // negative (baseline-relative), so only the trailing width/height pair
      // is captured.
      const viewBoxMatch = markup.match(
        /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/,
      );
      result = {
        svg: markup,
        width: viewBoxMatch ? Number(viewBoxMatch[1]) : 100,
        height: viewBoxMatch ? Number(viewBoxMatch[2]) : 100,
      };
    }
  } catch {
    result = null;
  }

  cache.set(trimmed, result);
  return result;
}

/** Stamps explicit pixel width/height (MathJax emits `ex` units, which
 * resolve inconsistently once the SVG is detached into its own data: URI)
 * and a `color` presentation attribute (MathJax's SVG paths use
 * `fill="currentColor"`/`stroke="currentColor"`, which — per the SVG spec —
 * resolves against the nearest `color` attribute even with no CSS cascade). */
export function sizedColoredSvg(
  svg: string,
  pixelWidth: number,
  pixelHeight: number,
  color: string,
): string {
  return svg
    .replace(/width="[^"]*"/, `width="${Math.max(1, Math.round(pixelWidth))}"`)
    .replace(/height="[^"]*"/, `height="${Math.max(1, Math.round(pixelHeight))}"`)
    .replace("<svg ", `<svg color="${color}" `);
}
