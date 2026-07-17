'use client'

import { useRouter } from 'next/navigation'
import { Wand2, Plus, ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useSessionStore } from '@/store/session.store'
import { createDeck } from '@/lib/api'
import { Button } from '@/components/shared/button'

const LANGUAGES = ['Bahasa Indonesia', 'English', 'Español', '中文', '日本語']

export function PromptInput() {
	const router = useRouter()
	const token = useSessionStore((s) => s.token)
	const sessionReady = useSessionStore((s) => s.ready)
	const sessionError = useSessionStore((s) => s.error)
	const [prompt, setPrompt] = useState('')
	const [language, setLanguage] = useState('Bahasa Indonesia')
	const [submitting, setSubmitting] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)

	const canGenerate = prompt.trim().length > 0 && token !== null && sessionReady && !submitting

	const handleGenerate = async () => {
		if (!token) {
			setLocalError('Session belum siap. Tunggu sebentar...')
			return
		}
		if (!prompt.trim()) return

		setSubmitting(true)
		setLocalError(null)
		try {
			// Create an empty deck, then open the editor passing the prompt via
			// URL query params — editor-react-client auto-generates from it on mount.
			const deck = await createDeck(token, { title: prompt.slice(0, 60) })
			const qs = new URLSearchParams({
				prompt,
				lang: language,
			})
			router.push(`/editor-react/${deck.id}?${qs.toString()}`)
		} catch (e) {
			setLocalError(e instanceof Error ? e.message : 'Failed to start')
			setSubmitting(false)
		}
	}

	return (
		<div className="bg-hero-gradient rounded-2xl p-6">
			<div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#6c5ce7]/20 px-3 py-1 text-xs font-medium text-[#a29bfe]">
				AI Presentation Maker
			</div>
			<h1 className="mb-1 text-2xl font-bold text-white">Buat Presentasi dengan PPT Maker</h1>
			<p className="mb-4 text-sm text-zinc-400">
				Ubah ide Anda menjadi slide yang memukau dalam hitungan menit
			</p>

			<textarea
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				placeholder="Ceritakan ide presentasimu..."
				rows={3}
				className="w-full resize-none rounded-xl border border-[#2d2e42] bg-[#1a1b2e] px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-[#6c5ce7]"
				onKeyDown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate()
				}}
			/>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button variant="subtle" size="sm">
					<Plus className="h-4 w-4" /> Lampirkan
				</Button>

				<Dropdown label={language} options={LANGUAGES} onSelect={(v) => setLanguage(v)} />

				<div className="ml-auto flex items-center gap-2">
					{/* Session status indicator */}
					{!sessionReady && !sessionError && (
						<span className="flex items-center gap-1 text-[10px] text-zinc-500">
							<Loader2 className="h-3 w-3 animate-spin" /> Connecting...
						</span>
					)}
					{sessionError && (
						<span className="text-[10px] text-red-400">Connection error</span>
					)}

					<Button onClick={handleGenerate} disabled={!canGenerate} size="md">
						{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
						{submitting ? 'Memproses...' : 'Generate'}
					</Button>
				</div>
			</div>

			{localError && (
				<p className="mt-2 text-xs text-red-400">⚠ {localError}</p>
			)}
		</div>
	)
}

function Dropdown({ label, options, onSelect }: { label: string; options: string[]; onSelect: (v: string) => void }) {
	const [open, setOpen] = useState(false)
	return (
		<div className="relative">
			<Button variant="subtle" size="sm" onClick={() => setOpen((o) => !o)}>
				{label} <ChevronDown className="h-3 w-3" />
			</Button>
			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					<div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] py-1 shadow-xl">
						{options.map((opt) => (
							<button
								key={opt}
								onClick={() => { onSelect(opt); setOpen(false) }}
								className="block w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-[#2d2e42] hover:text-white"
							>
								{opt}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}
