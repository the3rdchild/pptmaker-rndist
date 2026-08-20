// Places a figure or table from an attached document into a slide.
//
// Both land in the layout's IMAGE slots, and that is deliberate. The template
// author already decided where a visual belongs on each layout and how big it
// should be; a document figure is a visual, so it inherits that decision
// instead of being dropped at some computed free spot and overlapping the
// design. A table takes the same box — the image element is swapped for a
// table element at the identical position, size and z-order.
//
// The alternative (appending the asset as a floating element) was rejected for
// exactly the reason the .pptx importer keeps geometry: anything placed
// without the layout's own coordinates looks pasted on.

import type { HeroImageMarker } from "@/components/editor-react/ai-layout-fill";
import type { Font, TableCell } from "@/components/slide-editor/types";
import type { SourceDoc, SourceDocAsset, SourceDocTable } from "@/lib/source-docs/types";
import { findSourceDocAsset } from "@/lib/source-docs/types";

type Rec = Record<string, unknown>;

/** Resolves an asset id against every attached document. Ids are unique per
 *  document, not across them, so the first match wins — which is also the
 *  order the model was shown them in. */
export function resolveAssetId(docs: SourceDoc[], id: string): SourceDocAsset | null {
	for (const doc of docs) {
		const asset = findSourceDocAsset(doc, id);
		if (asset) return asset;
	}
	return null;
}

/** Picks which photo slot an asset fill targets.
 *
 *  The model addresses slots by name, so an exact name match is preferred and
 *  repeated names are consumed in order (`used` carries the ones already
 *  claimed on this slide). When the name matches nothing — a hallucinated or
 *  paraphrased slot name — the largest free slot is used rather than dropping
 *  the asset: a figure the model asked for and did not get is the worse
 *  outcome, and the hero slot is where it would have gone anyway. */
export function pickAssetSlot(
	markers: { hero: HeroImageMarker | null; secondary: HeroImageMarker[] },
	slotName: string,
	isUsed: (marker: HeroImageMarker) => boolean,
): HeroImageMarker | null {
	const all = [...(markers.hero ? [markers.hero] : []), ...markers.secondary];
	const free = all.filter((marker) => !isUsed(marker));
	if (free.length === 0) return null;

	const wanted = slotName.trim().toLowerCase();
	const named = free.find((marker) => marker.elementName.toLowerCase() === wanted);
	return named ?? free[0];
}

/** Walks a cloned ui to the element a marker names, mirroring patchHeroImage's
 *  traversal (same-named siblings disambiguated by occurrence). Returns the
 *  live object so the caller can mutate it in place and keep its z-order. */
function elementAt(ui: Rec, marker: HeroImageMarker): Rec | null {
	const components = (ui.components as Rec[]) ?? [];
	const component = components.find((c) => c.id === marker.componentId);
	if (!component) return null;

	let seen = 0;
	let found: Rec | null = null;
	const visit = (el: Rec): boolean => {
		if (el.type === "image" && el.name === marker.elementName) {
			if (seen === marker.occurrenceIndex) {
				found = el;
				return true;
			}
			seen += 1;
			return false;
		}
		const children = el.children as Rec[] | undefined;
		if (Array.isArray(children)) return children.some(visit);
		const child = el.child as Rec | undefined;
		if (child) return visit(child);
		return false;
	};

	((component.elements as Rec[]) ?? []).some(visit);
	return found;
}

function boxOf(element: Rec): { width: number; height: number } {
	const size = element.size as Rec | undefined;
	const width = typeof size?.width === "number" ? (size.width as number) : 400;
	const height = typeof size?.height === "number" ? (size.height as number) : 260;
	return { width, height };
}

/**
 * Drops a document figure into a photo slot.
 *
 * `fit` becomes "contain", overriding whatever the template authored. Template
 * photo slots are authored for photographs, which crop harmlessly — a thesis
 * figure does not: a cropped architecture diagram loses the boxes at its
 * edges, and a cropped chart loses its axis labels. Better to letterbox.
 */
export function applyFigureToSlot(
	ui: Rec,
	marker: HeroImageMarker,
	figure: Extract<SourceDocAsset, { kind: "figure" }>,
): Rec {
	const cloned = JSON.parse(JSON.stringify(ui)) as Rec;
	const element = elementAt(cloned, marker);
	if (!element) return cloned;

	element.data = figure.dataUrl;
	element.fit = "contain";
	// A clip path shaped for a photo (a circle, a blob) would cut a diagram
	// apart; and crop/focus were authored against the photo that is gone.
	delete element.clippath;
	delete element.clip_path;
	delete element.clipPath;
	delete element.crop;
	delete element.crop_scale;
	delete element.focus_x;
	delete element.focus_y;
	// Traceability, and what the "from the document" badge in the editor reads.
	element.source_asset_id = figure.id;
	if (figure.caption) element.source_asset_caption = figure.caption;
	return cloned;
}

/* --------------------------------- tables --------------------------------- */

/** Minimum readable column width and row height on the 1280x720 stage. Past
 *  these the table stops being something an audience can read from a seat, so
 *  the grid is truncated instead of being squeezed further. */
const MIN_COLUMN_WIDTH = 88;
const MIN_ROW_HEIGHT = 24;
const MAX_ROWS = 12;
const MAX_COLUMNS = 7;

function cell(text: string, font: Font, fillColor: string): TableCell {
	return {
		alignment: "left",
		color: { color: fillColor, opacity: 1 },
		runs: [{ text, font }],
	};
}

/** How much of the table fits the slot, and what was left out. Truncation is
 *  reported so the caller can tell the user rather than silently showing a
 *  partial table as if it were the whole thing. */
export function fitTableToBox(
	table: SourceDocTable,
	box: { width: number; height: number },
): { header: string[]; rows: string[][]; droppedRows: number; droppedColumns: number } {
	const header = table.header.length > 0 ? table.header : [];
	const body = table.rows;
	const totalColumns = header.length || body[0]?.length || 0;

	const columnCapacity = Math.max(2, Math.min(MAX_COLUMNS, Math.floor(box.width / MIN_COLUMN_WIDTH)));
	const columns = Math.min(totalColumns, columnCapacity);

	const headerRows = header.length > 0 ? 1 : 0;
	const rowCapacity = Math.max(2, Math.min(MAX_ROWS, Math.floor(box.height / MIN_ROW_HEIGHT)));
	const bodyCapacity = Math.max(1, rowCapacity - headerRows);
	const rows = Math.min(body.length, bodyCapacity);

	return {
		header: header.slice(0, columns),
		rows: body.slice(0, rows).map((row) => row.slice(0, columns)),
		droppedRows: body.length - rows,
		droppedColumns: totalColumns - columns,
	};
}

/**
 * Swaps a photo slot for a table element carrying the document's table.
 *
 * The element is mutated in place inside the cloned tree rather than removed
 * and re-appended, so it keeps its position in the element list — and with it
 * its z-order relative to the layout's decorative shapes. Appending would put
 * the table on top of every overlay the template draws over its photo.
 */
export function applyTableToSlot(
	ui: Rec,
	marker: HeroImageMarker,
	table: SourceDocTable,
	options: { fontFamily?: string } = {},
): { ui: Rec; droppedRows: number; droppedColumns: number } {
	const cloned = JSON.parse(JSON.stringify(ui)) as Rec;
	const element = elementAt(cloned, marker);
	if (!element) return { ui: cloned, droppedRows: 0, droppedColumns: 0 };

	const box = boxOf(element);
	const fitted = fitTableToBox(table, box);
	const rowCount = fitted.rows.length + (fitted.header.length > 0 ? 1 : 0);
	const rowHeight = rowCount > 0 ? box.height / rowCount : MIN_ROW_HEIGHT;
	const fontSize = Math.round(Math.max(9, Math.min(16, rowHeight * 0.38)));

	const family = options.fontFamily || "Inter";
	const bodyFont: Font = { family, size: fontSize, color: "#344054", line_height: 1.2 };
	const headerFont: Font = { ...bodyFont, color: "#101323", bold: true };

	// Everything image-shaped has to go: leaving `data` behind would render the
	// old photo underneath, and clip/crop keys are meaningless on a table.
	for (const key of [
		"data",
		"url",
		"fit",
		"crop",
		"crop_scale",
		"focus_x",
		"focus_y",
		"clippath",
		"clip_path",
		"clipPath",
		"border_radius",
		"is_icon",
		"prompt",
		"credit",
		"credit_url",
		"source_url",
	]) {
		delete element[key];
	}

	element.type = "table";
	element.font = bodyFont;
	element.columns =
		fitted.header.length > 0
			? fitted.header.map((text) => cell(text, headerFont, "#F2F4F7"))
			: (fitted.rows[0] ?? []).map((text) => cell(text, headerFont, "#F2F4F7"));
	element.rows = (fitted.header.length > 0 ? fitted.rows : fitted.rows.slice(1)).map((row) =>
		row.map((text) => cell(text, bodyFont, "#FFFFFF")),
	);
	element.source_asset_id = table.id;
	if (table.caption) element.source_asset_caption = table.caption;

	return { ui: cloned, droppedRows: fitted.droppedRows, droppedColumns: fitted.droppedColumns };
}

/** The font family the slide already uses, so an inserted table doesn't
 *  introduce a third typeface into a two-typeface theme. */
export function slideFontFamily(ui: Rec): string | undefined {
	let found: string | undefined;
	const visit = (el: Rec): boolean => {
		if (el.type === "text" || el.type === "text-list") {
			const font = el.font as Rec | undefined;
			const family = typeof font?.family === "string" ? (font.family as string) : "";
			if (family) {
				found = family;
				return true;
			}
		}
		const children = el.children as Rec[] | undefined;
		if (Array.isArray(children)) return children.some(visit);
		const child = el.child as Rec | undefined;
		if (child) return visit(child);
		return false;
	};
	for (const component of ((ui.components as Rec[]) ?? [])) {
		if (((component.elements as Rec[]) ?? []).some(visit)) break;
	}
	return found;
}

/* ------------------------- fallback asset matching ------------------------ */
//
// The model is asked to name the assets it wants, and when it does, that is
// always the better placement — it knows what each slide argues. But a model
// that ignores the asset contract entirely leaves a document-backed deck with
// nothing from the document on it, which reads as the feature not working at
// all. So when NOT ONE asset was placed, the assets are matched to slides here
// instead, on caption-to-slide-text overlap.
//
// Deliberately not run when the model placed even one asset: mixing its
// judgement with a text-overlap guess is how a figure ends up on the slide the
// model already decided it did not belong on.

const STOPWORDS = new Set([
	"yang", "dan", "atau", "untuk", "pada", "dari", "dengan", "adalah", "akan",
	"dalam", "ini", "itu", "tidak", "sebagai", "oleh", "juga", "dapat",
	"the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
	"gambar", "tabel", "figure", "table",
]);

function keywords(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9À-ɏ\s]/g, " ")
			.split(/\s+/)
			.filter((word) => word.length >= 4 && !STOPWORDS.has(word)),
	);
}

/** Jaccard-ish overlap: shared keywords over the asset's own keyword count, so
 *  a short caption isn't penalised for a slide that says much more. */
export function matchScore(assetText: string, slideText: string): number {
	const assetWords = keywords(assetText);
	if (assetWords.size === 0) return 0;
	const slideWords = keywords(slideText);
	let shared = 0;
	for (const word of assetWords) if (slideWords.has(word)) shared += 1;
	return shared / assetWords.size;
}

/** Below this, the overlap is coincidence — better an unrelated stock photo
 *  than a figure that contradicts the slide it sits on. */
const MATCH_THRESHOLD = 0.25;

export interface AssetMatchCandidate {
	slideIndex: number;
	/** All the copy on that slide, concatenated. */
	text: string;
}

/** One asset per slide, best pairs first, nothing below the threshold. */
export function matchAssetsToSlides(
	assets: SourceDocAsset[],
	slides: AssetMatchCandidate[],
): { slideIndex: number; asset: SourceDocAsset }[] {
	const scored: { slideIndex: number; asset: SourceDocAsset; score: number }[] = [];
	for (const asset of assets) {
		const assetText = `${asset.caption} ${asset.context}`.trim();
		if (!assetText) continue;
		for (const slide of slides) {
			const score = matchScore(assetText, slide.text);
			if (score >= MATCH_THRESHOLD) scored.push({ slideIndex: slide.slideIndex, asset, score });
		}
	}
	scored.sort((a, b) => b.score - a.score);

	const takenSlides = new Set<number>();
	const takenAssets = new Set<string>();
	const chosen: { slideIndex: number; asset: SourceDocAsset }[] = [];
	for (const entry of scored) {
		if (takenSlides.has(entry.slideIndex) || takenAssets.has(entry.asset.id)) continue;
		takenSlides.add(entry.slideIndex);
		takenAssets.add(entry.asset.id);
		chosen.push({ slideIndex: entry.slideIndex, asset: entry.asset });
	}
	return chosen;
}

/** Applies whichever asset kind was resolved, in one call. */
export function applySourceAsset(
	ui: Rec,
	marker: HeroImageMarker,
	asset: SourceDocAsset,
): { ui: Rec; droppedRows: number; droppedColumns: number } {
	if (asset.kind === "figure") {
		return { ui: applyFigureToSlot(ui, marker, asset), droppedRows: 0, droppedColumns: 0 };
	}
	return applyTableToSlot(ui, marker, asset, { fontFamily: slideFontFamily(ui) });
}
