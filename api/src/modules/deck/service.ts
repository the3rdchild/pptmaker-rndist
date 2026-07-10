import { AppError } from '@/utils/error'
import {
	createDeck,
	deleteDeck,
	getDeckById,
	listDecksBySession,
	updateDeck,
} from '@/repository/deck'
import type { CreateDeckBody, PatchDeckBody, UpdateDeckBody } from './dto'

export class DeckService {
	async list(sessionId: string) {
		return listDecksBySession(sessionId)
	}

	async getById(sessionId: string, id: string) {
		const row = await getDeckById(id)
		if (!row) throw AppError.notFound(`deck ${id} not found`)
		if (row.session_id !== sessionId) throw AppError.notFound(`deck ${id} not found`)
		return row
	}

	async create(sessionId: string, body: CreateDeckBody) {
		return createDeck({
			session_id: sessionId,
			title: body.title ?? 'Untitled Presentation',
			payload: body.payload,
		})
	}

	async update(sessionId: string, id: string, body: UpdateDeckBody) {
		await this.getById(sessionId, id) // ownership check
		const updated = await updateDeck(id, {
			title: body.title,
			payload: body.payload,
			thumbnail: body.thumbnail ?? undefined,
		})
		return updated ?? this.getById(sessionId, id)
	}

	async patch(sessionId: string, id: string, body: PatchDeckBody) {
		await this.getById(sessionId, id)
		const updated = await updateDeck(id, {
			title: body.title,
			is_favorite: body.is_favorite,
			thumbnail: body.thumbnail ?? undefined,
		})
		return updated ?? this.getById(sessionId, id)
	}

	async remove(sessionId: string, id: string) {
		await this.getById(sessionId, id)
		await deleteDeck(id)
	}
}
