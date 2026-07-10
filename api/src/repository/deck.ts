import { desc, eq } from 'drizzle-orm'
import db from '@/db'
import { Deck, deck, NewDeck } from '@/db/schemas'

export async function createDeck(values: NewDeck): Promise<Deck> {
	const [row] = await db.insert(deck).values(values).returning()
	return row
}

export async function getDeckById(id: string): Promise<Deck | null> {
	const [row] = await db.select().from(deck).where(eq(deck.id, id)).limit(1)
	return row ?? null
}

export async function listDecksBySession(sessionId: string): Promise<Deck[]> {
	return db
		.select()
		.from(deck)
		.where(eq(deck.session_id, sessionId))
		.orderBy(desc(deck.updatedAt))
}

export async function updateDeck(id: string, values: Partial<NewDeck>): Promise<Deck | null> {
	const [row] = await db.update(deck).set(values).where(eq(deck.id, id)).returning()
	return row ?? null
}

export async function deleteDeck(id: string): Promise<void> {
	await db.delete(deck).where(eq(deck.id, id))
}
