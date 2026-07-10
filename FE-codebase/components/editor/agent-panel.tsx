'use client'

import { useState, useRef, useEffect } from 'react'
import { Trash2, X, Send, Bot, User, Loader2, CheckCircle2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { useSessionStore } from '@/store/session.store'
import { submitAgent, openStream } from '@/lib/api'
import type { Presentation } from '@/lib/types/presentation'
import { cn } from '@/lib/utils'

type ChatMessage = {
	role: 'user' | 'assistant'
	content: string
	actions?: { tool: string; args: Record<string, unknown> }[]
}

const SUGGESTIONS = [
	'Ganti semua font jadi Poppins',
	'Ubah tema jadi warna gelap',
	'Tambah slide penutup',
]

export function AgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
	const token = useSessionStore((s) => s.token)
	const { presentation, deckId, loadDeck, pushHistory } = useEditorStore()
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [input, setInput] = useState('')
	const [loading, setLoading] = useState(false)
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
	}, [messages])

	if (!open) return null

	const send = async (text?: string) => {
		const msg = (text ?? input).trim()
		if (!msg || !token || loading) return
		setInput('')
		setMessages((m) => [...m, { role: 'user', content: msg }])
		setLoading(true)

		try {
			const result = await submitAgent(token, {
				message: msg,
				deckId: deckId ?? undefined,
				deck: presentation as unknown as Record<string, unknown>,
			})

			let resolved = false
			openStream(result.jobId, (ev) => {
				if (ev.type === 'done' && ev.resultType === 'agent') {
					resolved = true
					const data = ev.result as {
						deck: Presentation
						actions: { tool: string; args: Record<string, unknown> }[]
						summary: string
						deckId: string
					}
					// Apply the updated deck
					pushHistory()
					loadDeck(data.deckId || deckId || '', data.deck)
					setMessages((m) => [...m, {
						role: 'assistant',
						content: data.summary,
						actions: data.actions,
					}])
					setLoading(false)
				} else if (ev.type === 'error') {
					resolved = true
					setMessages((m) => [...m, { role: 'assistant', content: `Error: ${ev.message}` }])
					setLoading(false)
				}
			})

			setTimeout(() => {
				if (!resolved) {
					setMessages((m) => [...m, { role: 'assistant', content: 'Timeout — coba lagi' }])
					setLoading(false)
				}
			}, 60000)
		} catch (e) {
			setMessages((m) => [...m, {
				role: 'assistant',
				content: e instanceof Error ? e.message : 'Failed to send',
			}])
			setLoading(false)
		}
	}

	return (
		<aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-[#1e1e30] bg-[#13131f]">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-[#1e1e30] px-4 py-3">
				<div className="flex items-center gap-2">
					<div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6c5ce7]">
						<Bot className="h-3.5 w-3.5 text-white" />
					</div>
					<span className="text-sm font-medium text-white">AI Assistant</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={() => setMessages([])}
						className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white"
						title="Clear chat"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
					<button
						onClick={onClose}
						className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
				{messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center text-center">
						<p className="mb-3 text-sm text-zinc-500">Ask me to edit your presentation</p>
						<div className="w-full space-y-2">
							{SUGGESTIONS.map((s) => (
								<button
									key={s}
									onClick={() => send(s)}
									className="w-full rounded-lg border border-[#2d2e42] bg-[#1a1b2e] px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:border-[#6c5ce7]/50 hover:text-white"
								>
									{s}
								</button>
							))}
						</div>
					</div>
				) : (
					<>
						{messages.map((m, i) => (
							<div key={i} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
								{m.role === 'assistant' && (
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6c5ce7]">
										<Bot className="h-3 w-3 text-white" />
									</div>
								)}
								<div
									className={cn(
										'max-w-[220px] rounded-lg px-3 py-2 text-xs',
										m.role === 'user'
											? 'bg-[#6c5ce7] text-white'
											: 'bg-[#1a1b2e] text-zinc-200',
									)}
								>
									{m.role === 'assistant' && <CheckCircle2 className="mb-1 inline h-3 w-3 text-green-400" />}
									{m.content}
									{m.actions && m.actions.length > 0 && (
										<div className="mt-1.5 space-y-0.5 border-t border-[#2d2e42] pt-1.5">
											{m.actions.map((a, ai) => (
												<div key={ai} className="text-[10px] text-zinc-500">
													⚡ {a.tool}({Object.values(a.args).join(', ')})
												</div>
											))}
										</div>
									)}
								</div>
								{m.role === 'user' && (
									<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2d2e42]">
										<User className="h-3 w-3 text-zinc-400" />
									</div>
								)}
							</div>
						))}
						{loading && (
							<div className="flex gap-2">
								<div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6c5ce7]">
									<Bot className="h-3 w-3 text-white" />
								</div>
								<div className="flex items-center gap-1 rounded-lg bg-[#1a1b2e] px-3 py-2">
									<Loader2 className="h-3 w-3 animate-spin text-[#a29bfe]" />
									<span className="text-xs text-zinc-500">Thinking...</span>
								</div>
							</div>
						)}
					</>
				)}
			</div>

			{/* Input */}
			<div className="border-t border-[#1e1e30] p-3">
				<div className="flex items-center gap-2 rounded-lg border border-[#2d2e42] bg-[#0f0f1e] px-3 py-2">
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => { if (e.key === 'Enter') send() }}
						placeholder="Ask Anything..."
						className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
						disabled={loading}
					/>
					<button
						onClick={() => send()}
						disabled={!input.trim() || loading}
						className="rounded p-1 text-[#a29bfe] hover:bg-[#2d2e42] disabled:opacity-30"
					>
						<Send className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
		</aside>
	)
}
