import { jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core'
import { poolRequest } from './pool-request'
import { timestamps } from '@/db/utils/common-table'

// AI generation result. Shape of `result` depends on `type`:
//   outline → { title, slides: [{ title, bullets, layout }] }
//   deck    → DeckPayload (full presentation)
//   slide   → single Slide object
//   agent   → { deck: DeckPayload, actions: [{ tool, args }] }
export type GenerationResultType = 'outline' | 'deck' | 'slide' | 'agent'

export const generationResult = pgTable('generation_result', {
	job_id: varchar('job_id', { length: 255 }).notNull().unique(),
	request_id: uuid('request_id').notNull().references(() => poolRequest.id, { onDelete: 'cascade' }),
	type: varchar('type', { length: 50 }).notNull(),
	result: jsonb('result').notNull(),

	...timestamps,
})

export type GenerationResult = typeof generationResult.$inferSelect
export type NewGenerationResult = typeof generationResult.$inferInsert
