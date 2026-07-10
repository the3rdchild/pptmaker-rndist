'use client'

import { Plus, Copy, Trash2 } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { cn } from '@/lib/utils'

export function SlidePanel() {
	const { presentation, slideIndex, setSlideIndex, addSlide, duplicateSlide, deleteSlide } = useEditorStore()
	const { slides } = presentation

	return (
		<div className="flex h-full w-[180px] shrink-0 flex-col border-r border-[#1e1e30] bg-[#13131f]">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-xs font-medium text-zinc-400">Slides</span>
				<button
					onClick={() => addSlide()}
					className="rounded p-1 text-zinc-400 hover:bg-[#2d2e42] hover:text-white"
					title="Add slide"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
				{slides.map((slide, i) => (
					<div
						key={slide.id}
						onClick={() => setSlideIndex(i)}
						className={cn(
							'group relative cursor-pointer rounded-lg border-2 transition-colors',
							i === slideIndex ? 'border-[#6c5ce7]' : 'border-transparent hover:border-[#3a3b52]',
						)}
					>
						{/* Thumbnail */}
						<div
							className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md"
							style={{
								background: slide.background?.type === 'solid' ? slide.background.color : '#fff',
							}}
						>
							<span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/50 text-[9px] text-white">
								{i + 1}
							</span>
							{/* Mini element preview */}
							<div className="relative" style={{ transform: 'scale(0.16)', transformOrigin: 'center', width: 1000, height: 562.5 }}>
								{slide.elements.filter((el) => el.type !== 'line').slice(0, 8).map((el) => {
									const e = el as { id: string; left: number; top: number; width: number; height: number; rotate: number; type: string; fill?: string }
									return (
										<div
											key={e.id}
											style={{
												position: 'absolute',
												left: e.left,
												top: e.top,
												width: e.width,
												height: e.height,
												transform: `rotate(${e.rotate}deg)`,
												background: e.type === 'shape' ? e.fill : e.type === 'text' ? 'transparent' : '#444',
												opacity: 0.6,
											}}
										/>
									)
								})}
							</div>
						</div>

						{/* Hover actions */}
						<div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
							<button
								onClick={(e) => { e.stopPropagation(); duplicateSlide(i) }}
								className="rounded bg-black/60 p-0.5 text-zinc-300 hover:bg-black/80 hover:text-white"
								title="Duplicate"
							>
								<Copy className="h-3 w-3" />
							</button>
							<button
								onClick={(e) => { e.stopPropagation(); deleteSlide(i) }}
								className="rounded bg-black/60 p-0.5 text-zinc-300 hover:bg-red-600 hover:text-white"
								title="Delete"
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
