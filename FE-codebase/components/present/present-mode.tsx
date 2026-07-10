'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEditorStore } from '@/store/editor.store'
import { EditableElement } from '@/components/editor/canvas/editable-element'

export function PresentMode({ onClose }: { onClose: () => void }) {
	const { presentation, slideIndex, setSlideIndex } = useEditorStore()
	const slides = presentation.slides
	const [idx, setIdx] = useState(slideIndex)

	const next = useCallback(() => setIdx((i) => Math.min(i + 1, slides.length - 1)), [slides.length])
	const prev = useCallback(() => setIdx((i) => Math.max(i - 1, 0)), [])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next() }
			else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev() }
			else if (e.key === 'Escape') { setSlideIndex(idx); onClose() }
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [next, prev, onClose, idx, setSlideIndex])

	const slide = slides[idx]
	if (!slide) return null

	const bg = slide.background
	const bgStyle = bg?.type === 'solid' ? { background: bg.color } : { background: '#fff' }

	// Fit slide to screen
	const vw = presentation.viewportSize
	const vh = presentation.viewportSize * presentation.viewportRatio
	const scale = Math.min((window.innerWidth - 40) / vw, (window.innerHeight - 40) / vh)

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black" style={bgStyle}>
			{/* Slide content */}
			<div
				className="relative"
				style={{
					width: vw,
					height: vh,
					transform: `scale(${scale})`,
					transformOrigin: 'center center',
					...bgStyle,
				}}
			>
				{slide.elements.map((el) => (
					<EditableElement key={el.id} el={el} />
				))}
			</div>

			{/* Controls */}
			<div className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 backdrop-blur">
				<button
					onClick={prev}
					disabled={idx === 0}
					className="rounded-full p-1.5 text-white hover:bg-white/10 disabled:opacity-30"
				>
					<ChevronLeft className="h-5 w-5" />
				</button>
				<span className="min-w-[60px] text-center text-xs text-white">
					{idx + 1} / {slides.length}
				</span>
				<button
					onClick={next}
					disabled={idx === slides.length - 1}
					className="rounded-full p-1.5 text-white hover:bg-white/10 disabled:opacity-30"
				>
					<ChevronRight className="h-5 w-5" />
				</button>
				<div className="mx-1 h-4 w-px bg-white/20" />
				<button
					onClick={() => { setSlideIndex(idx); onClose() }}
					className="rounded-full p-1.5 text-white hover:bg-white/10"
				>
					<X className="h-5 w-5" />
				</button>
			</div>
		</div>
	)
}
