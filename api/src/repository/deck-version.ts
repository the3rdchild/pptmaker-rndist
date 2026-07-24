import { and, desc, eq } from 'drizzle-orm'
import db from '@/db'
import { DeckVersion, deckVersion, NewDeckVersion } from '@/db/schemas'

export async function insertDeckVersion(values: NewDeckVersion): Promise<DeckVersion> {
	const [row] = await db.insert(deckVersion).values(values).returning()
	return row
}

export async function getLatestDeckVersion(deckId: string): Promise<DeckVersion | null> {
	const [row] = await db
		.select()
		.from(deckVersion)
		.where(eq(deckVersion.deck_id, deckId))
		.orderBy(desc(deckVersion.created_at))
		.limit(1)
	return row ?? null
}

export async function listDeckVersions(deckId: string): Promise<Omit<DeckVersion, 'payload'>[]> {
	// List view skips the heavy payload JSONB, same pattern as listDecksBySession.
	return db
		.select({
			id: deckVersion.id,
			deck_id: deckVersion.deck_id,
			title: deckVersion.title,
			created_at: deckVersion.created_at,
		})
		.from(deckVersion)
		.where(eq(deckVersion.deck_id, deckId))
		.orderBy(desc(deckVersion.created_at))
}

export async function getDeckVersionById(id: string, deckId: string): Promise<DeckVersion | null> {
	const [row] = await db
		.select()
		.from(deckVersion)
		.where(and(eq(deckVersion.id, id), eq(deckVersion.deck_id, deckId)))
		.limit(1)
	return row ?? null
}
