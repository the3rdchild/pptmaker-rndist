// Shape of a reference document the user attaches before generating a deck.
//
// The generator is otherwise working from a topic string alone. A source
// document changes that in two ways: its prose becomes the material the deck
// is written FROM (instead of whatever the model happens to know), and the
// figures and tables it already contains become real content the slides can
// show — the whole point of attaching a thesis or a report rather than
// retyping its summary into the prompt box.
//
// Assets carry stable ids ("fig-3", "tbl-2") because those ids are what
// travels through the prompt: the model is shown an inventory of them and
// answers with the id it wants on a given slide. Anything the model can name
// must therefore survive extraction unchanged.

/** A picture lifted out of the document, already downscaled to canvas size. */
export interface SourceDocFigure {
	/** Prompt-facing id, e.g. "fig-3". Stable for the life of the extraction. */
	id: string
	/** Inline data URL (webp/png/jpeg) ready to drop into an image element. */
	dataUrl: string
	/** Natural pixel size, used for aspect ratio when placing the figure. */
	width: number
	height: number
	/** The document's own caption ("Gambar 3.1 Arsitektur sistem"), or "". */
	caption: string
	/** Heading path the figure sits under ("BAB III > Perancangan"), or "". */
	context: string
}

/** A table lifted out of the document, normalised to a rectangular grid. */
export interface SourceDocTable {
	id: string
	caption: string
	context: string
	/** First row when it reads like a header; empty when the table has none. */
	header: string[]
	/** Body rows, every one padded to the same length as the widest row. */
	rows: string[][]
}

/** One entry in the document's reading order. Figures and tables appear as
 *  references so the digest can render them in place without duplicating the
 *  payload. */
export type SourceDocBlock =
	| { kind: 'heading'; level: number; text: string }
	| { kind: 'paragraph'; text: string }
	| { kind: 'figure'; id: string }
	| { kind: 'table'; id: string }

export interface SourceDoc {
	/** Random id; travels between routes as ?src= and keys the IndexedDB row. */
	id: string
	fileName: string
	/** Document title — first heading, falling back to the file name. */
	title: string
	blocks: SourceDocBlock[]
	figures: SourceDocFigure[]
	tables: SourceDocTable[]
	createdAt: number
}

/** Everything the generator can be told to place, addressed by one id space. */
export type SourceDocAsset =
	| ({ kind: 'figure' } & SourceDocFigure)
	| ({ kind: 'table' } & SourceDocTable)

export function sourceDocAssets(doc: SourceDoc): SourceDocAsset[] {
	return [
		...doc.figures.map((f) => ({ kind: 'figure' as const, ...f })),
		...doc.tables.map((t) => ({ kind: 'table' as const, ...t })),
	]
}

export function findSourceDocAsset(doc: SourceDoc, id: string): SourceDocAsset | null {
	const wanted = id.trim().toLowerCase()
	if (!wanted) return null
	const figure = doc.figures.find((f) => f.id === wanted)
	if (figure) return { kind: 'figure', ...figure }
	const table = doc.tables.find((t) => t.id === wanted)
	if (table) return { kind: 'table', ...table }
	return null
}
