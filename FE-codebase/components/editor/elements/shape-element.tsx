'use client'

import type { PPTShapeElement } from '@/lib/types/slides'

export function ShapeElement({ el }: { el: PPTShapeElement }) {
	const {
		left, top, width, height, rotate,
		viewBox, path, fill, gradient, opacity, flipH, flipV, outline, text,
	} = el

	const [vbW, vbH] = viewBox

	const wrapperStyle: React.CSSProperties = {
		position: 'absolute',
		left, top, width, height,
		transform: `rotate(${rotate}deg)`,
		opacity: opacity ?? 1,
	}

	const scaleX = width / vbW
	const scaleY = height / vbH

	const gradId = gradient ? `grad-${el.id}` : undefined

	return (
		<div style={wrapperStyle}>
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${vbW} ${vbH}`}
				style={{
					transform: `${flipH ? 'scaleX(-1)' : ''} ${flipV ? 'scaleY(-1)' : ''}`.trim() || undefined,
					overflow: 'visible',
				}}
			>
				{gradient && gradId && (
					<defs>
						<linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
							{gradient.colors.map((c, i) => (
								<stop key={i} offset={`${c.pos}%`} stopColor={c.color} />
							))}
						</linearGradient>
					</defs>
				)}
				<path
					d={path}
					fill={gradient && gradId ? `url(#${gradId})` : fill}
					stroke={outline?.color}
					strokeWidth={outline?.width}
					strokeDasharray={outline?.style === 'dashed' ? '8 4' : outline?.style === 'dotted' ? '2 4' : undefined}
					transform={`scale(${scaleX} ${scaleY})`}
				/>
			</svg>
			{text && (
				<div style={{
					position: 'absolute', inset: 0,
					display: 'flex',
					alignItems: text.align === 'top' ? 'flex-start' : text.align === 'bottom' ? 'flex-end' : 'center',
					justifyContent: 'center',
					padding: text.inset ? `${text.inset[0]}px ${text.inset[1]}px ${text.inset[2]}px ${text.inset[3]}px` : '10px',
					pointerEvents: 'none',
				}}>
					<div
						style={{
							color: text.defaultColor,
							fontFamily: text.defaultFontName,
							lineHeight: text.lineHeight ?? 1.5,
						}}
						dangerouslySetInnerHTML={{ __html: text.content }}
					/>
				</div>
			)}
		</div>
	)
}
