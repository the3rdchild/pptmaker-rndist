import { boolean, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { session } from './session'
import { timestamps } from '@/db/utils/common-table'

// Presentation payload shape (consumed by FE & written by worker).
// `slides` follows the PPTist data model (ported to FE-codebase/lib/types/slides.ts).
export interface DeckTheme {
	backgroundColor: string
	themeColors: string[]
	fontColor: string
	fontName: string
}

export interface DeckPayload {
	width: number
	height: number
	viewportSize: number
	viewportRatio: number
	theme: DeckTheme
	slides: unknown[]   // Slide[] — typed loosely here, strongly on the FE
}

export const deck = pgTable('deck', {
	id: uuid('id').primaryKey().defaultRandom(),
	session_id: uuid('session_id').notNull().references(() => session.id, { onDelete: 'cascade' }),
	title: varchar('title', { length: 255 }).notNull().default('Untitled Presentation'),
	payload: jsonb('payload').$type<DeckPayload>(),
	thumbnail: text('thumbnail'),
	is_favorite: boolean('is_favorite').notNull().default(false),

	...timestamps,
})

export type Deck = typeof deck.$inferSelect
export type NewDeck = typeof deck.$inferInsert
