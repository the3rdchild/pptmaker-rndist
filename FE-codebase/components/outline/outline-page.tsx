'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, Wand2, Loader2 } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/shared/button'
import { useSessionStore } from '@/store/session.store'
import { useAIStore } from '@/store/ai.store'
import { openStream, pollStatus, submitDeckGen, submitOutline } from '@/lib/api'
import { OutlineCards } from './outline-cards'
import { CustomizationPanel } from './customization-panel'
import type { Outline } from '@/store/ai.store'

export function OutlinePage({ params }: { params: Promise<{ jobId: string }> }) {
	const router = useRouter()
	const token = useSessionStore((s) => s.token)
	const ready = useSessionStore((s) => s.ready)
	const { setOutline, setStatus, setError, outline } = useAIStore()
	const [loading, setLoading] = useState(true)
	const [localOutline, setLocalOutline] = useState<Outline | null>(null)
	const [jobId, setJobId] = useState<string | null>(null)
	const [genDeck, setGenDeck] = useState(false)
	const [selectedSlides, setSelectedSlides] = useState<Set<number>>(new Set())

	useEffect(() => {
		void (async () => {
			const { jobId: jid } = await params
			setJobId(jid)
			if (!token) return
			// Try SSE first, fallback to polling
			let resolved = false
			const cleanup = openStream(jid, (ev) => {
				if (ev.type === 'done' && ev.resultType === 'outline') {
					const o = ev.result as Outline
					setOutline(o)
					setLocalOutline(o)
					setSelectedSlides(new Set(o.slides.map((_, i) => i)))
					setLoading(false)
					resolved = true
				}
			})

			// Poll fallback — every 2s until done (up to 60s)
			const poll = async () => {
				for (let i = 0; i < 30; i++) {
					if (resolved) return
					await new Promise((r) => setTimeout(r, 2000))
					if (resolved) return
					try {
						const result = await pollStatus(token, jid)
						if (result.status === 'completed' && result.result) {
							resolved = true
							const o = result.result as Outline
							setOutline(o)
							setLocalOutline(o)
							setSelectedSlides(new Set(o.slides.map((_, i) => i)))
							setLoading(false)
							return
						}
						if (result.status === 'failed') {
							resolved = true
							setError(result.error ?? 'Generation failed')
							setLoading(false)
							return
						}
					} catch { /* keep polling */ }
				}
				if (!resolved) {
					setError('Timeout waiting for AI')
					setLoading(false)
				}
			}
			void poll()

			return cleanup
		})()
	}, [params, token, setOutline, setStatus, setError])

	const handleRegen = async () => {
		if (!token || !jobId) return
		setLoading(true)
		setOutline(null)
		setLocalOutline(null)
		try {
			const { prompt, slideCount, language } = useAIStore.getState()
			const result = await submitOutline(token, { prompt, slideCount, language })
			router.push(`/generate/${result.jobId}`)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to regenerate')
			setLoading(false)
		}
	}

	const handleGenerateDeck = async () => {
		if (!token || !localOutline) return
		setGenDeck(true)
		// Filter to selected slides
		const filteredOutline = {
			...localOutline,
			slides: localOutline.slides.filter((_, i) => selectedSlides.has(i)),
		}
		try {
			const { language, slideCount } = useAIStore.getState()
			const result = await submitDeckGen(token, { outline: filteredOutline, language })
			router.push(`/generate/deck/${result.jobId}`)
		} catch (e) {
			setGenDeck(false)
			setError(e instanceof Error ? e.message : 'Failed to start deck generation')
		}
	}

	return (
		<AppShell>
			<div className="mx-auto max-w-6xl px-6 py-6">
				{/* Top bar */}
				<div className="mb-6 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<Button variant="ghost" size="icon" onClick={() => router.push('/')}>
							<ArrowLeft className="h-4 w-4" />
						</Button>
						<div>
							<h1 className="text-base font-semibold text-white">
								{localOutline?.title ?? 'Loading outline...'}
							</h1>
							<p className="text-xs text-zinc-500">Click to edit title</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={handleRegen} disabled={loading}>
							<RefreshCw className="h-3.5 w-3.5" /> Generate Ulang Outline
						</Button>
					</div>
				</div>

				{loading ? (
					<div className="flex h-64 flex-col items-center justify-center">
						<Loader2 className="mb-3 h-8 w-8 animate-spin text-[#6c5ce7]" />
						<p className="text-sm text-zinc-400">Sedang menyusun outline...</p>
						<p className="mt-1 text-xs text-zinc-600">AI sedang berpikir, mohon tunggu</p>
					</div>
				) : localOutline ? (
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
						{/* Left: outline */}
						<div>
							<h2 className="mb-3 text-sm font-medium text-zinc-300">Cek Outline Anda</h2>
							<OutlineCards
								outline={localOutline}
								selected={selectedSlides}
								onToggle={(i) => setSelectedSlides((prev) => {
									const next = new Set(prev)
									if (next.has(i)) next.delete(i)
									else next.add(i)
									return next
								})}
								onChange={(i, field, value) => setLocalOutline((prev) => {
									if (!prev) return prev
									const slides = [...prev.slides]
									slides[i] = { ...slides[i], [field]: value }
									return { ...prev, slides }
								})}
							/>
						</div>

						{/* Right: customization */}
						<CustomizationPanel onGenerate={handleGenerateDeck} generating={genDeck} />
					</div>
				) : (
					<div className="flex h-64 flex-col items-center justify-center text-center">
						<p className="text-sm text-red-400">{useAIStore.getState().error ?? 'Failed to load outline'}</p>
						<Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/')}>
							Kembali ke Beranda
						</Button>
					</div>
				)}
			</div>
		</AppShell>
	)
}
