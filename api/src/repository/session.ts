import { eq } from 'drizzle-orm'
import db from '@/db'
import { NewSession, Session, session } from '@/db/schemas'

export async function createSession(values: NewSession): Promise<Session> {
	const [row] = await db.insert(session).values(values).returning()
	return row
}

export async function getSessionByToken(token: string): Promise<Session | null> {
	const [row] = await db
		.select()
		.from(session)
		.where(eq(session.token, token))
		.limit(1)
	return row ?? null
}
