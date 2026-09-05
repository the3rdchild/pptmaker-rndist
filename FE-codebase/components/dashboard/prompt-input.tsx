'use client'

import { useRouter } from 'next/navigation'
import { Wand2, Plus, ChevronDown, Loader2, ScanEye, Check, ImageIcon, FilePlus2, Code2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/store/session.store'
import { createDeck, saveDeck } from '@/lib/api'
import { Button } from '@/components/shared/button'
import { importPptxFile, resolveUnresolvedFonts } from '@/components/slide-editor/importing/pptx-import'
import { notify } from '@/components/ui/sonner'
import { SourceDocAttach, useSourceDocs } from '@/components/shared/source-doc-attach'
import { SOURCE_PARAM } from '@/lib/source-docs/store'
import {
	HTML_THEMES,
	HTML_THEME_PARAM,
	MODE_PARAM,
	loadStoredHtmlTheme,
	loadStoredMode,
	storeHtmlTheme,
	storeMode,
	type GenerationMode,
	type HtmlThemeId,
} from '@/lib/generation-mode'
import {
	DEFAULT_PAGE_COUNT_ID,
	PAGE_COUNTS,
	PAGE_COUNT_PARAM,
	isPageCountId,
	pageCountIdFromLabel,
	pageCountLabel,
	type PageCountId,
} from '@/lib/page-counts'

const LANGUAGES = ['Bahasa Indonesia', 'English', 'Español', '中文', '日本語']

/** Stable empty list — the homepage never restores documents from a URL, and a
 *  fresh array each render would re-trigger the restore effect. */
const NO_SOURCE_IDS: string[] = []

interface ProviderOption {
	id: string
	label: string
	vision: boolean
}

// Fetch the server's available AI providers once on mount — the list is
// env-aware (only providers whose API key is configured appear), so the
// homepage selector never offers a provider the server can't call. Falls back
// to an empty list on failure; the editor then applies its own defaults.
function useAvailableProviders() {
	const [providers, setProviders] = useState<{ text: ProviderOption[]; vision: ProviderOption[] }>({ text: [], vision: [] })
	useEffect(() => {
		let cancelled = false
		fetch('/api/ai/providers')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (!cancelled && data && Array.isArray(data.text) && Array.isArray(data.vision)) {
					setProviders({ text: data.text, vision: data.vision })
				}
			})
			.catch(() => {})
		return () => { cancelled = true }
	}, [])
	return providers
}

// Fetch which stock-photo providers (Pexels/Unsplash/Pixabay) have a
// server-side key configured — same env-aware shape as useAvailableProviders,
// so the "Stock photos" toggle can be disabled when nothing backs it.
// null = "not resolved yet" (distinct from `false`), so the disable-effect
// below doesn't wipe a persisted 'stock' choice just because the check
// hasn't come back yet — only an explicit `false` should ever clear it.
function useAvailableStockProviders() {
	const [hasStockProvider, setHasStockProvider] = useState<boolean | null>(null)
	useEffect(() => {
		let cancelled = false
		fetch('/api/stock-images/providers')
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (cancelled) return
				setHasStockProvider(Array.isArray(data?.providers) ? data.providers.length > 0 : false)
			})
			.catch(() => {
				if (!cancelled) setHasStockProvider(false)
			})
		return () => { cancelled = true }
	}, [])
	return hasStockProvider
}

export function PromptInput() {
	const router = useRouter()
	const token = useSessionStore((s) => s.token)
	const sessionReady = useSessionStore((s) => s.ready)
	const sessionError = useSessionStore((s) => s.error)
	const [prompt, setPrompt] = useState('')
	const [language, setLanguage] = useState('Bahasa Indonesia')
	// Page count is decided here now rather than only on /outline, so the very
	// first outline comes back at the right length instead of being regenerated
	// after the user changes the pill. Persisted like the other choices below.
	const [pageCountId, setPageCountId] = useState<PageCountId>(DEFAULT_PAGE_COUNT_ID)
	useEffect(() => {
		const saved = localStorage.getItem('ppt_page_count')
		if (isPageCountId(saved)) setPageCountId(saved)
	}, [])
	const providers = useAvailableProviders()
	// Per-section AI provider choices (generate text, verify vision, repair
	// text). Persisted in localStorage so the choice survives between visits.
	// null = "use the server default" (resolved in ai-providers.ts); resolved
	// here only when the user explicitly picks from the dropdown.
	const [genProvider, setGenProvider] = useState<string | null>(null)
	const [verifyProvider, setVerifyProvider] = useState<string | null>(null)
	const [repairProvider, setRepairProvider] = useState<string | null>(null)
	useEffect(() => {
		setGenProvider(localStorage.getItem('ppt_provider_gen'))
		setVerifyProvider(localStorage.getItem('ppt_provider_verify'))
		setRepairProvider(localStorage.getItem('ppt_provider_repair'))
	}, [])
	// Post-generation Kimi visual review (verify + repair per slide). Default
	// on; persisted so the choice survives between visits. Travels to the
	// editor as ?review=off when disabled.
	const [review, setReview] = useState(true)
	useEffect(() => {
		setReview(localStorage.getItem('ppt_visual_review') !== 'off')
	}, [])
	// Photo-slot source: AI-generated (DeepInfra, default) or real stock
	// photos (Pexels/Unsplash/Pixabay). Persisted in localStorage; travels to
	// the editor as ?images=stock when picked. Forced back to 'ai' if no
	// stock provider is configured server-side, so the toggle never points at
	// a mode that can't actually run.
	const hasStockProvider = useAvailableStockProviders()
	const [imageSource, setImageSource] = useState<'ai' | 'stock'>('ai')
	useEffect(() => {
		setImageSource(localStorage.getItem('ppt_image_source') === 'stock' ? 'stock' : 'ai')
	}, [])
	useEffect(() => {
		// hasStockProvider === false is a resolved "no provider configured";
		// null just means the check hasn't come back yet — must not clear a
		// persisted choice on that transient state.
		if (imageSource === 'stock' && hasStockProvider === false) {
			setImageSource('ai')
			localStorage.removeItem('ppt_image_source')
		}
	}, [hasStockProvider, imageSource])
	// Which engine builds the deck. "template" fills a hand-designed layout;
	// "html" lets the model design the slide as HTML and reads the rendered DOM
	// back as editable elements. Restored after mount so SSR and the first
	// client render agree.
	const [genMode, setGenMode] = useState<GenerationMode>('template')
	const [htmlTheme, setHtmlTheme] = useState<HtmlThemeId>('paper')
	useEffect(() => {
		setGenMode(loadStoredMode())
		setHtmlTheme(loadStoredHtmlTheme())
	}, [])
	const [submitting, setSubmitting] = useState(false)
	const [importing, setImporting] = useState(false)
	const [localError, setLocalError] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	// Reference documents (.docx) whose text becomes the deck's material and
	// whose figures/tables can be placed on slides. Nothing here is uploaded —
	// see lib/source-docs/store.ts.
	const sourceDocs = useSourceDocs(NO_SOURCE_IDS)

	// An attached document is enough on its own — its title is a better topic
	// than an empty box, and the whole point of attaching is that the material
	// is already written.
	const hasTopic = prompt.trim().length > 0 || sourceDocs.docs.length > 0
	const canGenerate = hasTopic && token !== null && sessionReady && !submitting && !importing

	const handleGenerate = async () => {
		if (!token) {
			setLocalError('Session belum siap. Tunggu sebentar...')
			return
		}
		const topic =
			prompt.trim() ||
			(sourceDocs.docs[0]
				? `Presentasi ringkas dari dokumen "${sourceDocs.docs[0].title}"`
				: '')
		if (!topic) return

		setSubmitting(true)
		setLocalError(null)
		try {
			// Go to the outline step first — the user reviews/edits the AI outline
			// there; the deck itself is only created when they click "Generate
			// Presentation" on that page (which then opens the editor).
			const qs = new URLSearchParams({
				prompt: topic,
				lang: language,
			})
			// Only the ids travel; the extracted text and figures stay in
			// IndexedDB (they are megabytes, and a URL is not).
			if (sourceDocs.ids) qs.set(SOURCE_PARAM, sourceDocs.ids)
			qs.set(PAGE_COUNT_PARAM, pageCountId)
			// Provider choices travel as separate params so each section
			// (generate/verify/repair) can be overridden independently.
			// Absent param = the editor applies the server default.
			if (genProvider) qs.set('gen', genProvider)
			if (verifyProvider) qs.set('verify', verifyProvider)
			if (repairProvider) qs.set('repair', repairProvider)
			if (!review) qs.set('review', 'off')
			if (imageSource === 'stock') qs.set('images', 'stock')
			// Absent param = template mode, so every existing link keeps working.
			if (genMode === 'html') {
				qs.set(MODE_PARAM, 'html')
				qs.set(HTML_THEME_PARAM, htmlTheme)
			}
			router.push(`/outline?${qs.toString()}`)
			setSubmitting(false)
		} catch (e) {
			setLocalError(e instanceof Error ? e.message : 'Failed to start')
			setSubmitting(false)
		}
	}

	const handleImportFile = async (file: File | null | undefined) => {
		if (!file) return
		if (!token) {
			setLocalError('Session belum siap. Tunggu sebentar...')
			return
		}
		if (!file.name.toLowerCase().endsWith('.pptx')) {
			notify.warning('File tidak didukung', 'Pilih file .pptx.')
			return
		}

		setImporting(true)
		setLocalError(null)
		try {
			const parsed = await importPptxFile(file)
			const resolved = await resolveUnresolvedFonts(parsed)
			const deck = await createDeck(token, { title: resolved.title })
			await saveDeck(token, deck.id, {
				title: resolved.title,
				payload: { title: resolved.title, slides: resolved.slides },
			} as unknown as Parameters<typeof saveDeck>[2])
			if (resolved.skippedShapeCount > 0) {
				notify.info(
					'Sebagian elemen dilewati',
					`${resolved.skippedShapeCount} elemen (chart/tabel/grafik kompleks) belum didukung dan tidak ikut ter-import.`,
				)
			}
			if (resolved.fontSubstitutions.length > 0) {
				const list = resolved.fontSubstitutions
					.map((sub) => `${sub.original} → ${sub.substitute}`)
					.join(', ')
				notify.info(
					'Font tidak tersedia diganti dengan font serupa',
					`${resolved.fontSubstitutions.length} font tidak tersedia diganti dengan Google Font terdekat: ${list}.`,
				)
			}
			router.push(`/editor-react/${deck.id}`)
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Gagal import file .pptx'
			setLocalError(message)
			notify.error('Import gagal', message)
			setImporting(false)
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
				<input
					ref={fileInputRef}
					type="file"
					accept=".pptx"
					className="hidden"
					onChange={(e) => {
						void handleImportFile(e.target.files?.[0])
						e.target.value = ''
					}}
				/>
				{/* Non-AI entry points, kept next to each other: start from an
				    empty deck, or from an existing .pptx. /editor-react already
				    creates the deck and redirects into it, so this just goes
				    there rather than duplicating the createDeck call. `blank=1`
				    is what skips the default-theme starter slide a new deck
				    otherwise opens on. */}
				<Button
					variant="subtle"
					size="sm"
					disabled={importing || submitting}
					onClick={() => router.push('/editor-react?blank=1')}
					title="Langsung buka editor dengan slide kosong, tanpa generate AI dan tanpa tema bawaan."
				>
					<FilePlus2 className="h-4 w-4" />
					Presentasi Kosong
				</Button>

				<Button
					variant="subtle"
					size="sm"
					disabled={importing || submitting}
					onClick={() => fileInputRef.current?.click()}
				>
					{importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
					{importing ? 'Mengimpor...' : 'Import .pptx'}
				</Button>

				<SourceDocAttach
					docs={sourceDocs.docs}
					onAdd={sourceDocs.add}
					onRemove={sourceDocs.remove}
					disabled={importing || submitting}
				/>

				<Dropdown
					label={pageCountLabel(pageCountId)}
					options={PAGE_COUNTS.map((option) => option.label)}
					onSelect={(label) => {
						const id = pageCountIdFromLabel(label)
						setPageCountId(id)
						localStorage.setItem('ppt_page_count', id)
					}}
				/>

				<Dropdown label={language} options={LANGUAGES} onSelect={(v) => setLanguage(v)} />

				<ProviderDropdown
					label="Generate"
					options={providers.text}
					selected={genProvider}
					onSelect={(id) => {
						setGenProvider(id)
						if (id) localStorage.setItem('ppt_provider_gen', id)
						else localStorage.removeItem('ppt_provider_gen')
					}}
				/>
				<ProviderDropdown
					label="Verify"
					options={providers.vision}
					selected={verifyProvider}
					onSelect={(id) => {
						setVerifyProvider(id)
						if (id) localStorage.setItem('ppt_provider_verify', id)
						else localStorage.removeItem('ppt_provider_verify')
					}}
				/>
				<ProviderDropdown
					label="Repair"
					options={providers.text}
					selected={repairProvider}
					onSelect={(id) => {
						setRepairProvider(id)
						if (id) localStorage.setItem('ppt_provider_repair', id)
						else localStorage.removeItem('ppt_provider_repair')
					}}
				/>

				<button
					type="button"
					onClick={() => {
						const next = !review
						setReview(next)
						localStorage.setItem('ppt_visual_review', next ? 'on' : 'off')
					}}
					title="Setelah generate, setiap slide dirender lalu dicek ulang oleh AI vision dan diperbaiki bila ada teks meluber / placeholder tersisa. Hasil lebih rapi, tapi generate jadi lebih lama."
					className="flex items-center gap-1.5 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[#6c5ce7]"
				>
					<ScanEye className={`h-3.5 w-3.5 ${review ? 'text-[#a29bfe]' : 'text-zinc-600'}`} />
					<span>Verifikasi AI</span>
					<span
						className={`relative h-4 w-7 rounded-full transition-colors ${review ? 'bg-[#6c5ce7]' : 'bg-[#2d2e42]'}`}
					>
						<span
							className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${review ? 'left-3.5' : 'left-0.5'}`}
						/>
					</span>
				</button>

				<button
					type="button"
					disabled={!hasStockProvider}
					onClick={() => {
						const next = imageSource === 'stock' ? 'ai' : 'stock'
						setImageSource(next)
						if (next === 'stock') localStorage.setItem('ppt_image_source', 'stock')
						else localStorage.removeItem('ppt_image_source')
					}}
					title={
						hasStockProvider
							? 'Isi tiap slot foto dengan foto asli dari Pexels/Unsplash/Pixabay, bukan gambar AI generate. Kalau pencarian gak nemu hasil, otomatis balik ke AI generate.'
							: 'Belum ada API key stock-photo (Pexels/Unsplash/Pixabay) yang di-set server-side.'
					}
					className="flex items-center gap-1.5 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[#6c5ce7] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#2d2e42]"
				>
					<ImageIcon className={`h-3.5 w-3.5 ${imageSource === 'stock' ? 'text-[#a29bfe]' : 'text-zinc-600'}`} />
					<span>Foto Stock</span>
					<span
						className={`relative h-4 w-7 rounded-full transition-colors ${imageSource === 'stock' ? 'bg-[#6c5ce7]' : 'bg-[#2d2e42]'}`}
					>
						<span
							className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${imageSource === 'stock' ? 'left-3.5' : 'left-0.5'}`}
						/>
					</span>
				</button>

				<button
					type="button"
					onClick={() => {
						const next = genMode === 'html' ? 'template' : 'html'
						setGenMode(next)
						storeMode(next)
					}}
					title="Mode HTML: AI mendesain tiap slide sebagai halaman HTML, lalu ukuran/posisi/warna dicontek dari hasil render jadi elemen editor. Layout tidak dibatasi template, tapi tema dan font ikut aturan mode ini."
					className="flex items-center gap-1.5 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[#6c5ce7]"
				>
					<Code2 className={`h-3.5 w-3.5 ${genMode === 'html' ? 'text-[#a29bfe]' : 'text-zinc-600'}`} />
					<span>Mode HTML</span>
					<span
						className={`relative h-4 w-7 rounded-full transition-colors ${genMode === 'html' ? 'bg-[#6c5ce7]' : 'bg-[#2d2e42]'}`}
					>
						<span
							className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${genMode === 'html' ? 'left-3.5' : 'left-0.5'}`}
						/>
					</span>
				</button>

				{/* HTML mode brings its own palette + font pair, so the template
				    theme picker on /outline does not apply to it. */}
				{genMode === 'html' && (
					<div className="flex items-center gap-1 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] p-0.5 text-xs">
						{HTML_THEMES.map((theme) => (
							<button
								key={theme.id}
								type="button"
								onClick={() => {
									setHtmlTheme(theme.id)
									storeHtmlTheme(theme.id)
								}}
								className={`rounded-md px-2 py-1 transition-colors ${
									htmlTheme === theme.id
										? 'bg-[#6c5ce7] text-white'
										: 'text-zinc-400 hover:text-zinc-200'
								}`}
							>
								{theme.label}
							</button>
						))}
					</div>
				)}

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

/** Provider selector — shows the section name + current provider label, and a
 *  checkmark on the active item. When no providers are listed yet (the env
 *  fetch hasn't resolved) the button still renders so layout doesn't jump; the
 *  menu is just empty until the list arrives. A "Default" entry lets the user
 *  clear an explicit choice and fall back to the server default. */
function ProviderDropdown({
	label,
	options,
	selected,
	onSelect,
}: {
	label: string
	options: ProviderOption[]
	selected: string | null
	onSelect: (id: string | null) => void
}) {
	const [open, setOpen] = useState(false)
	const current = options.find((o) => o.id === selected)
	return (
		<div className="relative">
			<Button variant="subtle" size="sm" onClick={() => setOpen((o) => !o)}>
				<span className="text-zinc-500">{label}:</span>{' '}
				<span className="text-zinc-200">{current?.label ?? 'Default'}</span>{' '}
				<ChevronDown className="h-3 w-3" />
			</Button>
			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					<div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] py-1 shadow-xl">
						<button
							onClick={() => { onSelect(null); setOpen(false) }}
							className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-[#2d2e42] hover:text-white"
						>
							<span>Default</span>
							{selected === null && <Check className="h-3.5 w-3.5 text-[#a29bfe]" />}
						</button>
						{options.map((opt) => (
							<button
								key={opt.id}
								onClick={() => { onSelect(opt.id); setOpen(false) }}
								className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-[#2d2e42] hover:text-white"
							>
								<span>{opt.label}</span>
								{selected === opt.id && <Check className="h-3.5 w-3.5 text-[#a29bfe]" />}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	)
}
