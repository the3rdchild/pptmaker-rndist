/**
 * Slide / Element data model — ported from PPTist (Vue) to React/Next.js.
 * const enum → union string types (isolatedModules-safe).
 *
 * Canvas coordinate system: logical pixels, origin top-left.
 * Default canvas = 1000 x (1000 * viewportRatio). 16:9 → 1000 x 562.5.
 */

// ── Shape path formulas (keypoints-based shapes) ──
export type ShapePathFormulasKeys =
	| 'roundRect' | 'roundRectDiagonal' | 'roundRectSingle' | 'roundRectSameSide'
	| 'cutRectDiagonal' | 'cutRectSingle' | 'cutRectSameSide' | 'cutRoundRect'
	| 'message' | 'roundMessage' | 'L' | 'ringRect' | 'plus' | 'triangle'
	| 'parallelogramLeft' | 'parallelogramRight' | 'trapezoid' | 'bullet'
	| 'indicator' | 'donut' | 'diagStripe'

export type ElementTypes =
	| 'text' | 'image' | 'shape' | 'line' | 'chart' | 'table' | 'latex' | 'video' | 'audio'

// ── Gradient ──
export type GradientType = 'linear' | 'radial'
export type GradientColor = { pos: number; color: string }
export interface Gradient {
	type: GradientType
	colors: GradientColor[]
	rotate: number
}

// ── Line / outline ──
export type LineStyleType = 'solid' | 'dashed' | 'dotted'

// ── Shadow ──
export interface PPTElementShadow {
	h: number
	v: number
	blur: number
	color: string
}

// ── Outline / border ──
export interface PPTElementOutline {
	style?: LineStyleType
	width?: number
	color?: string
}

// ── Hyperlink ──
export type ElementLinkType = 'web' | 'slide'
export interface PPTElementLink {
	type: ElementLinkType
	target: string
}

// ── Text alignment ──
export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type TextAlignVertical = 'top' | 'middle' | 'bottom'

// ── Base element (all element types extend this) ──
export interface PPTBaseElement {
	id: string
	left: number
	top: number
	lock?: boolean
	groupId?: string
	width: number
	height: number
	rotate: number
	link?: PPTElementLink
	name?: string
}

// ── Text element ──
export type TextType =
	| 'title' | 'subtitle' | 'content' | 'item' | 'itemTitle'
	| 'notes' | 'header' | 'footer' | 'partNumber' | 'itemNumber'
export type TextInset = [number, number, number, number]

export interface PPTTextElement extends PPTBaseElement {
	type: 'text'
	content: string              // HTML string (rich text)
	defaultFontName: string
	defaultColor: string
	outline?: PPTElementOutline
	fill?: string
	lineHeight?: number
	wordSpace?: number
	opacity?: number
	shadow?: PPTElementShadow
	paragraphSpace?: number
	vertical?: boolean
	textType?: TextType
	inset?: TextInset
	fixedHeight?: boolean
	vAlign?: TextAlignVertical
}

// ── Image element ──
export type ImageElementFilterKeys =
	| 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'saturate'
	| 'hue-rotate' | 'opacity' | 'sepia' | 'invert'

export interface ImageElementFilters {
	'blur'?: string
	'brightness'?: string
	'contrast'?: string
	'grayscale'?: string
	'saturate'?: string
	'hue-rotate'?: string
	'sepia'?: string
	'invert'?: string
	'opacity'?: string
}

export type ImageClipDataRange = [[number, number], [number, number]]

export interface ImageElementClip {
	range: ImageClipDataRange
	shape: string
}

export type ImageType = 'pageFigure' | 'itemFigure' | 'background'

export interface PPTImageElement extends PPTBaseElement {
	type: 'image'
	fixedRatio: boolean
	src: string
	outline?: PPTElementOutline
	filters?: ImageElementFilters
	clip?: ImageElementClip
	flipH?: boolean
	flipV?: boolean
	shadow?: PPTElementShadow
	radius?: number
	colorMask?: string
	imageType?: ImageType
}

// ── Shape element ──
export interface ShapeText {
	content: string
	defaultFontName: string
	defaultColor: string
	align: TextAlignVertical
	lineHeight?: number
	wordSpace?: number
	paragraphSpace?: number
	inset?: TextInset
	type?: TextType
}

export interface PPTShapeElement extends PPTBaseElement {
	type: 'shape'
	viewBox: [number, number]
	path: string
	fixedRatio: boolean
	fill: string
	gradient?: Gradient
	pattern?: string
	outline?: PPTElementOutline
	opacity?: number
	flipH?: boolean
	flipV?: boolean
	shadow?: PPTElementShadow
	special?: boolean
	text?: ShapeText
	pathFormula?: ShapePathFormulasKeys
	keypoints?: number[]
}

// ── Line element (special: omits height & rotate) ──
export type LinePoint = '' | 'arrow' | 'dot'
export type Broken2LineDirection = 'horizontal' | 'vertical'

export interface PPTLineElement extends Omit<PPTBaseElement, 'height' | 'rotate'> {
	type: 'line'
	start: [number, number]
	end: [number, number]
	style: LineStyleType
	color: string
	points: [LinePoint, LinePoint]
	shadow?: PPTElementShadow
	broken?: [number, number]
	broken2?: [number, number]
	broken2Direction?: Broken2LineDirection
	curve?: [number, number]
	cubic?: [[number, number], [number, number]]
}

// ── Chart element (deferred for Beta, but typed) ──
export type ChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter'
export interface ChartOptions {
	lineSmooth?: boolean
	stack?: boolean
}
export interface ChartData {
	labels: string[]
	legends: string[]
	series: number[][]
}
export interface PPTChartElement extends PPTBaseElement {
	type: 'chart'
	fill?: string
	chartType: ChartType
	data: ChartData
	options?: ChartOptions
	outline?: PPTElementOutline
	themeColors: string[]
	textColor?: string
	lineColor?: string
}

// ── Table element (deferred for Beta, but typed) ──
export interface TableCellStyle {
	bold?: boolean
	em?: boolean
	underline?: boolean
	strikethrough?: boolean
	color?: string
	backcolor?: string
	fontsize?: string
	fontname?: string
	align?: TextAlign
	vAlign?: TextAlignVertical
}
export interface TableCell {
	id: string
	colspan: number
	rowspan: number
	text: string
	style?: TableCellStyle
}
export interface TableTheme {
	color: string
	rowHeader: boolean
	rowFooter: boolean
	colHeader: boolean
	colFooter: boolean
}
export interface PPTTableElement extends PPTBaseElement {
	type: 'table'
	outline: PPTElementOutline
	theme?: TableTheme
	colWidths: number[]
	cellMinHeight: number
	data: TableCell[][]
}

// ── LaTeX element (deferred for Beta, but typed) ──
export interface PPTLatexElement extends PPTBaseElement {
	type: 'latex'
	latex: string
	path: string
	color: string
	strokeWidth: number
	viewBox: [number, number]
	fixedRatio: boolean
}

// ── Video element (deferred for Beta, but typed) ──
export interface PPTVideoElement extends PPTBaseElement {
	type: 'video'
	src: string
	autoplay: boolean
	poster?: string
	ext?: string
}

// ── Audio element (deferred for Beta, but typed) ──
export interface PPTAudioElement extends PPTBaseElement {
	type: 'audio'
	fixedRatio: boolean
	color: string
	loop: boolean
	autoplay: boolean
	src: string
	ext?: string
}

// ── Element union ──
export type PPTElement =
	| PPTTextElement
	| PPTImageElement
	| PPTShapeElement
	| PPTLineElement
	| PPTChartElement
	| PPTTableElement
	| PPTLatexElement
	| PPTVideoElement
	| PPTAudioElement

// ── Animations (per-slide, deferred for Beta) ──
export type AnimationType = 'in' | 'out' | 'attention'
export type AnimationTrigger = 'click' | 'meantime' | 'auto'
export interface PPTAnimation {
	id: string
	elId: string
	effect: string
	type: AnimationType
	duration: number
	trigger: AnimationTrigger
}

// ── Slide background ──
export type SlideBackgroundType = 'solid' | 'image' | 'gradient'
export type SlideBackgroundImageSize = 'cover' | 'contain' | 'repeat'
export interface SlideBackgroundImage {
	src: string
	size: SlideBackgroundImageSize
}
export interface SlideBackground {
	type: SlideBackgroundType
	color?: string
	image?: SlideBackgroundImage
	gradient?: Gradient
}

// ── Slide-level types ──
export type TurningMode =
	| 'no' | 'fade' | 'slideX' | 'slideY' | 'random'
	| 'slideX3D' | 'slideY3D' | 'rotate' | 'scaleY' | 'scaleX' | 'scale' | 'scaleReverse'

export interface SectionTag {
	id: string
	title?: string
}
export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end'

export interface Slide {
	id: string
	elements: PPTElement[]
	notes?: unknown[]
	remark?: string
	background?: SlideBackground
	animations?: PPTAnimation[]
	turningMode?: TurningMode
	sectionTag?: SectionTag
	type?: SlideType
}

// ── Theme ──
export interface SlideTheme {
	backgroundColor: string
	themeColors: string[]
	fontColor: string
	fontName: string
	outline: PPTElementOutline
	shadow: PPTElementShadow
}
export interface SlideTemplate {
	name: string
	id: string
	cover: string
	origin?: string
}
