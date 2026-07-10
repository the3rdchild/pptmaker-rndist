import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core'
import { timestamps } from '@/db/utils/common-table'

// Anonymous session identity — no login. One per browser/device (token in localStorage).
export const session = pgTable('session', {
	id: uuid('id').primaryKey().defaultRandom(),
	token: varchar('token', { length: 255 }).notNull().unique(),

	...timestamps,
})

export type Session = typeof session.$inferSelect
export type NewSession = typeof session.$inferInsert
