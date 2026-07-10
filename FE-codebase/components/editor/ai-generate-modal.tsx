'use client'

import { useState } from 'react'
import { Wand2, Loader2, X } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { useSessionStore } from '@/store/session.store'
import { submitSlideGen, openStream } from '@/lib/api'
import type { Slide } from '@/lib/types/slides'
import { Button } from '@/components/shared/button'

const LAYOUT_HINTS = ['Auto', 'Bullets', 'Two-column', 'Cover', 'Section'] as const

export function AIGenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const token = useSessionStore((s) => s.token)
	const { addSlide, setSlideIndex, presentation, pushHistory } = useEditorStore()
	const [prompt, setPrompt] = useState('')
	const [layoutHint, setLayoutHint] = useState<string>('Auto')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	if (!open) return null

	const handleGenerate = async () => {
		if (!prompt.trim() || !token) return
		setLoading(true)
		setError(null)
		try {
			const result = await submitSlideGen(token, {
				prompt,
				layoutHint: layoutHint === 'Auto' ? undefined : layoutHint.toLowerCase(),
				theme: presentation.theme as unknown as Record<string, unknown>,
			})

			// Stream the result
			let resolved = false
			openStream(result.jobId, (ev) => {
				if (ev.type === 'done' && ev.resultType === 'slide') {
					resolved = true
					const data = ev.result as { slide: Slide }
					pushHistory()
					addSlide(data.slide)
					setLoading(false)
					setPrompt('')
					onClose()
				} else if (ev.type === 'error') {
					resolved = true
					setError(ev.message)
					setLoading(false)
				}
			})

			// Fallback: if stream doesn't resolve in 30s, close
			setTimeout(() => {
				if (!resolved) {
					setError('Timeout waiting for AI')
					setLoading(false)
				}
			}, 30000)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to generate')
			setLoading(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="w-full max-w-lg rounded-2xl border border-[#2d2e42] bg-[#1a1b2e] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="mb-4 flex items-center justify-between">
					<h2 className="flex items-center gap-2 text-base font-semibold text-white">
						<Wand2 className="h-4 w-4 text-[#a29bfe]" /> Generate AI
					</h2>
					<button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white">
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Tabs */}
				<div className="mb-4 flex gap-1 rounded-lg bg-[#0f0f1e] p-1">
					<button className="flex-1 rounded-md bg-[#2d2e42] py-1.5 text-xs font-medium text-white">Content</button>
					<button className="flex-1 rounded-md py-1.5 text-xs font-medium text-zinc-500">Slide ▾</button>
				</div>

				{/* Prompt input */}
				<label className="mb-2 block text-xs font-medium text-zinc-400">
					Deskripsikan apa yang kamu mau masukan di page ini
				</label>
				<textarea
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="Contoh: Buat slide tentang manfaat olahraga rutin..."
					rows={4}
					className="w-full resize-none rounded-xl border border-[#2d2e42] bg-[#0f0f1e] px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-[#6c5ce7]"
				/>

				{/* Layout hint */}
				<div className="mt-3 flex flex-wrap gap-1">
					{LAYOUT_HINTS.map((h) => (
						<button
							key={h}
							onClick={() => setLayoutHint(h)}
							className={`rounded-lg px-3 py-1 text-xs transition-colors ${
								layoutHint === h ? 'bg-[#6c5ce7] text-white' : 'bg-[#2d2e42] text-zinc-400 hover:text-white'
							}`}
						>
							{h}
						</button>
					))}
				</div>

				{error && <p className="mt-3 text-xs text-red-400">{error}</p>}

				{/* Actions */}
				<div className="mt-5 flex justify-end gap-2">
					<Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
					<Button onClick={handleGenerate} disabled={!prompt.trim() || loading}>
						{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
						{loading ? 'Generating...' : 'Generate'}
					</Button>
				</div>
			</div>
		</div>
	)
}
