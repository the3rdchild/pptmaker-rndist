'use client'

import { useState } from 'react'
import { Wand2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shared/button'

const DENSITIES = ['Minimal', 'Concise', 'Detailed', 'Extensive'] as const

const THEMES = [
	{ name: 'Midnight', bg: '#0f0f1e', accent: '#6c5ce7' },
	{ name: 'Ocean', bg: '#0c2233', accent: '#0ea5e9' },
	{ name: 'Forest', bg: '#0c1f17', accent: '#10b981' },
	{ name: 'Sunset', bg: '#1f0c14', accent: '#f97316' },
	{ name: 'Royal', bg: '#170c1f', accent: '#a855f7' },
	{ name: 'Mono', bg: '#18181b', accent: '#71717a' },
]

export function CustomizationPanel({ onGenerate, generating }: { onGenerate: () => void; generating: boolean }) {
	const [density, setDensity] = useState(1) // Concise default
	const [theme, setTheme] = useState(0)

	return (
		<aside className="space-y-5 rounded-xl border border-[#2d2e42] bg-[#1a1b2e] p-5">
			<div>
				<h3 className="mb-1 text-sm font-medium text-white">Atur Layout</h3>
				<p className="text-xs text-zinc-500">Customize content & theme</p>
			</div>

			{/* Text content density */}
			<div>
				<label className="mb-2 block text-xs font-medium text-zinc-400">Text Content</label>
				<div className="grid grid-cols-4 gap-1 rounded-lg bg-[#0f0f1e] p-1">
					{DENSITIES.map((d, i) => (
						<button
							key={d}
							onClick={() => setDensity(i)}
							className={cn(
								'rounded-md py-1.5 text-[10px] font-medium transition-colors',
								density === i ? 'bg-[#6c5ce7] text-white' : 'text-zinc-500 hover:text-zinc-300',
							)}
						>
							{d}
						</button>
					))}
				</div>
			</div>

			{/* Tone / Audience / Scenario */}
			<div className="space-y-2">
				{['Tone', 'Audience', 'Scenario'].map((label) => (
					<div key={label}>
						<label className="mb-1 block text-xs text-zinc-500">{label}</label>
						<select className="h-8 w-full rounded-lg border border-[#2d2e42] bg-[#0f0f1e] px-2 text-xs text-zinc-300 outline-none focus:border-[#6c5ce7]">
							<option>Auto</option>
						</select>
					</div>
				))}
			</div>

			{/* Theme picker */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<label className="text-xs font-medium text-zinc-400">Select Theme</label>
					<button className="text-[10px] text-[#a29bfe] hover:underline">More Theme +</button>
				</div>
				<div className="grid grid-cols-3 gap-2">
					{THEMES.map((t, i) => (
						<button
							key={t.name}
							onClick={() => setTheme(i)}
							className={cn(
								'h-14 rounded-lg border-2 transition-all',
								theme === i ? 'border-[#6c5ce7]' : 'border-transparent',
							)}
							style={{ background: t.bg }}
						>
							<div className="flex h-full flex-col items-center justify-center">
								<div className="mb-1 h-1 w-6 rounded-full" style={{ background: t.accent }} />
								<div className="h-1 w-4 rounded-full bg-white/20" />
							</div>
						</button>
					))}
				</div>
			</div>

			{/* Generate button */}
			<Button onClick={onGenerate} disabled={generating} className="w-full">
				{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
				{generating ? 'Membuat presentasi...' : 'Generate Presentation'}
			</Button>
		</aside>
	)
}
