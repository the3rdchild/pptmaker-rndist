'use client'

import type { PPTImageElement } from '@/lib/types/slides'

export function ImageElement({ el }: { el: PPTImageElement }) {
	const { left, top, width, height, rotate, src, flipH, flipV, radius } = el

	const wrapperStyle: React.CSSProperties = {
		position: 'absolute',
		left, top, width, height,
		transform: `rotate(${rotate}deg)`,
	}

	const imgStyle: React.CSSProperties = {
		width: '100%',
		height: '100%',
		objectFit: 'cover',
		borderRadius: radius,
		transform: `${flipH ? 'scaleX(-1)' : ''} ${flipV ? 'scaleY(-1)' : ''}`.trim() || undefined,
		display: 'block',
	}

	return (
		<div style={wrapperStyle}>
			<img src={src} alt="" style={imgStyle} draggable={false} />
		</div>
	)
}
