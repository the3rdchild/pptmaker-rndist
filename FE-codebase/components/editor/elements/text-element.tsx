'use client'

import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '@/store/editor.store'
import type { PPTTextElement } from '@/lib/types/slides'

export function TextElement({ el }: { el: PPTTextElement }) {
	const { activeElementIds, updateElement, pushHistory } = useEditorStore()
	const [editing, setEditing] = useState(false)
	const editRef = useRef<HTMLDivElement>(null)
	const isSelected = activeElementIds.includes(el.id)

	const {
		left, top, width, height, rotate, content,
		fill, opacity, lineHeight, vertical, inset, vAlign,
	} = el

	// Enter edit mode on double-click
	const handleDoubleClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		setEditing(true)
	}

	// Focus when entering edit mode
	useEffect(() => {
		if (editing && editRef.current) {
			editRef.current.focus()
			// Place cursor at end
			const sel = window.getSelection()
			const range = document.createRange()
			range.selectNodeContents(editRef.current)
			range.collapse(false)
			sel?.removeAllRanges()
			sel?.addRange(range)
		}
	}, [editing])

	const handleBlur = () => {
		if (!editRef.current) return
		const html = editRef.current.innerHTML
		if (html !== content) {
			updateElement(el.id, { content: html })
			pushHistory()
		}
		setEditing(false)
	}

	const wrapperStyle: React.CSSProperties = {
		position: 'absolute',
		left, top, width, height,
		transform: `rotate(${rotate}deg)`,
	}

	const innerStyle: React.CSSProperties = {
		width: '100%',
		height: '100%',
		backgroundColor: fill ?? 'transparent',
		opacity: opacity ?? 1,
		display: 'flex',
		flexDirection: vertical ? 'row' : 'column',
		justifyContent: vAlign === 'middle' ? 'center' : vAlign === 'bottom' ? 'flex-end' : 'flex-start',
		padding: inset ? `${inset[0]}px ${inset[1]}px ${inset[2]}px ${inset[3]}px` : '10px',
		overflow: 'hidden',
		lineHeight: lineHeight ?? 1.5,
	}

	// Style for editable content — make sure it's visible
	const editableStyle: React.CSSProperties = {
		writingMode: vertical ? 'vertical-rl' : 'horizontal-tb',
		outline: 'none',
		cursor: editing ? 'text' : undefined,
		minHeight: '1em',
		width: '100%',
	}

	return (
		<div style={wrapperStyle} onDoubleClick={handleDoubleClick}>
			<div style={innerStyle}>
				{editing ? (
					<div
						ref={editRef}
						contentEditable
						suppressContentEditableWarning
						onBlur={handleBlur}
						style={editableStyle}
						dangerouslySetInnerHTML={{ __html: content }}
					/>
				) : (
					<div
						className="ppt-text-content"
						style={{ ...editableStyle, cursor: isSelected ? 'move' : 'pointer' }}
						dangerouslySetInnerHTML={{ __html: content }}
					/>
				)}
			</div>
		</div>
	)
}
