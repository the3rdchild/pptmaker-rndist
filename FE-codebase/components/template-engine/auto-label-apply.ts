// Client side of auto-label: collect a page's fillable text elements into the
// compact payload the API route expects, and write the model's labels back
// into a cloned ui by element address.
//
// Addressing mirrors buildElementOutline (componentIndex + elementPath over
// children/elements/child) so what the panel lists is exactly what gets
// written.

import type {
	AutoLabelElementInput,
	AutoLabelResult,
} from "@/lib/templates/auto-label";
import { parseSlotMeta, type SlotMeta } from "@/components/slide-editor/templates/slot-meta";
import {
	rawFont,
	layoutRenderTextRuns,
	lineRenderHeight,
	type RenderTextRun,
} from "@/components/slide-editor/text/template-v2-text";

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Mirrors element-outline.ts childItems so paths stay in sync. */
function childItems(element: Rec): Rec[] | null {
	if (Array.isArray(element.children)) return element.children as Rec[];
	if (Array.isArray(element.elements)) return element.elements as Rec[];
	if (isRecord(element.child)) return [element.child];
	return null;
}

function previewText(element: Rec): string | null {
	const runs = element.runs;
	if (Array.isArray(runs)) {
		const text = runs
			.map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
			.join("")
			.trim();
		if (text) return text;
	}
	const items = element.items;
	if (Array.isArray(items) && Array.isArray(items[0])) {
		const text = (items[0] as unknown[])
			.map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
			.join("")
			.trim();
		if (text) return text;
	}
	return null;
}

function fontSizeOf(element: Rec): number | null {
	const font = isRecord(element.font) ? element.font : null;
	const size = font?.size ?? (Array.isArray(element.runs) && isRecord(element.runs[0]) && isRecord(element.runs[0].font) ? (element.runs[0].font as Rec).size : null);
	const n = Number(size);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function boxOf(element: Rec): { x: number; y: number; width: number; height: number } | null {
	const pos = isRecord(element.position) ? element.position : null;
	const size = isRecord(element.size) ? element.size : null;
	if (!size) return null;
	const width = Number(size.width);
	const height = Number(size.height);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	return {
		x: Number(pos?.x) || 0,
		y: Number(pos?.y) || 0,
		width,
		height,
	};
}

/** One-line description of a chart element's current data, so the model knows
 *  what it's labelling without seeing the raw dataset. */
function chartSummary(element: Rec): string {
	const type = typeof element.chart_type === "string" ? element.chart_type : "bar";
	const categories = Array.isArray(element.categories) ? element.categories.length : 0;
	const series = Array.isArray(element.series) ? element.series.length : 0;
	const parts = [`${type} chart`];
	if (categories > 0) parts.push(`${categories} categories`);
	if (series > 0) parts.push(`${series} series`);
	return parts.join(", ");
}

/** MEASURED text budgets — wraps a probe string through the same line-layout
 *  the renderer uses and finds the largest word count that still fits the
 *  element's box at its authored font size. Deterministic, unlike asking the
 *  model to eyeball pixels. Returns nulls when the box/font is unknown or the
 *  measure stack isn't available (non-browser). */
function measureTextBudgets(element: Rec): { max_words: number | null; max_lines: number | null } {
	const empty = { max_words: null, max_lines: null };
	try {
		const size = isRecord(element.size) ? element.size : null;
		const width = Number(size?.width);
		const height = Number(size?.height);
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return empty;
		const font = rawFont(element as never);
		if (!font || !Number.isFinite(font.size) || font.size <= 0) return empty;

		// "ipsum" ≈ an average-length word — probing with real wrapping beats
		// any chars-per-line heuristic because fonts and tracking differ.
		let fitWords = 0;
		let fitLines = 0;
		for (let n = 4; n <= 400; n += 4) {
			const runs: RenderTextRun[] = [{ text: Array(n).fill("ipsum").join(" "), font }];
			const lines = layoutRenderTextRuns(runs, width, undefined);
			const total = lines.reduce((sum, line) => sum + lineRenderHeight(line, font.lineHeight), 0);
			if (total <= height) {
				fitWords = n;
				fitLines = lines.length;
			} else {
				break;
			}
		}
		return { max_words: fitWords || null, max_lines: fitLines || null };
	} catch {
		return empty;
	}
}

export interface LabelTarget {
	address: { componentIndex: number; elementPath: number[] };
	input: AutoLabelElementInput;
}

/** Every fillable (non-decorative text/text-list) element on the page, in
 *  document order, with the compact descriptor the model sees. */
export function collectLabelTargets(ui: Rec | null): LabelTarget[] {
	if (!ui) return [];
	const components = Array.isArray(ui.components) ? (ui.components as Rec[]) : [];
	const targets: LabelTarget[] = [];

	components.forEach((component, componentIndex) => {
		if (!isRecord(component)) return;
		const elements = Array.isArray(component.elements) ? (component.elements as Rec[]) : [];

		const walk = (items: Rec[], path: number[]) => {
			items.forEach((element, index) => {
				if (!isRecord(element)) return;
				const elementPath = [...path, index];
				const type = typeof element.type === "string" ? element.type : "";

				const isText = type === "text" || type === "text-list";
				const isChart = type === "chart";
				if ((isText || isChart) && element.decorative !== true) {
					const measured = isText ? measureTextBudgets(element) : null;
					targets.push({
						address: { componentIndex, elementPath },
						input: {
							i: targets.length,
							type,
							current_name: typeof element.name === "string" ? element.name : null,
							sample_text: isChart ? chartSummary(element) : previewText(element),
							font_size: isChart ? null : fontSizeOf(element),
							box: boxOf(element),
							current_slot: parseSlotMeta(element.slot),
							measured_max_words: measured?.max_words ?? null,
							measured_max_lines: measured?.max_lines ?? null,
						},
					});
				}

				const children = childItems(element);
				if (children) walk(children, elementPath);
			});
		};

		walk(elements, []);
	});

	return targets;
}

/** Navigates the cloned ui to one addressed element. Returns null when the
 *  address no longer resolves (page changed while the request was in flight —
 *  the caller just skips that write). */
function resolveAddress(ui: Rec, address: { componentIndex: number; elementPath: number[] }): Rec | null {
	const components = Array.isArray(ui.components) ? (ui.components as Rec[]) : [];
	const component = components[address.componentIndex];
	if (!isRecord(component)) return null;
	let items = Array.isArray(component.elements) ? (component.elements as Rec[]) : null;
	let current: Rec | null = null;
	for (const index of address.elementPath) {
		if (!items || !isRecord(items[index])) return null;
		current = items[index];
		items = childItems(current);
	}
	return current;
}

/** Deep-clones the page ui and writes every returned label into its addressed
 *  element: the slot name onto `name`, the metadata onto `slot`. The layout
 *  meta is merged into ui.meta so draftFromUi picks it up on re-seed. */
export function applyAutoLabelResult(ui: Rec, targets: LabelTarget[], result: AutoLabelResult): Rec {
	const next = JSON.parse(JSON.stringify(ui)) as Rec;

	for (const label of result.elements) {
		const target = targets[label.i];
		if (!target) continue; // hallucinated index — skip
		const element = resolveAddress(next, target.address);
		if (!element) continue;
		if (label.name) element.name = label.name;
		if (label.slot) {
			const merged: SlotMeta = { ...(parseSlotMeta(element.slot) ?? {}), ...label.slot };
			element.slot = merged;
		}
	}

	if (result.layout_meta) {
		next.meta = { ...(isRecord(next.meta) ? next.meta : {}), ...result.layout_meta };
	}

	return next;
}
