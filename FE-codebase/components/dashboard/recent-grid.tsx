'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Search, Star, MoreVertical, Clock, LayoutGrid } from 'lucide-react'
import { useDeckStore } from '@/store/deck.store'
import { useSessionStore } from '@/store/session.store'
import { cn } from '@/lib/utils'

function timeAgo(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const mins = Math.floor(diff / 60000)
	if (mins < 60) return `${mins} menit lalu`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours} jam lalu`
	const days = Math.floor(hours / 24)
	return `${days} hari lalu`
}

export function RecentGrid() {
	const token = useSessionStore((s) => s.token)
	const ready = useSessionStore((s) => s.ready)
	const { decks, loading, filter, query, load, setFilter, setQuery, remove, toggleFavorite } = useDeckStore()

	useEffect(() => {
		if (ready && token) void load()
	}, [ready, token, load])

	return (
		<div className="mt-8">
			{/* Tabs + filters */}
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<div className="flex gap-1 rounded-lg bg-[#1a1b2e] p-1">
					<button
						onClick={() => setFilter('all')}
						className={cn('rounded-md px-3 py-1 text-xs font-medium', filter === 'all' ? 'bg-[#2d2e42] text-white' : 'text-zinc-400')}
					>
						Semua Riwayat
					</button>
					<button
						onClick={() => setFilter('favorites')}
						className={cn('flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium', filter === 'favorites' ? 'bg-[#2d2e42] text-white' : 'text-zinc-400')}
					>
						<Star className="h-3 w-3" /> Favorit
					</button>
				</div>

				<div className="ml-auto flex items-center gap-2">
					<div className="relative">
						<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Cari riwayat..."
							className="h-8 w-48 rounded-lg border border-[#2d2e42] bg-[#1a1b2e] pl-7 pr-3 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-[#6c5ce7]"
						/>
					</div>
				</div>
			</div>

			{/* Grid */}
			{loading ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{[0, 1].map((i) => (
						<div key={i} className="h-40 animate-pulse rounded-xl bg-[#1a1b2e]" />
					))}
				</div>
			) : decks.length === 0 ? (
				<div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-[#2d2e42] text-center">
					<LayoutGrid className="mb-2 h-8 w-8 text-zinc-600" />
					<p className="text-sm text-zinc-500">Belum ada presentasi</p>
					<p className="text-xs text-zinc-600">Mulai generate deck pertama Anda di atas</p>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{useDeckStore.getState().filtered().map((deck) => (
						<div key={deck.id} className="group rounded-xl border border-[#2d2e42] bg-[#1a1b2e] p-3 transition-colors hover:border-[#3a3b52]">
							<Link href={`/editor-react/${deck.id}`} className="block">
								{/* Thumbnail */}
								<div className="mb-3 flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br from-[#2d2e42] to-[#1a1b2e]">
									<span className="text-2xl font-bold text-zinc-700">
										{deck.title.charAt(0).toUpperCase()}
									</span>
								</div>
								<div className="flex items-start justify-between">
									<div className="min-w-0">
										<h3 className="truncate text-sm font-medium text-zinc-200">{deck.title}</h3>
										<div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
											<Clock className="h-3 w-3" />
											{timeAgo(deck.updated_at)}
										</div>
									</div>
									<div className="flex items-center gap-1">
										<button
											onClick={(e) => { e.preventDefault(); void toggleFavorite(deck.id) }}
											className="rounded p-1 hover:bg-[#2d2e42]"
										>
											<Star className={cn('h-3.5 w-3.5', deck.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-zinc-500')} />
										</button>
										<button
											onClick={(e) => { e.preventDefault(); void remove(deck.id) }}
											className="rounded p-1 hover:bg-[#2d2e42]"
										>
											<MoreVertical className="h-3.5 w-3.5 text-zinc-500" />
										</button>
									</div>
								</div>
							</Link>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
