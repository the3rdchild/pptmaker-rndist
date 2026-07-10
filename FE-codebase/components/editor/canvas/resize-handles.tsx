'use client'

import { useRef } from 'react'
import { useEditorStore } from '@/store/editor.store'
import type { PPTElement } from '@/lib/types/slides'

// 8 resize points: corners + edges
const HANDLES = [
	{ id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
	{ id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
	{ id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
	{ id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
	{ id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
	{ id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
	{ id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
	{ id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
] as const

const HANDLE_SIZE = 8 // px in screen space

export function ResizeHandles({ el, scale }: { el: PPTElement; scale: number }) {
	// Lines have no width/height geometry — skip handles for them
	if (el.type === 'line') return null
	const geo = el as PPTElement & { left: number; top: number; width: number; height: number }
	const { updateElement, pushHistory } = useEditorStore()
	const dragData = useRef<{ handle: string; startX: number; startY: number; origLeft: number; origTop: number; origW: number; origH: number } | null>(null)

	// Handle sizes are in screen px, so divide by scale to position in canvas coords
	const hs = HANDLE_SIZE / scale

	const onHandleDown = (e: React.MouseEvent, handle: string) => {
		e.stopPropagation()
		e.preventDefault()

		dragData.current = {
			handle,
			startX: e.clientX,
			startY: e.clientY,
			origLeft: geo.left,
			origTop: geo.top,
			origW: geo.width,
			origH: geo.height,
		}

		const onMove = (ev: MouseEvent) => {
			const d = dragData.current
			if (!d) return
			const dx = (ev.clientX - d.startX) / scale
			const dy = (ev.clientY - d.startY) / scale

			let { origLeft: l, origTop: t, origW: w, origH: h } = d
			const h_id = d.handle

			// Horizontal
			if (h_id.includes('e')) w = d.origW + dx
			if (h_id.includes('w')) { w = d.origW - dx; l = d.origLeft + dx }
			// Vertical
			if (h_id.includes('s')) h = d.origH + dy
			if (h_id.includes('n')) { h = d.origH - dy; t = d.origTop + dy }

			// Min size
			w = Math.max(20, w)
			h = Math.max(20, h)

			updateElement(el.id, { left: l, top: t, width: w, height: h })
		}

		const onUp = () => {
			if (dragData.current) pushHistory()
			dragData.current = null
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
		}

		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	}

	return (
		<>
			{HANDLES.map((h) => (
				<div
					key={h.id}
					onMouseDown={(e) => onHandleDown(e, h.id)}
					style={{
						position: 'absolute',
						left: h.x * geo.width - hs / 2,
						top: h.y * geo.height - hs / 2,
						width: hs,
						height: hs,
						background: '#fff',
						border: `${1 / scale}px solid #6c5ce7`,
						borderRadius: hs / 4,
						cursor: h.cursor,
						zIndex: 200,
					}}
				/>
			))}
		</>
	)
}
