'use client'

import { Plus, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Outline } from '@/store/ai.store'
import { Button } from '@/components/shared/button'

interface Props {
	outline: Outline
	selected: Set<number>
	onToggle: (i: number) => void
	onChange: (i: number, field: 'title' | 'bullets', value: string | string[]) => void
}

export function OutlineCards({ outline, selected, onToggle, onChange }: Props) {
	return (
		<div className="space-y-3">
			{outline.slides.map((slide, i) => (
				<div
					key={i}
					className={cn(
						'rounded-xl border bg-[#1a1b2e] p-4 transition-colors',
						selected.has(i) ? 'border-[#6c5ce7]/50' : 'border-[#2d2e42]',
					)}
				>
					<div className="flex items-start gap-3">
						{/* Checkbox */}
						<button
							onClick={() => onToggle(i)}
							className={cn(
								'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
								selected.has(i) ? 'border-[#6c5ce7] bg-[#6c5ce7]' : 'border-zinc-600',
							)}
						>
							{selected.has(i) && <span className="text-[10px] text-white">✓</span>}
						</button>

						<GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-zinc-600" />

						<div className="min-w-0 flex-1">
							<div className="mb-1 flex items-center gap-2">
								<span className="rounded bg-[#2d2e42] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
									{slide.layout}
								</span>
								<span className="text-[10px] text-zinc-600">Slide {i + 1}</span>
							</div>
							<input
								value={slide.title}
								onChange={(e) => onChange(i, 'title', e.target.value)}
								className="mb-2 w-full bg-transparent text-sm font-medium text-white outline-none focus:text-[#a29bfe]"
							/>
							{slide.bullets.length > 0 && (
								<ul className="space-y-1">
									{slide.bullets.map((b, bi) => (
										<li
											key={bi}
											contentEditable
											suppressContentEditableWarning
											onBlur={(e) => {
												const text = e.currentTarget.textContent || ''
												const newBullets = [...slide.bullets]
												newBullets[bi] = text
												onChange(i, 'bullets', newBullets)
											}}
											className="flex items-start gap-2 text-xs text-zinc-400"
										>
											<span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#6c5ce7]" />
											{b}
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</div>
			))}

			<Button variant="ghost" size="sm" className="w-full border border-dashed border-[#2d2e42]">
				<Plus className="h-4 w-4" /> Add Page
			</Button>
		</div>
	)
}
