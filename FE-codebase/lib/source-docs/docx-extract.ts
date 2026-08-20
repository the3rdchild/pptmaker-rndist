// Reads a .docx into the SourceDoc shape: reading-order text blocks plus the
// figures and tables the document already contains.
//
// A .docx is a zip of OOXML. The three parts that matter here:
//   word/document.xml            the body — w:p paragraphs and w:tbl tables
//   word/_rels/document.xml.rels rIdN -> media/imageN.png
//   word/media/*                 the picture bytes
//
// Ordering is the whole game, so this parses with `preserveOrder` rather than
// the object mode the .pptx importer uses. In object mode fast-xml-parser
// groups siblings by tag name, which would hand back every w:p and then every
// w:tbl — losing which table sat under which heading, and losing where each
// figure fell relative to its caption. Captions are matched by adjacency
// ("Gambar 3.1 …" is the paragraph right after the picture, "Tabel 4.1 …" the
// one right before the table), so adjacency has to survive parsing.
//
// Everything runs in the browser: JSZip and fast-xml-parser are already
// dependencies (the .pptx importer uses both), so attaching a document needs
// no upload round-trip and no new package.

import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

import type { SourceDoc, SourceDocBlock, SourceDocFigure, SourceDocTable } from './types'

type OrderedNode = Record<string, unknown>

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: '#text',
	// Document text is text. Left at its default the parser coerces anything
	// numeric-looking, so a table cell reading "01" or "1.50" would arrive as a
	// number and render as "1" / "1.5".
	parseTagValue: false,
	// Word splits a sentence across runs at every formatting change, and the
	// space usually lands at the edge of a run: "Gambar 3.1" + " Diagram blok".
	// Trimming text nodes (the parser's default) deletes exactly those spaces
	// and the document comes back as "Gambar 3.1Diagram blok", "Bersifat" +
	// "unsupervised" + "sehingga" → "Bersifatunsupervisedsehingga". textOf
	// collapses runs of whitespace afterwards, so nothing is gained by
	// trimming here and a great deal of legibility is lost.
	trimValues: false,
	preserveOrder: true,
	processEntities: true,
})

/* --------------------------- ordered-tree helpers -------------------------- */

/** The single element tag a preserveOrder node carries (":@" holds attributes,
 *  "#text" marks a text node — neither is a tag). */
function tagOf(node: OrderedNode): string | null {
	for (const key of Object.keys(node)) {
		if (key === ':@' || key === '#text') continue
		return key
	}
	return null
}

function childrenOf(node: OrderedNode, tag: string): OrderedNode[] {
	const value = node[tag]
	return Array.isArray(value) ? (value as OrderedNode[]) : []
}

function attrsOf(node: OrderedNode): Record<string, string> {
	const raw = node[':@']
	if (!raw || typeof raw !== 'object') return {}
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		out[key] = String(value ?? '')
	}
	return out
}

function attr(node: OrderedNode, name: string): string | null {
	const value = attrsOf(node)[`@_${name}`]
	return value === undefined ? null : value
}

/** Direct children of `node` carrying `childTag`. Used wherever nesting would
 *  be wrong to follow: a table's rows are its OWN w:tr, not those of a table
 *  nested inside one of its cells, and a paragraph's properties are its own. */
function directChildren(node: OrderedNode, tag: string, childTag: string): OrderedNode[] {
	return childrenOf(node, tag).filter((child) => tagOf(child) === childTag)
}

function directChild(node: OrderedNode, tag: string, childTag: string): OrderedNode | null {
	return directChildren(node, tag, childTag)[0] ?? null
}

/** Depth-first search for the first descendant with the given tag. */
function findFirst(nodes: OrderedNode[], tag: string): OrderedNode | null {
	for (const node of nodes) {
		const own = tagOf(node)
		if (own === tag) return node
		if (own) {
			const nested = findFirst(childrenOf(node, own), tag)
			if (nested) return nested
		}
	}
	return null
}

/** Depth-first collection of every descendant with the given tag, in order. */
function findAll(nodes: OrderedNode[], tag: string, out: OrderedNode[] = []): OrderedNode[] {
	for (const node of nodes) {
		const own = tagOf(node)
		if (!own) continue
		if (own === tag) out.push(node)
		findAll(childrenOf(node, own), tag, out)
	}
	return out
}

/** Concatenated visible text of a subtree: w:t runs, with tabs and breaks
 *  flattened to spaces. Deleted text (w:delText) is skipped — tracked-change
 *  deletions are not part of the document as it reads. */
function textOf(nodes: OrderedNode[]): string {
	let out = ''
	const walk = (list: OrderedNode[]) => {
		for (const node of list) {
			const tag = tagOf(node)
			if (!tag) continue
			if (tag === 'w:delText') continue
			if (tag === 'w:t') {
				for (const child of childrenOf(node, 'w:t')) {
					const text = child['#text']
					if (text !== undefined) out += String(text)
				}
				continue
			}
			if (tag === 'w:tab' || tag === 'w:br' || tag === 'w:cr') {
				out += ' '
				continue
			}
			walk(childrenOf(node, tag))
		}
	}
	walk(nodes)
	return out.replace(/\s+/g, ' ').trim()
}

/* ------------------------------- zip access ------------------------------- */

async function readText(zip: JSZip, path: string): Promise<string | null> {
	const entry = zip.file(path)
	return entry ? entry.async('text') : null
}

/** rId -> part path, resolved against word/. External (http) targets are
 *  dropped: linked images have no bytes in the package to extract. */
async function readRelationships(zip: JSZip): Promise<Map<string, string>> {
	const map = new Map<string, string>()
	const xml = await readText(zip, 'word/_rels/document.xml.rels')
	if (!xml) return map
	const root = parser.parse(xml) as OrderedNode[]
	for (const rel of findAll(root, 'Relationship')) {
		const id = attr(rel, 'Id')
		const target = attr(rel, 'Target')
		const mode = attr(rel, 'TargetMode')
		if (!id || !target || mode === 'External') continue
		const path = target.startsWith('/')
			? target.slice(1)
			: `word/${target}`.replace(/\/\.\//g, '/')
		map.set(id, path.replace(/^word\/\.\.\//, ''))
	}
	return map
}

const MIME_BY_EXTENSION: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	bmp: 'image/bmp',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	emf: 'image/emf',
	wmf: 'image/wmf',
}

function mimeFor(path: string): string | null {
	const extension = path.split('.').pop()?.toLowerCase() ?? ''
	return MIME_BY_EXTENSION[extension] ?? null
}

/** Longest edge worth keeping. The stage is 1280x720 and PDF export rasterises
 *  at 2x, so nothing above ~2560px is ever sampled — but a figure lands inside
 *  a slot, never full-bleed, so half that is already generous. Figures ship
 *  inline in the deck JSON (same as AI-generated photos), and a thesis can
 *  carry dozens, so the ceiling here is what keeps a deck from becoming tens
 *  of megabytes of base64. */
const MAX_FIGURE_DIMENSION = 1600
const SHRINK_THRESHOLD_BYTES = 120 * 1024

/** Re-encodes an oversized picture down to what a slide can display. Returns
 *  null when the original should be kept as-is (vector, too small to be worth
 *  re-encoding, no canvas available, or the re-encode came out bigger). */
async function shrinkFigure(
	blob: Blob,
	mime: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
	if (mime === 'image/svg+xml' || mime === 'image/gif') return null
	if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null

	try {
		const bitmap = await createImageBitmap(blob)
		const longest = Math.max(bitmap.width, bitmap.height)
		const scale = Math.min(1, MAX_FIGURE_DIMENSION / longest)
		const naturalWidth = bitmap.width
		const naturalHeight = bitmap.height
		if (scale === 1 && blob.size < SHRINK_THRESHOLD_BYTES) {
			bitmap.close()
			return null
		}
		const width = Math.max(1, Math.round(bitmap.width * scale))
		const height = Math.max(1, Math.round(bitmap.height * scale))

		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext('2d')
		if (!context) {
			bitmap.close()
			return null
		}
		// Diagrams and screenshots — most of what a thesis figure is — often
		// have a transparent background; flattening it onto black is what JPEG
		// would do, so encode webp and let a browser without it fall back to
		// PNG per the canvas spec.
		context.drawImage(bitmap, 0, 0, width, height)
		bitmap.close()

		const encoded = canvas.toDataURL('image/webp', 0.9)
		const encodedBytes = encoded.length * 0.75
		if (encodedBytes >= blob.size && scale === 1) return null
		return { dataUrl: encoded, width: naturalWidth, height: naturalHeight }
	} catch {
		return null
	}
}

async function blobToDataUrl(zip: JSZip, path: string, mime: string): Promise<string | null> {
	const entry = zip.file(path)
	if (!entry) return null
	return `data:${mime};base64,${await entry.async('base64')}`
}

/* ------------------------------ block parsing ------------------------------ */

const EMU_PER_PIXEL = 9525 // 914400 EMU per inch / 96 px per inch

/** Pictures below this drawn size are inline ornaments — bullet glyphs, inline
 *  math, signature marks — not figures worth putting on a slide. */
const MIN_FIGURE_PX = 96

/** Heading style ids across the localisations Word ships. A thesis written in
 *  Bahasa Indonesia commonly carries "Judul1"/"Heading1" depending on which
 *  Word UI language built the template, and both appear in the same corpus. */
const HEADING_STYLE = /^(heading|judul|kop|titre|titulo|berschrift|title)(\d)$/

function headingLevel(paragraph: OrderedNode): number | null {
	const properties = directChild(paragraph, 'w:p', 'w:pPr')
	if (!properties) return null
	const own = childrenOf(properties, 'w:pPr')

	const style = findFirst(own, 'w:pStyle')
	const styleValue = style ? (attr(style, 'w:val') ?? '') : ''
	const normalised = styleValue.toLowerCase().replace(/[^a-z0-9]/g, '')
	const match = HEADING_STYLE.exec(normalised)
	if (match) return Math.min(6, Math.max(1, Number(match[2] || 1)))
	// "Title" with no digit is the document title — level 1.
	if (normalised === 'title' || normalised === 'judul') return 1

	// Some templates style headings directly and only record the outline level.
	const outline = findFirst(own, 'w:outlineLvl')
	const outlineValue = outline ? Number(attr(outline, 'w:val') ?? NaN) : NaN
	if (Number.isFinite(outlineValue) && outlineValue >= 0 && outlineValue <= 5) {
		return outlineValue + 1
	}
	return null
}

function isListParagraph(paragraph: OrderedNode): boolean {
	const properties = directChild(paragraph, 'w:p', 'w:pPr')
	if (!properties) return false
	return directChild(properties, 'w:pPr', 'w:numPr') !== null
}

const FIGURE_CAPTION = /^\s*(gambar|figure|fig\.?|image|grafik|diagram)\s*[\dIVXivx]+([.\-–:]\s*\d+)*/i
const TABLE_CAPTION = /^\s*(tabel|table|tbl\.?)\s*[\dIVXivx]+([.\-–:]\s*\d+)*/i

/** The picture relationship ids referenced by one paragraph, in order. Covers
 *  both the DrawingML form (a:blip r:embed, what modern Word writes) and the
 *  legacy VML form (v:imagedata r:id, still emitted by older converters and by
 *  anything that round-tripped through .doc). */
function pictureRelIds(paragraph: OrderedNode): { relId: string; widthPx: number; heightPx: number }[] {
	const out: { relId: string; widthPx: number; heightPx: number }[] = []
	const body = childrenOf(paragraph, 'w:p')

	for (const drawing of findAll(body, 'w:drawing')) {
		const children = childrenOf(drawing, 'w:drawing')
		const extent = findFirst(children, 'wp:extent')
		const cx = extent ? Number(attr(extent, 'cx') ?? NaN) : NaN
		const cy = extent ? Number(attr(extent, 'cy') ?? NaN) : NaN
		for (const blip of findAll(children, 'a:blip')) {
			const relId = attr(blip, 'r:embed') ?? attr(blip, 'r:link')
			if (!relId) continue
			out.push({
				relId,
				widthPx: Number.isFinite(cx) ? Math.round(cx / EMU_PER_PIXEL) : 0,
				heightPx: Number.isFinite(cy) ? Math.round(cy / EMU_PER_PIXEL) : 0,
			})
		}
	}

	for (const picture of findAll(body, 'w:pict')) {
		for (const data of findAll(childrenOf(picture, 'w:pict'), 'v:imagedata')) {
			const relId = attr(data, 'r:id')
			if (relId) out.push({ relId, widthPx: 0, heightPx: 0 })
		}
	}

	return out
}

/** One table's cells as a rectangular grid of plain text. Horizontally merged
 *  cells are padded out to the columns they cover and vertically merged
 *  continuations read as empty, so every row ends the same length — the slide
 *  renderer has no merge concept to inherit here, and a ragged grid would
 *  shift every column after the merge. */
function tableGrid(table: OrderedNode): string[][] {
	const rows: string[][] = []
	for (const row of directChildren(table, 'w:tbl', 'w:tr')) {
		const cells: string[] = []
		for (const cell of directChildren(row, 'w:tr', 'w:tc')) {
			const own = childrenOf(cell, 'w:tc')
			const properties = directChild(cell, 'w:tc', 'w:tcPr')
			const propertyChildren = properties ? childrenOf(properties, 'w:tcPr') : []

			const merge = findFirst(propertyChildren, 'w:vMerge')
			const mergeValue = merge ? (attr(merge, 'w:val') ?? 'continue') : null
			const isMergeContinuation = merge !== null && mergeValue !== 'restart'

			const span = findFirst(propertyChildren, 'w:gridSpan')
			const spanValue = span ? Number(attr(span, 'w:val') ?? 1) : 1
			const columns = Number.isFinite(spanValue) ? Math.max(1, Math.min(20, spanValue)) : 1

			// A nested table's text belongs to the inner table; reading the
			// outer cell's paragraphs only would duplicate it. Flatten it into
			// the cell rather than dropping it — the text still reads.
			cells.push(isMergeContinuation ? '' : textOf(own))
			for (let i = 1; i < columns; i += 1) cells.push('')
		}
		if (cells.length > 0) rows.push(cells)
	}

	const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
	return rows.map((row) => {
		const padded = [...row]
		while (padded.length < width) padded.push('')
		return padded
	})
}

/** A first row reads as a header when every cell has content and none of them
 *  looks like a data value — a heuristic, but the alternative (treating a data
 *  row as a header) is the visibly wrong one. */
function looksLikeHeader(row: string[] | undefined): boolean {
	if (!row || row.length < 2) return false
	if (row.some((cell) => !cell.trim())) return false
	const numeric = row.filter((cell) => /^[\d.,%\s+-]+$/.test(cell.trim())).length
	return numeric <= row.length / 2
}

export interface DocxExtractOptions {
	/** Cap on figures kept, newest-wins-nothing: extraction stops adding past
	 *  this. Guards against a 200-figure document ballooning the payload. */
	maxFigures?: number
	maxTables?: number
}

/**
 * Parses a .docx File into a SourceDoc. Throws when the file is not a readable
 * Word package; individual unreadable pictures are skipped rather than fatal.
 */
export async function extractDocx(file: File, options: DocxExtractOptions = {}): Promise<SourceDoc> {
	const maxFigures = options.maxFigures ?? 60
	const maxTables = options.maxTables ?? 40

	let zip: JSZip
	try {
		zip = await JSZip.loadAsync(await file.arrayBuffer())
	} catch {
		throw new Error('File .docx tidak bisa dibuka (bukan dokumen Word yang valid).')
	}

	const documentXml = await readText(zip, 'word/document.xml')
	if (!documentXml) {
		throw new Error('File .docx tidak berisi word/document.xml — dokumen ini tidak bisa dibaca.')
	}

	const relationships = await readRelationships(zip)
	const root = parser.parse(documentXml) as OrderedNode[]
	const document = findFirst(root, 'w:document')
	const body = document ? findFirst(childrenOf(document, 'w:document'), 'w:body') : null
	if (!body) throw new Error('Struktur .docx tidak dikenali (w:body tidak ditemukan).')

	const blocks: SourceDocBlock[] = []
	const figures: SourceDocFigure[] = []
	const tables: SourceDocTable[] = []
	/** Heading trail, so every asset can say which section it came from. */
	const headingTrail: string[] = []
	/** Media path -> figure id, so one picture used twice is extracted once. */
	const figureByPath = new Map<string, string>()

	const contextLabel = () => headingTrail.filter(Boolean).slice(-2).join(' > ')

	for (const node of childrenOf(body, 'w:body')) {
		const tag = tagOf(node)
		if (tag === 'w:p') {
			const text = textOf(childrenOf(node, 'w:p'))
			const pictures = pictureRelIds(node)

			for (const picture of pictures) {
				if (figures.length >= maxFigures) break
				const path = relationships.get(picture.relId)
				if (!path) continue
				const mime = mimeFor(path)
				// EMF/WMF are Windows metafiles: no browser decodes them, so
				// they would render as a broken image on the slide.
				if (!mime || mime === 'image/emf' || mime === 'image/wmf') continue
				if (
					picture.widthPx > 0 &&
					picture.heightPx > 0 &&
					(picture.widthPx < MIN_FIGURE_PX || picture.heightPx < MIN_FIGURE_PX)
				) {
					continue
				}

				const existing = figureByPath.get(path)
				if (existing) {
					blocks.push({ kind: 'figure', id: existing })
					continue
				}

				const entry = zip.file(path)
				if (!entry) continue
				let dataUrl: string | null = null
				let width = picture.widthPx
				let height = picture.heightPx
				try {
					const blob: Blob = await entry.async('blob')
					const shrunk = await shrinkFigure(blob, mime)
					if (shrunk) {
						dataUrl = shrunk.dataUrl
						width = shrunk.width
						height = shrunk.height
					} else {
						dataUrl = await blobToDataUrl(zip, path, mime)
					}
				} catch {
					dataUrl = null
				}
				if (!dataUrl) continue

				const id = `fig-${figures.length + 1}`
				figureByPath.set(path, id)
				figures.push({
					id,
					dataUrl,
					width: width || 0,
					height: height || 0,
					caption: '',
					context: contextLabel(),
				})
				blocks.push({ kind: 'figure', id })
			}

			if (!text) continue

			const level = headingLevel(node)
			if (level !== null && text.length <= 200) {
				headingTrail.length = Math.max(0, level - 1)
				headingTrail[level - 1] = text
				blocks.push({ kind: 'heading', level, text })
				continue
			}
			blocks.push({ kind: 'paragraph', text: isListParagraph(node) ? `- ${text}` : text })
			continue
		}

		if (tag === 'w:tbl') {
			if (tables.length >= maxTables) continue
			// Front matter uses tables for layout, not data: the author list,
			// the NPM/NIM block, the supervisors' signature grid. They carry no
			// caption and sit before the first heading, and offering them to
			// the generator as placeable content only invites a slide showing
			// a signature box.
			if (headingTrail.length === 0) continue
			const grid = tableGrid(node)
			// A one-column "table" is nearly always layout scaffolding (a
			// framed note, a two-up figure holder), not tabular data.
			if (grid.length < 2 || grid[0].length < 2) continue
			const id = `tbl-${tables.length + 1}`
			const header = looksLikeHeader(grid[0]) ? grid[0] : []
			tables.push({
				id,
				caption: '',
				context: contextLabel(),
				header,
				rows: header.length > 0 ? grid.slice(1) : grid,
			})
			blocks.push({ kind: 'table', id })
		}
	}

	attachCaptions(blocks, figures, tables)

	return {
		id: newSourceDocId(),
		fileName: file.name,
		title: documentTitle(blocks, file.name),
		blocks,
		figures,
		tables,
		createdAt: Date.now(),
	}
}

/** The document's title.
 *
 *  The first heading is only the title when the document opens with it. Reports
 *  and theses open with a cover page whose real title is styled by hand and is
 *  therefore a plain paragraph — the first HEADING there is "PENDAHULUAN",
 *  which names a chapter and would be a wrong, confident answer. So when
 *  paragraphs come first, the longest title-length line among them wins: on a
 *  cover page that is reliably the title itself rather than the boilerplate
 *  around it. */
function documentTitle(blocks: SourceDocBlock[], fileName: string): string {
	const fallback = fileName.replace(/\.docx$/i, '')
	const leadIndex = blocks.findIndex((block) => block.kind === 'heading')
	if (leadIndex === 0) {
		const heading = blocks[0]
		return heading.kind === 'heading' ? heading.text : fallback
	}

	const cover = blocks
		.slice(0, leadIndex < 0 ? 6 : Math.min(leadIndex, 6))
		.filter((block): block is { kind: 'paragraph'; text: string } => block.kind === 'paragraph')
		.map((block) => block.text.replace(/^-\s+/, '').trim())
		.filter((text) => text.length >= 25 && text.length <= 200)
	if (cover.length > 0) {
		return cover.reduce((longest, text) => (text.length > longest.length ? text : longest))
	}

	const heading = leadIndex >= 0 ? blocks[leadIndex] : null
	return heading && heading.kind === 'heading' ? heading.text : fallback
}

/** Pairs each figure/table with the document's own caption paragraph.
 *
 *  Word has no structural link between a picture and its caption — the caption
 *  is just a nearby paragraph — so adjacency is all there is to go on. The
 *  convention (and what Word's own "Insert Caption" produces) is figure
 *  captions BELOW and table captions ABOVE, so each is searched in its
 *  conventional direction first and the other way only as a fallback. */
function attachCaptions(
	blocks: SourceDocBlock[],
	figures: SourceDocFigure[],
	tables: SourceDocTable[],
): void {
	const figureById = new Map(figures.map((f) => [f.id, f]))
	const tableById = new Map(tables.map((t) => [t.id, t]))
	const used = new Set<number>()

	const captionAt = (index: number, pattern: RegExp): string | null => {
		if (index < 0 || index >= blocks.length || used.has(index)) return null
		const block = blocks[index]
		if (block.kind !== 'paragraph') return null
		const text = block.text.replace(/^-\s+/, '').trim()
		if (!pattern.test(text)) return null
		used.add(index)
		return text.slice(0, 240)
	}

	/** Scans outward up to `reach` paragraphs, skipping blank ones. */
	const search = (from: number, step: number, pattern: RegExp, reach = 2): string | null => {
		let seen = 0
		for (let i = from + step; i >= 0 && i < blocks.length && seen < reach; i += step) {
			const block = blocks[i]
			if (block.kind === 'figure' || block.kind === 'table') break
			if (block.kind === 'heading') break
			if (!block.text.trim()) continue
			seen += 1
			const caption = captionAt(i, pattern)
			if (caption) return caption
		}
		return null
	}

	blocks.forEach((block, index) => {
		if (block.kind === 'figure') {
			const figure = figureById.get(block.id)
			if (!figure || figure.caption) return
			figure.caption = search(index, 1, FIGURE_CAPTION) ?? search(index, -1, FIGURE_CAPTION) ?? ''
			return
		}
		if (block.kind === 'table') {
			const table = tableById.get(block.id)
			if (!table || table.caption) return
			table.caption = search(index, -1, TABLE_CAPTION) ?? search(index, 1, TABLE_CAPTION) ?? ''
		}
	})
}

export function newSourceDocId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID().slice(0, 12)
	}
	return Math.random().toString(36).slice(2, 14)
}

/** File extensions the attach button accepts today. */
export const SUPPORTED_SOURCE_EXTENSIONS = ['.docx'] as const

export function isSupportedSourceFile(name: string): boolean {
	return SUPPORTED_SOURCE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))
}
