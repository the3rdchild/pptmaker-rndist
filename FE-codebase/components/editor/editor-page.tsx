'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { useSessionStore } from '@/store/session.store'
import { getDeck, saveDeck } from '@/lib/api'
import type { Presentation } from '@/lib/types/presentation'
import { EditorHeader } from './editor-header'
import { SlidePanel } from './slide-panel'
import { Viewport } from './canvas/viewport'
import { PropertiesPanel } from './properties-panel'
import { AIGenerateModal } from './ai-generate-modal'
import { AgentPanel } from './agent-panel'
import { ThemePicker } from './theme-picker'
import { PresentMode } from '@/components/present/present-mode'

export function EditorPage({ params }: { params: Promise<{ deckId: string }> }) {
	const token = useSessionStore((s) => s.token)
	const ready = useSessionStore((s) => s.ready)
	const { loadDeck, presentation, deckId, dirty, setSaving, markDirty } = useEditorStore()
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [showAIModal, setShowAIModal] = useState(false)
	const [showAgent, setShowAgent] = useState(false)
	const [showTheme, setShowTheme] = useState(false)
	const [showPresent, setShowPresent] = useState(false)
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Load deck
	useEffect(() => {
		void (async () => {
			const { deckId: did } = await params
			if (!ready || !token) return
			try {
				const row = await getDeck(token, did)
				if (row.payload) {
					loadDeck(did, row.payload as Presentation)
				} else {
					setError('Deck has no content')
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Failed to load deck')
			} finally {
				setLoading(false)
			}
		})()
	}, [params, ready, token, loadDeck])

	// Auto-save (debounced 2s after dirty)
	useEffect(() => {
		if (!dirty || !deckId || !token) return
		if (saveTimer.current) clearTimeout(saveTimer.current)
		saveTimer.current = setTimeout(async () => {
			setSaving(true)
			try {
				await saveDeck(token, deckId, { title: presentation.title, payload: presentation })
				markDirty() // stays dirty but saving clears
				useEditorStore.setState({ dirty: false })
			} catch {
				// ignore — will retry on next change
			} finally {
				setSaving(false)
			}
		}, 2000)
		return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
	}, [dirty, deckId, token, presentation, setSaving, markDirty])

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Loader2 className="h-8 w-8 animate-spin text-[#6c5ce7]" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center text-center">
				<p className="text-sm text-red-400">{error}</p>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col">
			<EditorHeader
				onAIGenerate={() => setShowAIModal(true)}
				onAgent={() => setShowAgent((v) => !v)}
				onTheme={() => setShowTheme(true)}
				onPresent={() => setShowPresent(true)}
			/>
			<div className="flex flex-1 overflow-hidden">
				<SlidePanel />
				<Viewport />
				<PropertiesPanel />
				<AgentPanel open={showAgent} onClose={() => setShowAgent(false)} />
			</div>
			<AIGenerateModal open={showAIModal} onClose={() => setShowAIModal(false)} />
			<ThemePicker open={showTheme} onClose={() => setShowTheme(false)} />
			{showPresent && <PresentMode onClose={() => setShowPresent(false)} />}
		</div>
	)
}
