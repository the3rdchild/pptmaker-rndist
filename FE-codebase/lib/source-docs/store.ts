// Client-side persistence for attached source documents.
//
// The attach happens on the homepage, the outline is written on /outline, and
// the deck is generated in /editor-react/[deckId] — three separate route
// pushes. The document therefore has to outlive a navigation, and it is far
// too large to travel in the query string, so only its id does (?src=) and the
// payload lives here.
//
// IndexedDB rather than sessionStorage because the payload is mostly base64
// image data: a thesis with twenty figures clears sessionStorage's ~5MB quota
// on its own, and a QuotaExceededError at attach time would lose the document
// after the user already waited for it to parse.
//
// Nothing is uploaded. The extraction stays on the user's machine until the
// figures they actually use are written into the deck, which keeps an
// unpublished thesis off the server.

import type { SourceDoc } from './types'

const DB_NAME = 'ppt-maker-source-docs'
const DB_VERSION = 1
const STORE = 'docs'

/** Attached documents older than this are swept on the next attach. They are
 *  single-generation scratch data — once the deck exists, the figures it uses
 *  live in the deck itself. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB tidak tersedia di browser ini.'))
			return
		}
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' })
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('Gagal membuka penyimpanan lokal.'))
	})
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction(STORE, mode)
				const request = run(transaction.objectStore(STORE))
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error ?? new Error('Operasi penyimpanan gagal.'))
				transaction.oncomplete = () => db.close()
			}),
	)
}

export async function saveSourceDoc(doc: SourceDoc): Promise<void> {
	await tx('readwrite', (store) => store.put(doc) as IDBRequest<IDBValidKey>)
	void pruneSourceDocs()
}

export async function loadSourceDoc(id: string): Promise<SourceDoc | null> {
	if (!id) return null
	try {
		const doc = await tx<SourceDoc | undefined>('readonly', (store) => store.get(id))
		return doc ?? null
	} catch {
		// A private-browsing profile can refuse IndexedDB outright. Generation
		// still works — it just won't have the document — so this must not
		// throw into the generation path.
		return null
	}
}

/** Loads several documents at once, dropping ids that are no longer stored. */
export async function loadSourceDocs(ids: string[]): Promise<SourceDoc[]> {
	const loaded = await Promise.all(ids.map((id) => loadSourceDoc(id)))
	return loaded.filter((doc): doc is SourceDoc => doc !== null)
}

export async function deleteSourceDoc(id: string): Promise<void> {
	try {
		await tx('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>)
	} catch {
		// Nothing to recover — a stale row costs a little quota, not correctness.
	}
}

async function pruneSourceDocs(): Promise<void> {
	try {
		const all = await tx<SourceDoc[]>('readonly', (store) => store.getAll() as IDBRequest<SourceDoc[]>)
		const cutoff = Date.now() - MAX_AGE_MS
		await Promise.all(
			all.filter((doc) => (doc.createdAt ?? 0) < cutoff).map((doc) => deleteSourceDoc(doc.id)),
		)
	} catch {
		// Housekeeping only.
	}
}

/* ------------------------- query-string plumbing -------------------------- */

/** The param carrying attached-document ids between routes. Comma-separated so
 *  more than one document can ride along. */
export const SOURCE_PARAM = 'src'

export function parseSourceIds(value: string | null | undefined): string[] {
	if (!value) return []
	return value
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean)
		.slice(0, 5)
}

export function serializeSourceIds(ids: string[]): string {
	return ids.filter(Boolean).slice(0, 5).join(',')
}
