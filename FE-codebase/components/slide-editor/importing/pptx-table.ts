import { asRecord } from "@/components/slide-editor/model/core";
import {
  asArray,
  readAttrNumber,
  readAttrString,
  readText,
  round4,
} from "@/components/slide-editor/importing/pptx-xml-read";
import { fillOf } from "@/components/slide-editor/importing/pptx-color";
import { horizontalAlignment, levelProperties, runFont } from "@/components/slide-editor/importing/pptx-text-runs";
import { shapeBox, shapeRotation, withRotation } from "@/components/slide-editor/importing/pptx-shape-frame";
import {
  type BuiltElement,
  type NodeTransform,
  type PartContext,
  type Rec,
} from "@/components/slide-editor/importing/pptx-context";

/** A `p:graphicFrame` holding `a:tbl`. Other graphic data (charts, SmartArt)
 * returns null and stays counted as skipped. Note the frame states its
 * geometry in `p:xfrm`, not the `p:spPr/a:xfrm` every other shape uses. */
export function buildTable(node: Rec, ctx: PartContext, transform: NodeTransform): BuiltElement | null {
  const data = asRecord(asRecord(node["a:graphic"])?.["a:graphicData"]);
  const tbl = asRecord(data?.["a:tbl"]);
  if (!tbl) return null;

  const box = shapeBox({ "a:xfrm": node["p:xfrm"] }, ctx.deck.geo, transform);
  if (!box) return null;

  const grid = asArray(asRecord(tbl["a:tblGrid"])?.["a:gridCol"]);
  const columnWidths = grid.map((col) => readAttrNumber(asRecord(col), "@_w") ?? 0);

  const trs = asArray(tbl["a:tr"]);
  const rowHeights = trs.map((tr) => readAttrNumber(asRecord(tr), "@_h") ?? 0);
  const rows = trs.map((tr) =>
    asArray(asRecord(tr)?.["a:tc"]).map((tc) => tableCell(asRecord(tc), ctx)),
  );
  if (rows.length === 0) return null;

  // The editor's table always carries a header row separately from the body.
  const [header, ...body] = rows;
  return {
    el: withRotation(
      {
        type: "table",
        columns: header,
        rows: body,
        ...fractions("column_widths", columnWidths),
        ...fractions("row_heights", rowHeights),
      },
      shapeRotation({ "a:xfrm": node["p:xfrm"] }),
    ),
    box,
  };
}

/** Absolute EMU track sizes as the fractions the table model wants. Dropped
 * entirely when the source gave no usable sizes, so the table falls back to
 * equal tracks rather than collapsing to zero. */
function fractions(key: string, values: number[]): Rec {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return {};
  return { [key]: values.map((value) => round4(value / total)) };
}

function tableCell(tc: Rec | null, ctx: PartContext): Rec {
  const txBody = asRecord(tc?.["a:txBody"]);
  const runs: Rec[] = [];
  let font: Rec | null = null;
  let align: string | null = null;

  const listStyle = asRecord(txBody?.["a:lstStyle"]);
  for (const p of asArray(txBody?.["a:p"])) {
    const para = asRecord(p);
    if (!para) continue;
    const pPr = asRecord(para["a:pPr"]);
    const levelStyle = levelProperties(listStyle, readAttrNumber(pPr, "@_lvl") ?? 0);
    const defaults = asRecord(pPr?.["a:defRPr"]) ?? asRecord(levelStyle?.["a:defRPr"]);
    if (align == null) align = readAttrString(pPr, "@_algn");

    const before = runs.length;
    for (const r of asArray(para["a:r"])) {
      const run = asRecord(r);
      if (!run) continue;
      const text = readText(run["a:t"]);
      if (!text) continue;
      const runFontRecord = runFont(asRecord(run["a:rPr"]), defaults, ctx, null);
      if (!font && runFontRecord) font = runFontRecord;
      runs.push(runFontRecord ? { text, font: runFontRecord } : { text });
    }
    // Paragraphs inside one cell are separate lines, not separate cells.
    if (before > 0 && runs.length > before) runs.splice(before, 0, { text: "\n" });
  }

  const tcPr = asRecord(tc?.["a:tcPr"]);
  const color = fillOf(tcPr, ctx.theme);
  // gridSpan/rowSpan sit on the anchor cell; the positions it covers stay in
  // the grid as the empty hMerge/vMerge cells the source already provides.
  const colSpan = readAttrNumber(tc, "@_gridSpan");
  const rowSpan = readAttrNumber(tc, "@_rowSpan");

  return {
    runs,
    ...(font ? { font } : {}),
    ...(color ? { color } : {}),
    ...(align && horizontalAlignment(align) ? { alignment: horizontalAlignment(align) } : {}),
    ...(colSpan && colSpan > 1 ? { colSpan } : {}),
    ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
  };
}
