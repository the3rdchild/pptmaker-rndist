'use client'

import type { PPTElement } from '@/lib/types/slides'
import { TextElement } from '../elements/text-element'
import { ImageElement } from '../elements/image-element'
import { ShapeElement } from '../elements/shape-element'

export function EditableElement({ el }: { el: PPTElement }) {
	switch (el.type) {
		case 'text':
			return <TextElement el={el} />
		case 'image':
			return <ImageElement el={el} />
		case 'shape':
			return <ShapeElement el={el} />
		default:
			return null
	}
}
