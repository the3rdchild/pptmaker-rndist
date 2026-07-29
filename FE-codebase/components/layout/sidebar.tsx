'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Folder, History, LayoutTemplate, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shared/button'

const navItems = [
	{ icon: Home, label: 'Beranda', href: '/' },
	{ icon: LayoutTemplate, label: 'Template', href: '/template-list' },
	{ icon: Folder, label: 'Projects', href: '/' },
	{ icon: History, label: 'Riwayat', href: '/' },
]

export function Sidebar() {
	const pathname = usePathname()

	return (
		<aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[#1e1e30] bg-[#13131f]">
			{/* Logo */}
			<div className="flex items-center gap-2 px-4 py-4">
				<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6c5ce7]">
					<Sparkles className="h-4 w-4 text-white" />
				</div>
				<div className="leading-tight">
					<div className="text-sm font-semibold text-white">PPT Maker</div>
					<div className="text-[10px] font-medium text-[#a29bfe]">AI POWERED</div>
				</div>
			</div>

			{/* New session button */}
			<div className="px-3 pb-3">
				<Link href="/">
					<Button variant="primary" size="sm" className="w-full justify-start">
						<span className="text-base leading-none">+</span> Buat Baru
					</Button>
				</Link>
			</div>

			{/* Nav */}
			<nav className="flex-1 space-y-1 px-2">
				{navItems.map((item) => (
					<Link
						key={item.label}
						href={item.href}
						className={cn(
							'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
							pathname === item.href
								? 'bg-[#2d2e42] text-white'
								: 'text-zinc-400 hover:bg-[#1e1e30] hover:text-zinc-200',
						)}
					>
						<item.icon className="h-4 w-4" />
						{item.label}
					</Link>
				))}
			</nav>

			{/* Footer — user tier */}
			<div className="border-t border-[#1e1e30] px-4 py-3">
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2d2e42] text-xs text-zinc-400">
						U
					</div>
					<div className="leading-tight">
						<div className="text-xs font-medium text-zinc-300">UserReguler</div>
						<div className="text-[10px] text-[#a29bfe]">MEGA</div>
					</div>
				</div>
			</div>
		</aside>
	)
}
