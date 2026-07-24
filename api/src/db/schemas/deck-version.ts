import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { deck, DeckPayload } from './deck'

// A checkpoint snapshot of a deck's payload at some point in time — lets a
// user browse/restore earlier states. NOT one row per autosave: the FE
// autosaves on a 1500ms debounce re-armed on every edit, so during active
// editing that can fire every couple seconds — snapshotting on every save
// would flood this table with near-duplicate full-payload rows. Instead the
// service layer only inserts a row when the previous snapshot for this deck
// is older than a throttle window (see SNAPSHOT_THROTTLE_MS in
// modules/deck-version/service.ts), so rows represent meaningful checkpoints
// spaced through an editing session, plus one extra row taken right before
// any restore (so restoring never loses the pre-restore state).
export const deckVersion = pgTable('deck_version', {
	id: uuid('id').primaryKey().defaultRandom(),
	deck_id: uuid('deck_id').notNull().references(() => deck.id, { onDelete: 'cascade' }),
	title: varchar('title', { length: 255 }).notNull(),
	payload: jsonb('payload').$type<DeckPayload>().notNull(),
	created_at: timestamp('created_at', { mode: 'date', precision: 3, withTimezone: true }).defaultNow().notNull(),
})

export type DeckVersion = typeof deckVersion.$inferSelect
export type NewDeckVersion = typeof deckVersion.$inferInsert
