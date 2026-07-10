'use client'

import { useRouter } from 'next/navigation'
import { Wand2, Plus, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAIStore } from '@/store/ai.store'
import { useSessionStore } from '@/store/session.store'
import { submitOutline } from '@/lib/api'
import { Button } from '@/components/shared/button'

const SLIDE_OPTIONS = [4, 6, 8, 10, 12, 15]
const LANGUAGES = ['Bahasa Indonesia', 'English', 'Español', '中文', '日本語']

export function PromptInput() {
	const router = useRouter()
	const token = useSessionStore((s) => s.token)
	const { prompt, slideCount, language, setStatus, setError, setJobId, setOutline } = useAIStore()
	const [submitting, setSubmitting] = useState(false)

	const handleGenerate = async () => {
		if (!prompt.trim() || !token) return
		setSubmitting(true)
		setStatus('submitting')
		setError(null)
		setOutline(null)
		try {
			const result = await submitOutline(token, { prompt, slideCount, language })
			setJobId(result.jobId)
			router.push(`/generate/${result.jobId}`)
		} catch (e) {
			setStatus('error')
			setError(e instanceof Error ? e.message : 'Failed to submit')
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
				onChange={(e) => useAIStore.getState().setPrompt(e.target.value)}
				placeholder="Ceritakan ide presentasimu..."
				rows={3}
				className="w-full resize-none rounded-xl border border-[#2d2e42] bg-[#1a1b2e] px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-[#6c5ce7]"
			/>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button variant="subtle" size="sm">
					<Plus className="h-4 w-4" /> Lampirkan
				</Button>

				<Dropdown label={`${slideCount} Slides`} options={SLIDE_OPTIONS.map((n) => `${n}`)} onSelect={(v) => useAIStore.getState().setSlideCount(Number(v))} />
				<Dropdown label={language} options={LANGUAGES} onSelect={(v) => useAIStore.getState().setLanguage(v)} />

				<div className="ml-auto">
					<Button onClick={handleGenerate} disabled={!prompt.trim() || submitting} size="md">
						<Wand2 className="h-4 w-4" />
						{submitting ? 'Memproses...' : 'Generate'}
					</Button>
				</div>
			</div>
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
