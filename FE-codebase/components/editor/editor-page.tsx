'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useSessionStore } from '@/store/session.store'
import { saveDeck } from '@/lib/api'
import type { Presentation } from '@/lib/types/presentation'

export function EditorPage({ params }: { params: Promise<{ deckId: string }> }) {
	const searchParams = useSearchParams()
	const token = useSessionStore((s) => s.token)
	const ready = useSessionStore((s) => s.ready)
	const [deckId, setDeckId] = useState<string | null>(null)
	const [iframeLoaded, setIframeLoaded] = useState(false)
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Only auto-save after the first postMessage from PPTist
	// (don't save the empty initial deck back over itself)
	const firstSaveDone = useRef(false)

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
			// Security: only accept from the PPTist dev server origin
			const editorOrigin = process.env.NODE_ENV === 'production'
				? window.location.origin
				: 'http://127.0.0.1:8082'
			if (e.origin !== editorOrigin) return
			if (e.data?.type !== 'deck-changed') return

			const deck = e.data.deck as Presentation
			if (!deck || !deck.slides) return

			// Skip the very first save if slides are empty (initial load)
			if (!firstSaveDone.current && deck.slides.length === 0) return
			firstSaveDone.current = true

			if (saveTimer.current) clearTimeout(saveTimer.current)
			saveTimer.current = setTimeout(async () => {
				try {
					await saveDeck(token, deckId, {
						title: deck.title,
						payload: deck,
					})
				} catch (err) {
					console.warn('Auto-save failed:', err)
				}
			}, 2000)
		}

		window.addEventListener('message', handler)
		return () => window.removeEventListener('message', handler)
	}, [token, deckId])

	if (!ready || !deckId || !token) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-[#6c5ce7]" />
			</div>
		)
	}

	// Forward prompt + lang query params into the PPTist iframe URL
	const pptistParams = new URLSearchParams()
	pptistParams.set('deckId', deckId)
	pptistParams.set('token', token)
	const prompt = searchParams.get('prompt')
	const lang = searchParams.get('lang')
	if (prompt) pptistParams.set('prompt', prompt)
	if (lang) pptistParams.set('lang', lang)

	// PPTist dev server runs on port 8082
	// In production, PPTist is served from /editor/ (same origin)
	const editorUrl = process.env.NODE_ENV === 'production'
		? `/editor/?${pptistParams.toString()}`
		: `http://127.0.0.1:8082/editor/?${pptistParams.toString()}`

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
