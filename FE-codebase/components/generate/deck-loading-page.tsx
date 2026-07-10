'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileText } from 'lucide-react'
import { AppShell } from '@/components/layout/app-shell'
import { useSessionStore } from '@/store/session.store'
import { openStream, pollStatus } from '@/lib/api'

export function DeckLoadingPage({ params }: { params: Promise<{ jobId: string }> }) {
	const router = useRouter()
	const token = useSessionStore((s) => s.token)
	const [status, setStatus] = useState('streaming')

	useEffect(() => {
		void (async () => {
			const { jobId } = await params
			if (!token) return

			let resolved = false

			// 1. Try SSE stream first
			const cleanup = openStream(jobId, (ev) => {
				if (ev.type === 'done' && ev.resultType === 'deck') {
					resolved = true
					const result = ev.result as { deckId: string }
					router.replace(`/editor/${result.deckId}`)
				} else if (ev.type === 'error') {
					// Don't immediately error — the job might still be running.
					// Let the poll fallback handle it.
				}
			})

			// 2. Poll fallback — check every 2s until done (up to 120s)
			const poll = async () => {
				for (let i = 0; i < 60; i++) {
					if (resolved) return
					await new Promise((r) => setTimeout(r, 2000))
					if (resolved) return
					try {
						const r = await pollStatus(token, jobId)
						if (r.status === 'completed' && r.result) {
							resolved = true
							const result = r.result as { deckId: string }
							router.replace(`/editor/${result.deckId}`)
							return
						}
						if (r.status === 'failed') {
							resolved = true
							setStatus('error')
							return
						}
					} catch {
						// network blip, keep polling
					}
				}
				// Timeout after 120s
				if (!resolved) {
					resolved = true
					setStatus('error')
				}
			}
			void poll()

			return cleanup
		})()
	}, [params, token, router])

	return (
		<AppShell>
			<div className="flex h-full flex-col items-center justify-center">
				{status === 'error' ? (
					<div className="text-center">
						<p className="text-sm text-red-400">Gagal membuat presentasi</p>
						<button
							onClick={() => router.push('/')}
							className="mt-3 text-xs text-[#a29bfe] hover:underline"
						>
							Kembali ke Beranda
						</button>
					</div>
				) : (
					<>
						<div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#6c5ce7]/20">
							<FileText className="h-8 w-8 text-[#a29bfe]" />
						</div>
						<Loader2 className="mb-3 h-6 w-6 animate-spin text-[#6c5ce7]" />
						<h2 className="text-base font-medium text-white">AI sedang menyusun presentasi</h2>
						<p className="mt-1 text-sm text-zinc-500">Proses ini mungkin memerlukan beberapa saat...</p>
					</>
				)}
			</div>
		</AppShell>
	)
}
