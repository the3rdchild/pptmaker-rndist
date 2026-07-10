'use client'

import { useRef, useCallback, useEffect } from 'react'
import { useEditorStore } from '@/store/editor.store'
import { EditableElement } from './editable-element'
import type { PPTElement } from '@/lib/types/slides'

export function Viewport() {
	const containerRef = useRef<HTMLDivElement>(null)
	const { presentation, slideIndex, canvasScale, activeElementIds } = useEditorStore()
	const { selectElements, clearSelection, updateElement, pushHistory, setCanvasScale } = useEditorStore()

	const slide = presentation.slides[slideIndex]
	const vpSize = presentation.viewportSize
	const vpRatio = presentation.viewportRatio

	// Auto-fit canvas scale to container
	const fitCanvas = useCallback(() => {
		const container = containerRef.current
		if (!container) return
		const availW = container.clientWidth - 80
		const availH = container.clientHeight - 80
		const scaleW = availW / vpSize
		const scaleH = availH / (vpSize * vpRatio)
		const scale = Math.min(scaleW, scaleH, 1)
		setCanvasScale(Math.max(0.1, scale))
	}, [vpSize, vpRatio, setCanvasScale])

	useEffect(() => {
		fitCanvas()
		const ro = new ResizeObserver(() => fitCanvas())
		if (containerRef.current) ro.observe(containerRef.current)
		return () => ro.disconnect()
	}, [fitCanvas])

	// Drag handler
	const dragState = useRef<{ id: string; startX: number; startY: number; origLeft: number; origTop: number } | null>(null)

	const handleElementMouseDown = (e: React.MouseEvent, el: PPTElement) => {
		e.stopPropagation()
		selectElements([el.id])

		if (el.type === 'line') return // lines have special geometry, skip drag for now

		dragState.current = {
			id: el.id,
			startX: e.clientX,
			startY: e.clientY,
			origLeft: el.left,
			origTop: el.top,
		}

		const onMove = (ev: MouseEvent) => {
			const ds = dragState.current
			if (!ds) return
			const dx = (ev.clientX - ds.startX) / canvasScale
			const dy = (ev.clientY - ds.startY) / canvasScale
			updateElement(ds.id, { left: ds.origLeft + dx, top: ds.origTop + dy })
		}

		const onUp = () => {
			if (dragState.current) {
				pushHistory()
			}
			dragState.current = null
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
		}

		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	}

	const bg = slide?.background
	const bgStyle: React.CSSProperties = bg?.type === 'solid'
		? { background: bg.color }
		: bg?.type === 'image'
			? { backgroundImage: `url(${bg.image?.src})`, backgroundSize: bg.image?.size }
			: { background: '#ffffff' }

	if (!slide) {
		return <div ref={containerRef} className="flex flex-1 items-center justify-center text-zinc-500">No slide</div>
	}

	return (
		<div
			ref={containerRef}
			className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1a1b2e]"
			onMouseDown={() => clearSelection()}
		>
			{/* The scaled canvas */}
			<div
				className="relative shadow-2xl"
				style={{
					width: vpSize,
					height: vpSize * vpRatio,
					transform: `scale(${canvasScale})`,
					transformOrigin: 'center center',
					...bgStyle,
				}}
				onMouseDown={(e) => e.stopPropagation()}
			>
				{slide.elements.map((el) => (
					<div
						key={el.id}
						onMouseDown={(e) => handleElementMouseDown(e, el)}
						style={{
							cursor: activeElementIds.includes(el.id) ? 'move' : 'pointer',
							outline: activeElementIds.includes(el.id) ? '2px solid #6c5ce7' : 'none',
							outlineOffset: 0,
						}}
					>
						<EditableElement el={el} />
					</div>
				))}
			</div>
		</div>
	)
}
