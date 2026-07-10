'use client'

import { X, Check } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { Button } from '@/components/shared/button'
import { cn } from '@/lib/utils'
import type { SlideTheme, SlideBackground } from '@/lib/types/slides'

const THEMES: { name: string; theme: SlideTheme }[] = [
	{
		name: 'Midnight',
		theme: {
			backgroundColor: '#0f0f1e',
			themeColors: ['#6c5ce7', '#a29bfe', '#0ea5e9', '#10b981', '#f97316', '#a855f7'],
			fontColor: '#ffffff',
			fontName: '',
			outline: { width: 2, color: '#525252', style: 'solid' },
			shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
		},
	},
	{
		name: 'Ocean',
		theme: {
			backgroundColor: '#0c2233',
			themeColors: ['#0ea5e9', '#38bdf8', '#06b6d4', '#14b8a6', '#3b82f6', '#6366f1'],
			fontColor: '#f0f9ff',
			fontName: '',
			outline: { width: 2, color: '#0284c7', style: 'solid' },
			shadow: { h: 2, v: 2, blur: 3, color: '#000000' },
		},
	},
	{
		name: 'Forest',
		theme: {
			backgroundColor: '#0c1f17',
			themeColors: ['#10b981', '#34d399', '#22c55e', '#84cc16', '#059669', '#14b8a6'],
			fontColor: '#f0fdf4',
			fontName: '',
			outline: { width: 2, color: '#059669', style: 'solid' },
			shadow: { h: 2, v: 2, blur: 3, color: '#000000' },
		},
	},
	{
		name: 'Sunset',
		theme: {
			backgroundColor: '#1f0c14',
			themeColors: ['#f97316', '#fb923c', '#ef4444', '#f59e0b', '#dc2626', '#ea580c'],
			fontColor: '#fff7ed',
			fontName: '',
			outline: { width: 2, color: '#c2410c', style: 'solid' },
			shadow: { h: 2, v: 2, blur: 3, color: '#000000' },
		},
	},
	{
		name: 'Royal',
		theme: {
			backgroundColor: '#170c1f',
			themeColors: ['#a855f7', '#c084fc', '#9333ea', '#7c3aed', '#d946ef', '#e879f9'],
			fontColor: '#faf5ff',
			fontName: '',
			outline: { width: 2, color: '#7c3aed', style: 'solid' },
			shadow: { h: 2, v: 2, blur: 3, color: '#000000' },
		},
	},
	{
		name: 'Light',
		theme: {
			backgroundColor: '#ffffff',
			themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
			fontColor: '#333333',
			fontName: '',
			outline: { width: 2, color: '#525252', style: 'solid' },
			shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
		},
	},
]

export function ThemePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { presentation, updateSlide, pushHistory } = useEditorStore()

	if (!open) return null

	const applyTheme = (theme: SlideTheme) => {
		pushHistory()
		// Update all slide backgrounds + element colors
		presentation.slides.forEach((slide, i) => {
			const newBg: SlideBackground = { type: 'solid', color: theme.backgroundColor }
			const newElements = slide.elements.map((el) => {
				if (el.type === 'shape') {
					return { ...el, fill: theme.themeColors[0] }
				}
				if (el.type === 'text') {
					return { ...el, defaultColor: theme.fontColor }
				}
				return el
			})
			updateSlide(i, { background: newBg, elements: newElements })
		})
		onClose()
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className="w-full max-w-2xl rounded-2xl border border-[#2d2e42] bg-[#1a1b2e] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-base font-semibold text-white">Pilih Tema</h2>
					<button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-[#2d2e42] hover:text-white">
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="grid grid-cols-3 gap-3">
					{THEMES.map((t) => (
						<button
							key={t.name}
							onClick={() => applyTheme(t.theme)}
							className="group overflow-hidden rounded-lg border border-[#2d2e42] transition-all hover:border-[#6c5ce7]"
						>
							<div
								className="flex aspect-video flex-col items-center justify-center gap-1"
								style={{ background: t.theme.backgroundColor }}
							>
								<div className="h-1.5 w-12 rounded-full" style={{ background: t.theme.themeColors[0] }} />
								<div className="h-1 w-8 rounded-full" style={{ background: t.theme.themeColors[1] }} />
								<div className="h-1 w-10 rounded-full" style={{ background: t.theme.themeColors[2] }} />
							</div>
							<div className="px-2 py-1.5 text-left text-xs text-zinc-400 group-hover:text-white">
								{t.name}
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	)
}
