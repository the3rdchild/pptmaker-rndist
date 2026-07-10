'use client'

import { create } from 'zustand'
import type { DeckRow } from '@/lib/api'
import { listDecks, deleteDeck as apiDeleteDeck, patchDeck as apiPatchDeck } from '@/lib/api'
import { useSessionStore } from './session.store'

interface DeckListState {
	decks: DeckRow[]
	loading: boolean
	error: string | null
	filter: 'all' | 'favorites'
	query: string

	load: () => Promise<void>
	setFilter: (f: 'all' | 'favorites') => void
	setQuery: (q: string) => void
	remove: (id: string) => Promise<void>
	toggleFavorite: (id: string) => Promise<void>

	filtered: () => DeckRow[]
}

export const useDeckStore = create<DeckListState>((set, get) => ({
	decks: [],
	loading: false,
	error: null,
	filter: 'all',
	query: '',

	load: async () => {
		const token = useSessionStore.getState().token
		if (!token) return
		set({ loading: true, error: null })
		try {
			const decks = await listDecks(token)
			set({ decks, loading: false })
		} catch (e) {
			set({ error: e instanceof Error ? e.message : 'Failed to load decks', loading: false })
		}
	},

	setFilter: (f) => set({ filter: f }),
	setQuery: (q) => set({ query: q }),

	remove: async (id) => {
		const token = useSessionStore.getState().token
		if (!token) return
		set((s) => ({ decks: s.decks.filter((d) => d.id !== id) }))
		await apiDeleteDeck(token, id)
	},

	toggleFavorite: async (id) => {
		const token = useSessionStore.getState().token
		if (!token) return
		const deck = get().decks.find((d) => d.id === id)
		if (!deck) return
		set((s) => ({
			decks: s.decks.map((d) => (d.id === id ? { ...d, is_favorite: !d.is_favorite } : d)),
		}))
		await apiPatchDeck(token, id, { is_favorite: !deck.is_favorite })
	},

	filtered: () => {
		const { decks, filter, query } = get()
		let result = decks
		if (filter === 'favorites') result = result.filter((d) => d.is_favorite)
		if (query.trim()) {
			const q = query.toLowerCase()
			result = result.filter((d) => d.title.toLowerCase().includes(q))
		}
		return result
	},
}))
