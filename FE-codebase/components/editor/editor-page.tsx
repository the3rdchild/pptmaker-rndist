'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSessionStore } from '@/store/session.store'
import { saveDeck } from '@/lib/api'
import type { Presentation } from '@/lib/types/presentation'

export function EditorPage({ params }: { params: Promise<{ deckId: string }> }) {
	const token = useSessionStore((s) => s.token)
	const ready = useSessionStore((s) => s.ready)
	const [deckId, setDeckId] = useState<string | null>(null)
	const [iframeLoaded, setIframeLoaded] = useState(false)
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	useEffect(() => {
		void (async () => {
			const { deckId: did } = await params
			setDeckId(did)
		})()
	}, [params])

	// Listen for postMessage from PPTist iframe → debounced auto-save
	useEffect(() => {
		if (!token || !deckId) return

		const handler = (e: MessageEvent) => {
			if (e.data?.type !== 'deck-changed') return
			const deck = e.data.deck as Presentation
			if (!deck || !deck.slides) return

			if (saveTimer.current) clearTimeout(saveTimer.current)
			saveTimer.current = setTimeout(async () => {
				try {
					await saveDeck(token, deckId, {
						title: deck.title,
						payload: deck,
					})
				} catch (e) {
					console.warn('Auto-save failed:', e)
				}
			}, 2000)
		}

		window.addEventListener('message', handler)
		return () => window.removeEventListener('message', handler)
	}, [token, deckId])

	if (!ready || !deckId) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-[#6c5ce7]" />
			</div>
		)
	}

	// PPTist dev server runs on port 8082
	// In production, PPTist is served from /editor/ (same origin)
	const editorUrl = process.env.NODE_ENV === 'production'
		? `/editor/?deckId=${deckId}&token=${token}`
		: `http://127.0.0.1:8082/editor/?deckId=${deckId}&token=${token}`

	return (
		<div className="relative h-full w-full bg-[#0a0a12]">
			{!iframeLoaded && (
				<div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a0a12]">
					<Loader2 className="h-8 w-8 animate-spin text-[#6c5ce7]" />
				</div>
			)}
			<iframe
				src={editorUrl}
				className="h-full w-full border-0"
				allow="fullscreen; clipboard-read; clipboard-write"
				onLoad={() => setIframeLoaded(true)}
				title="PPT Editor"
			/>
		</div>
	)
}
