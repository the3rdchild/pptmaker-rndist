import { jsonb, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { POOL_REQUEST_STATUS } from '@/constants/pool-request-status'
import { session } from './session'
import { deck } from './deck'
import { timestamps } from '@/db/utils/common-table'

export const poolRequestStatusEnum = pgEnum('pool_request_status', POOL_REQUEST_STATUS)

// Job registry — same pattern as grammar-checker.
// params.type dispatches the worker: 'outline' | 'deck' | 'slide' | 'agent'
export const poolRequest = pgTable('pool_request', {
	id: uuid('id').primaryKey().defaultRandom(),
	job_id: varchar('job_id', { length: 255 }).notNull().unique(),
	session_id: uuid('session_id').notNull().references(() => session.id, { onDelete: 'cascade' }),
	deck_id: uuid('deck_id').references(() => deck.id, { onDelete: 'set null' }),
	status: poolRequestStatusEnum('status').notNull().default('pending'),
	error: text('error'),
	params: jsonb('params').$type<Record<string, unknown>>(),

	...timestamps,
})

export type PoolRequest = typeof poolRequest.$inferSelect
export type NewPoolRequest = typeof poolRequest.$inferInsert
