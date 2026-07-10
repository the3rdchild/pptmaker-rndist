'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '@/store/editor.store'
import { EditableElement } from './editable-element'
import { ResizeHandles } from './resize-handles'
import type { PPTElement } from '@/lib/types/slides'

type DragState = {
	id: string
	startX: number
	startY: number
	origLeft: number
	origTop: number
	moved: boolean
}

export function Viewport() {
	const containerRef = useRef<HTMLDivElement>(null)
	const dragState = useRef<DragState | null>(null)
	const { presentation, slideIndex, canvasScale, activeElementIds } = useEditorStore()
	const { selectElements, clearSelection, updateElement, pushHistory, setCanvasScale } = useEditorStore()

	const slide = presentation.slides[slideIndex]
	const vpSize = presentation.viewportSize
	const vpRatio = presentation.viewportRatio

	const fitCanvas = useCallback(() => {
		const container = containerRef.current
		if (!container) return
		const availW = container.clientWidth - 60
		const availH = container.clientHeight - 60
		const scale = Math.min(availW / vpSize, availH / (vpSize * vpRatio))
		setCanvasScale(Math.max(0.1, scale))
	}, [vpSize, vpRatio, setCanvasScale])

	useEffect(() => {
		fitCanvas()
		const ro = new ResizeObserver(() => fitCanvas())
		if (containerRef.current) ro.observe(containerRef.current)
		return () => ro.disconnect()
	}, [fitCanvas])

	// Element drag
	const handleElementMouseDown = (e: React.MouseEvent, el: PPTElement) => {
		if (e.target instanceof HTMLElement && e.target.isContentEditable) return
		e.stopPropagation()
		if (!activeElementIds.includes(el.id)) {
			selectElements([el.id])
		}

		if (el.type === 'line') return

		dragState.current = {
			id: el.id,
			startX: e.clientX,
			startY: e.clientY,
			origLeft: el.left,
			origTop: el.top,
			moved: false,
		}

		const onMove = (ev: MouseEvent) => {
			const ds = dragState.current
			if (!ds) return
			const dx = (ev.clientX - ds.startX) / canvasScale
			const dy = (ev.clientY - ds.startY) / canvasScale
			if (Math.abs(dx) > 1 || Math.abs(dy) > 1) ds.moved = true
			updateElement(ds.id, { left: ds.origLeft + dx, top: ds.origTop + dy })
		}

		const onUp = () => {
			if (dragState.current?.moved) {
				pushHistory()
			}
			dragState.current = null
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
		}

		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	}

	// Keyboard: delete element, arrow nudge
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.tagName === 'INPUT')) return
			if (!activeElementIds.length) return

			if (e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault()
				const { deleteElement } = useEditorStore.getState()
				activeElementIds.forEach((id) => deleteElement(id))
			} else if (e.key.startsWith('Arrow')) {
				e.preventDefault()
				const step = e.shiftKey ? 10 : 1
				const { updateElement, pushHistory } = useEditorStore.getState()
				activeElementIds.forEach((id) => {
					const s = presentation.slides[slideIndex]
					const el = s?.elements.find((x) => x.id === id)
					if (!el) return
					if (e.key === 'ArrowLeft') updateElement(id, { left: el.left - step })
					if (e.key === 'ArrowRight') updateElement(id, { left: el.left + step })
					if (e.key === 'ArrowUp') updateElement(id, { top: el.top - step })
					if (e.key === 'ArrowDown') updateElement(id, { top: el.top + step })
				})
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [activeElementIds, presentation, slideIndex])

	if (!slide) {
		return <div ref={containerRef} className="flex flex-1 items-center justify-center text-zinc-500">No slide</div>
	}

	const bg = slide.background
	const bgStyle: React.CSSProperties = bg?.type === 'solid'
		? { background: bg.color }
		: bg?.type === 'image'
			? { backgroundImage: `url(${bg.image?.src})`, backgroundSize: bg.image?.size }
			: { background: '#ffffff' }

	return (
		<div
			ref={containerRef}
			className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0a0a12]"
			style={{ backgroundImage: 'radial-gradient(circle, #1a1b2e 1px, transparent 1px)', backgroundSize: '20px 20px' }}
			onMouseDown={() => clearSelection()}
		>
			{/* The scaled canvas */}
			<div
				className="relative shadow-2xl ring-1 ring-black/30"
				style={{
					width: vpSize,
					height: vpSize * vpRatio,
					transform: `scale(${canvasScale})`,
					transformOrigin: 'center center',
					...bgStyle,
				}}
				onMouseDown={(e) => e.stopPropagation()}
			>
				{slide.elements.map((el) => {
					const isSelected = activeElementIds.includes(el.id)
					return (
						<div
							key={el.id}
							data-element-id={el.id}
							onMouseDown={(e) => handleElementMouseDown(e, el)}
							className={isSelected ? 'outline-2 outline outline-[#6c5ce7]' : ''}
							style={{
								position: 'absolute',
								cursor: isSelected ? 'move' : 'pointer',
								zIndex: isSelected ? 100 : 1,
							}}
						>
							<EditableElement el={el} />
							{isSelected && <ResizeHandles el={el} scale={canvasScale} />}
						</div>
					)
				})}
			</div>

			{/* Zoom indicator */}
			<div className="absolute bottom-3 right-3 rounded-lg bg-[#1a1b2e] px-3 py-1 text-[10px] text-zinc-500">
				{Math.round(canvasScale * 100)}%
			</div>
		</div>
	)
}
