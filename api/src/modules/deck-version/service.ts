import { AppError } from '@/utils/error'
import { Deck } from '@/db/schemas'
import { getDeckById, updateDeck } from '@/repository/deck'
import {
	getDeckVersionById,
	getLatestDeckVersion,
	insertDeckVersion,
	listDeckVersions,
} from '@/repository/deck-version'

// Minimum time between automatic checkpoint snapshots for the SAME deck —
// see deck-version.ts schema comment for why this isn't "one row per
// autosave". 10 minutes gives meaningful history depth across an editing
// session without flooding the table.
const SNAPSHOT_THROTTLE_MS = 10 * 60 * 1000

export class DeckVersionService {
	private async getOwnedDeck(sessionId: string, deckId: string): Promise<Deck> {
		const row = await getDeckById(deckId)
		if (!row || row.session_id !== sessionId) throw AppError.notFound(`deck ${deckId} not found`)
		return row
	}

	/** Called from DeckService.update() right before a deck is overwritten —
	 * snapshots the CURRENT (about-to-be-replaced) payload if the last
	 * snapshot is stale enough, so version history advances passively as the
	 * user works instead of needing an explicit "save checkpoint" action. */
	async maybeSnapshot(deck: Deck): Promise<void> {
		if (!deck.payload) return
		const latest = await getLatestDeckVersion(deck.id)
		const staleEnough = !latest || Date.now() - latest.created_at.getTime() > SNAPSHOT_THROTTLE_MS
		if (!staleEnough) return
		await insertDeckVersion({ deck_id: deck.id, title: deck.title, payload: deck.payload })
	}

	async list(sessionId: string, deckId: string) {
		await this.getOwnedDeck(sessionId, deckId)
		return listDeckVersions(deckId)
	}

	async getOne(sessionId: string, deckId: string, versionId: string) {
		await this.getOwnedDeck(sessionId, deckId)
		const version = await getDeckVersionById(versionId, deckId)
		if (!version) throw AppError.notFound(`version ${versionId} not found`)
		return version
	}

	/** Restores `deck.payload` to the chosen version's payload. Takes an
	 * unthrottled snapshot of the CURRENT state first — bypassing the normal
	 * throttle, since a restore is exactly the kind of deliberate moment
	 * worth always checkpointing — so restoring is never itself destructive:
	 * the pre-restore state stays reachable as its own version. */
	async restore(sessionId: string, deckId: string, versionId: string) {
		const deck = await this.getOwnedDeck(sessionId, deckId)
		const version = await getDeckVersionById(versionId, deckId)
		if (!version) throw AppError.notFound(`version ${versionId} not found`)
		if (deck.payload) {
			await insertDeckVersion({ deck_id: deckId, title: deck.title, payload: deck.payload })
		}
		const updated = await updateDeck(deckId, { title: version.title, payload: version.payload })
		return updated ?? this.getOwnedDeck(sessionId, deckId)
	}
}
