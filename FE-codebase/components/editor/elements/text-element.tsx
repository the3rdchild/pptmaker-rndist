'use client'

import type { PPTTextElement } from '@/lib/types/slides'

export function TextElement({ el }: { el: PPTTextElement }) {
	const {
		left, top, width, height, rotate, content,
		fill, opacity, lineHeight, vertical, inset, vAlign,
	} = el

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

	return (
		<div style={wrapperStyle}>
			<div style={innerStyle}>
				<div
					className="ppt-text-content"
					style={{ writingMode: vertical ? 'vertical-rl' : 'horizontal-tb' }}
					dangerouslySetInnerHTML={{ __html: content }}
				/>
			</div>
		</div>
	)
}
