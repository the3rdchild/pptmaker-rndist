'use client'

import { create } from 'zustand'
import { ensureSession } from '@/lib/api'

const TOKEN_KEY = 'ppt_session_token'

function generateToken(): string {
	// Random anonymous token
	const bytes = new Uint8Array(24)
	crypto.getRandomValues(bytes)
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface SessionState {
	token: string | null
	sessionId: string | null
	ready: boolean
	error: string | null
	init: () => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
	token: null,
	sessionId: null,
	ready: false,
	error: null,

	init: async () => {
		if (get().ready) return

		let token = localStorage.getItem(TOKEN_KEY)
		if (!token) {
			token = generateToken()
			localStorage.setItem(TOKEN_KEY, token)
		}

		try {
			const info = await ensureSession(token)
			set({ token: info.token, sessionId: info.id, ready: true, error: null })
		} catch (e) {
			set({ ready: true, error: e instanceof Error ? e.message : 'Session init failed' })
		}
	},
}))
