// Turns an extracted document into prompt payload.
//
// Two things go to the model, and they are budgeted differently:
//
//   1. The PROSE, heavily trimmed. A thesis runs 30k+ words; nobody's context
//      window should carry that to write nine slides, and the trimming is not
//      lossy in a way that matters — headings survive intact and each section
//      contributes its opening paragraphs, which is where a section states
//      what it is about.
//   2. The ASSET INVENTORY, never trimmed away. This is the contract: the
//      model can only place a figure or table by naming an id it was shown, so
//      an inventory silently cut short is a set of assets that can never
//      appear on a slide. It is capped by count, not by the prose budget.
//
// Asset markers are also left inline in the trimmed prose ("[FIGURE fig-3]"),
// so the model can see WHERE in the argument a figure belongs, not just that
// it exists.

import type { SourceDoc, SourceDocTable } from './types'

/** Total characters of document text handed to the model. Sized to leave room
 *  for the theme manifest, which is itself several thousand characters. */
const DEFAULT_MAX_CHARS = 18000

/** Per-section prose budget. Sections state their subject early, so the first
 *  paragraphs are worth far more than an even spread across the whole section. */
const SECTION_CHAR_BUDGET = 1100

/** Table preview rows in the inventory — enough to show what the columns hold. */
const PREVIEW_ROWS = 3

/** Caption length kept per inventory line. */
const INVENTORY_CAPTION_CHARS = 130

function tablePreview(table: SourceDocTable): string {
	const shown = [
		...(table.header.length > 0 ? [table.header] : []),
		...table.rows.slice(0, PREVIEW_ROWS),
	]
	const cols = table.header.length || table.rows[0]?.length || 0
	const shape = `${table.rows.length + (table.header.length > 0 ? 1 : 0)} baris x ${cols} kolom`
	const preview = shown
		.map((row) => row.map((cell) => cell.slice(0, 40)).join(' | '))
		.join(' // ')
	return `${shape}${preview ? ` — ${preview}` : ''}`
}

export interface SourceDigestOptions {
	maxChars?: number
}

/**
 * The document as the model sees it: trimmed prose with inline asset markers,
 * followed by the full inventory of placeable figures and tables.
 *
 * Returns "" for a document with nothing extractable, so callers can treat an
 * empty digest as "no source document" without a second check.
 */
export function buildSourceDigest(doc: SourceDoc, options: SourceDigestOptions = {}): string {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
	const figureById = new Map(doc.figures.map((f) => [f.id, f]))
	const tableById = new Map(doc.tables.map((t) => [t.id, t]))

	// Front matter — cover page, approval page, table of contents — is
	// structure, not material. On the thesis this was built against it was the
	// first ~600 characters of the digest and contained a supervisor list and a
	// row of dot leaders. Skipped whenever the document has headings to skip
	// to; a heading-less memo still contributes everything it has.
	const firstHeading = doc.blocks.findIndex((block) => block.kind === 'heading')
	const prose = firstHeading > 0 ? doc.blocks.slice(firstHeading) : doc.blocks

	const lines: string[] = []
	let used = 0
	let sectionUsed = 0
	let sectionTrimmed = false

	if (firstHeading > 0 && doc.title) {
		lines.push(`# ${doc.title}`)
		used += doc.title.length + 3
	}

	for (const block of prose) {
		if (used >= maxChars) break

		if (block.kind === 'heading') {
			sectionUsed = 0
			sectionTrimmed = false
			const line = `${'#'.repeat(Math.min(4, block.level))} ${block.text}`
			lines.push(line)
			used += line.length + 1
			continue
		}

		if (block.kind === 'figure') {
			const figure = figureById.get(block.id)
			if (!figure) continue
			const line = `[FIGURE ${figure.id}${figure.caption ? ` — ${figure.caption}` : ''}]`
			lines.push(line)
			used += line.length + 1
			continue
		}

		if (block.kind === 'table') {
			const table = tableById.get(block.id)
			if (!table) continue
			const line = `[TABLE ${table.id}${table.caption ? ` — ${table.caption}` : ''}]`
			lines.push(line)
			used += line.length + 1
			continue
		}

		// Prose. Once a section has spent its budget the rest of it is dropped,
		// but asset markers keep flowing (handled above) — a figure late in a
		// long section must still be placeable.
		if (sectionUsed >= SECTION_CHAR_BUDGET) {
			if (!sectionTrimmed) {
				lines.push('…')
				used += 2
				sectionTrimmed = true
			}
			continue
		}
		const remaining = Math.min(SECTION_CHAR_BUDGET - sectionUsed, maxChars - used)
		const text = block.text.length > remaining ? `${block.text.slice(0, remaining)}…` : block.text
		lines.push(text)
		used += text.length + 1
		sectionUsed += text.length + 1
	}

	// One line per asset, captions clipped: a thesis figure caption can run to a
	// full sentence and forty of them would cost more of the window than the
	// prose they belong to. What the model needs is enough to tell them apart.
	const label = (caption: string) => (caption ? caption.slice(0, INVENTORY_CAPTION_CHARS) : '(no caption)')

	const inventory: string[] = []
	for (const figure of doc.figures) {
		inventory.push(
			`${figure.id}\tfigure\t${label(figure.caption)}${figure.context ? `\t[${figure.context}]` : ''}`,
		)
	}
	for (const table of doc.tables) {
		inventory.push(`${table.id}\ttable\t${label(table.caption)}\t${tablePreview(table)}`)
	}

	if (lines.length === 0 && inventory.length === 0) return ''

	const header = `=== SOURCE DOCUMENT: ${doc.fileName} ===`
	const body = lines.join('\n')
	const assets =
		inventory.length > 0
			? [
					'',
					'=== DOCUMENT ASSETS (id / type / caption / details) ===',
					...inventory,
					'',
					'These assets are real figures and tables from the document. Place one on a slide by',
					'filling an image slot with {"asset":"<id>"} instead of text. Never invent an id.',
				].join('\n')
			: ''

	return `${header}\n${body}\n${assets}`.trim()
}

/** Prompt block appended to the user's own topic. Kept separate from
 *  buildSourceDigest so the caller controls the order (topic first, document
 *  second — the topic is the instruction, the document is the material). */
export function withSourceDocument(topic: string, digest: string): string {
	if (!digest.trim()) return topic
	return [
		topic.trim(),
		'',
		'The deck must be written FROM the document below — its content, its terminology,',
		'its actual findings. Do not substitute general knowledge for what it says.',
		'',
		digest,
	].join('\n')
}
