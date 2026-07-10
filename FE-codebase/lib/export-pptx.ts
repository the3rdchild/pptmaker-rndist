/**
 * Export presentation to PPTX using pptxgenjs.
 * Focused port of PPTist's useExport.ts — handles text, shape, image elements
 * (the types our Beta editor + AI layouts produce).
 *
 * Coordinate conversion: pptist uses a 1000px-wide logical canvas.
 * pptxgenjs uses inches. ratio = 96 * (viewportSize / 960).
 */
import pptxgen from 'pptxgenjs'
import { saveAs } from 'file-saver'
import type { Presentation } from './types/presentation'
import type {
	PPTElement,
	PPTTextElement,
	PPTShapeElement,
	PPTImageElement,
	Slide,
} from './types/slides'

function stripHtml(html: string): { text: string; bold: boolean } {
	// Simple HTML → plain text for pptxgenjs. Rich text export deferred.
	const tmp = document.createElement('div')
	tmp.innerHTML = html
	return { text: tmp.textContent || '', bold: /<b|font-weight:\s*700|<strong/i.test(html) }
}

function extractFontSize(html: string, fallback: number): number {
	const m = html.match(/font-size:(\d+)px/i)
	return m ? Number(m[1]) : fallback
}

export async function exportPPTX(presentation: Presentation): Promise<void> {
	const pptx = new pptxgen()
	const vpSize = presentation.viewportSize
	const vpRatio = presentation.viewportRatio

	// Define layout
	const layoutName = vpRatio === 0.5625 ? 'LAYOUT_WIDE' : 'CUSTOM'
	if (vpRatio !== 0.5625) {
		pptx.defineLayout({ name: layoutName, width: 13.333, height: 13.333 * vpRatio })
		pptx.layout = layoutName
	} else {
		pptx.layout = 'LAYOUT_WIDE'
	}

	// Conversion: pptist px → inches
	const ratio = 96 * (vpSize / 960)
	const toInch = (px: number) => px / ratio
	const toPt = (px: number) => px / (ratio / 72 * 96)

	for (const slide of presentation.slides) {
		const s = pptx.addSlide()
		// Background
		if (slide.background?.type === 'solid' && slide.background.color) {
			s.background = { color: slide.background.color.replace('#', '') }
		}

		for (const el of slide.elements) {
			try {
				if (el.type === 'text') {
					addText(s, el, toInch, toPt)
				} else if (el.type === 'shape') {
					addShape(s, el, toInch)
				} else if (el.type === 'image') {
					addImage(s, el, toInch)
				}
			} catch (e) {
				console.warn('Export element failed:', el.type, e)
			}
		}
	}

	// Generate & save
	const blob = await pptx.write({ outputType: 'blob' }) as Blob
	saveAs(blob, `${presentation.title || 'presentation'}.pptx`)
}

function addText(
	s: pptxgen.Slide,
	el: PPTTextElement,
	toInch: (n: number) => number,
	toPt: (n: number) => number,
) {
	const { text, bold } = stripHtml(el.content)
	const fontSize = extractFontSize(el.content, 20)

	s.addText(text, {
		x: toInch(el.left),
		y: toInch(el.top),
		w: toInch(el.width),
		h: toInch(el.height),
		fontSize: toPt(fontSize),
		fontFace: el.defaultFontName || undefined,
		color: (el.defaultColor || '#333').replace('#', ''),
		bold,
		align: 'left',
		valign: el.vAlign === 'middle' ? 'middle' : el.vAlign === 'bottom' ? 'bottom' : 'top',
		fill: el.fill && el.fill !== 'transparent' ? { color: el.fill.replace('#', '') } : undefined,
		rotate: el.rotate || undefined,
		lineSpacingMultiple: el.lineHeight,
	})
}

function addShape(
	s: pptxgen.Slide,
	el: PPTShapeElement,
	toInch: (n: number) => number,
) {
	// Use rect shape as baseline; complex SVG paths exported as image would need more work
	const fillColor = el.fill?.replace('#', '')

	s.addShape('rect', {
		x: toInch(el.left),
		y: toInch(el.top),
		w: toInch(el.width),
		h: toInch(el.height),
		fill: { color: fillColor || '999999' },
		line: el.outline ? { color: el.outline.color?.replace('#', ''), width: el.outline.width } : undefined,
		rotate: el.rotate || undefined,
		rectRadius: 0,
	})

	// Shape text overlay
	if (el.text) {
		const { text: shapeText } = stripHtml(el.text.content)
		s.addText(shapeText, {
			x: toInch(el.left),
			y: toInch(el.top),
			w: toInch(el.width),
			h: toInch(el.height),
			fontSize: 16,
			color: (el.text.defaultColor || '#fff').replace('#', ''),
			align: 'center',
			valign: el.text.align === 'top' ? 'top' : el.text.align === 'bottom' ? 'bottom' : 'middle',
		})
	}
}

function addImage(
	s: pptxgen.Slide,
	el: PPTImageElement,
	toInch: (n: number) => number,
) {
	if (!el.src) return
	s.addImage({
		data: el.src.startsWith('data:') ? el.src : undefined,
		path: el.src.startsWith('data:') ? undefined : el.src,
		x: toInch(el.left),
		y: toInch(el.top),
		w: toInch(el.width),
		h: toInch(el.height),
		rotate: el.rotate || undefined,
		rounding: el.radius ? true : undefined,
	})
}
