export const enum ShapePathFormulasKeys {
  ROUND_RECT = 'roundRect',
  ROUND_RECT_DIAGONAL = 'roundRectDiagonal',
  ROUND_RECT_SINGLE = 'roundRectSingle',
  ROUND_RECT_SAMESIDE = 'roundRectSameSide',
  CUT_RECT_DIAGONAL = 'cutRectDiagonal',
  CUT_RECT_SINGLE = 'cutRectSingle',
  CUT_RECT_SAMESIDE = 'cutRectSameSide',
  CUT_ROUND_RECT = 'cutRoundRect',
  MESSAGE = 'message',
  ROUND_MESSAGE = 'roundMessage',
  L = 'L',
  RING_RECT = 'ringRect',
  PLUS = 'plus',
  TRIANGLE = 'triangle',
  PARALLELOGRAM_LEFT = 'parallelogramLeft',
  PARALLELOGRAM_RIGHT = 'parallelogramRight',
  TRAPEZOID = 'trapezoid',
  BULLET = 'bullet',
  INDICATOR = 'indicator',
  DONUT = 'donut',
  DIAGSTRIPE = 'diagStripe',
}

export const enum ElementTypes {
  TEXT = 'text',
  IMAGE = 'image',
  SHAPE = 'shape',
  LINE = 'line',
  CHART = 'chart',
  TABLE = 'table',
  LATEX = 'latex',
  VIDEO = 'video',
  AUDIO = 'audio',
}

/**
 * Gradient
 * 
 * type: gradient type (radial, linear)
 * 
 * colors: list of gradient colors (pos: percentage position; color: color)
 * 
 * rotate: gradient angle (linear gradient)
 */
export type GradientType = 'linear' | 'radial'
export type GradientColor = {
  pos: number
  color: string
}
export interface Gradient {
  type: GradientType
  colors: GradientColor[]
  rotate: number
}

export type LineStyleType = 'solid' | 'dashed' | 'dotted'

/**
 * Element shadow
 * 
 * h: horizontal offset
 * 
 * v: vertical offset
 * 
 * blur: blur level
 * 
 * color: shadow color
 */
export interface PPTElementShadow {
  h: number
  v: number
  blur: number
  color: string
}

/**
 * Element border
 * 
 * style?: border style (solid or dashed)
 * 
 * width?: border width
 * 
 * color?: border color
 */
export interface PPTElementOutline {
  style?: LineStyleType
  width?: number
  color?: string
}

export type ElementLinkType = 'web' | 'slide'

/**
 * Element hyperlink
 * 
 * type: link type (web page, slide page)
 * 
 * target: target address (web link, slide page ID)
 */
export interface PPTElementLink {
  type: ElementLinkType
  target: string
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextAlignVertical = 'top' | 'middle' | 'bottom' 


/**
 * Common element properties
 * 
 * id: element ID
 * 
 * left: horizontal position of the element (distance from the left of the canvas)
 * 
 * top: vertical position of the element (distance from the top of the canvas)
 * 
 * lock?: lock the element
 * 
 * groupId?: group ID (elements with the same group ID are members of the same group)
 * 
 * width: element width
 * 
 * height: element height
 * 
 * rotate: rotation angle
 * 
 * link?: hyperlink
 * 
 * name?: element name
 */
interface PPTBaseElement {
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


export type TextType = 'title' | 'subtitle' | 'content' | 'item' | 'itemTitle' | 'notes' | 'header' | 'footer' | 'partNumber' | 'itemNumber'
export type TextInset = [number, number, number, number]

/**
 * Text element
 * 
 * type: element type (text)
 * 
 * content: text content (HTML string)
 * 
 * defaultFontName: default font (overridden by inline HTML styles in the text content)
 * 
 * defaultColor: default color (overridden by inline HTML styles in the text content)
 * 
 * outline?: border
 * 
 * fill?: fill color
 * 
 * lineHeight?: line height (multiple), default 1.5
 * 
 * wordSpace?: word spacing, default 0
 * 
 * opacity?: opacity, default 1
 * 
 * shadow?: shadow
 * 
 * paragraphSpace?: paragraph spacing, default 5px
 * 
 * vertical?: vertical text
 * 
 * textType?: text type
 * 
 * inset?: inner padding (top, right, bottom, left), default [10, 10, 10, 10]
 *
 * fixedHeight?: fixed text box auto-fit axis size; horizontal text uses a fixed height, vertical text uses a fixed width
 *
 * vAlign?: vertical alignment within the text box, only effective when fixedHeight is true, default top
 */
export interface PPTTextElement extends PPTBaseElement {
  type: 'text'
  content: string
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


/**
 * Image flip, shape flip
 * 
 * flipH?: horizontal flip
 * 
 * flipV?: vertical flip
 */
export interface ImageOrShapeFlip {
  flipH?: boolean
  flipV?: boolean
}

/**
 * Image filters
 * 
 * https://developer.mozilla.org/zh-CN/docs/Web/CSS/filter
 * 
 * 'blur'?: blur, default 0 (px)
 * 
 * 'brightness'?: brightness, default 100 (%)
 * 
 * 'contrast'?: contrast, default 100 (%)
 * 
 * 'grayscale'?: grayscale, default 0 (%)
 * 
 * 'saturate'?: saturation, default 100 (%)
 * 
 * 'hue-rotate'?: hue rotation, default 0 (deg)
 * 
 * 'opacity'?: opacity, default 100 (%)
 */
export type ImageElementFilterKeys = 'blur' | 'brightness' | 'contrast' | 'grayscale' | 'saturate' | 'hue-rotate' | 'opacity' | 'sepia' | 'invert'
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

/**
 * Image clip
 * 
 * range: clip range, e.g. [[10, 10], [90, 90]] means cropping from the top-left of the original image at 10%, 10% to 90%, 90%
 * 
 * shape: clip shape, see configs/imageClip.ts CLIPPATHS 
 */
export interface ImageElementClip {
  range: ImageClipDataRange
  shape: string
}

export type ImageType = 'pageFigure' | 'itemFigure' | 'background'

/**
 * Image element
 * 
 * type: element type (image)
 * 
 * fixedRatio: fixed image aspect ratio
 * 
 * src: image address
 * 
 * outline?: border
 * 
 * filters?: image filters
 * 
 * clip?: clip information
 * 
 * flipH?: horizontal flip
 * 
 * flipV?: vertical flip
 * 
 * shadow?: shadow
 * 
 * radius?: corner radius
 * 
 * colorMask?: color mask
 * 
 * imageType?: image type
 */
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

/**
 * Text within a shape
 * 
 * content: text content (HTML string)
 * 
 * defaultFontName: default font (overridden by inline HTML styles in the text content)
 * 
 * defaultColor: default color (overridden by inline HTML styles in the text content)
 * 
 * align: text alignment (vertical)
 * 
 * lineHeight?: line height (multiple), default 1.5
 * 
 * wordSpace?: word spacing, default 0
 * 
 * paragraphSpace?: paragraph spacing, default 5px
 * 
 * type: text type
 * 
 * inset?: text inner padding (top, right, bottom, left), default [10, 10, 10, 10]
 */
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

/**
 * Shape element
 * 
 * type: element type (shape)
 * 
 * viewBox: SVG viewBox attribute, e.g. [1000, 1000] means '0 0 1000 1000'
 * 
 * path: shape path, the d attribute of SVG path
 * 
 * fixedRatio: fixed shape aspect ratio
 * 
 * fill: fill, takes effect when there is no gradient
 * 
 * gradient?: gradient, when present it will take priority as the fill
 * 
 * pattern?: pattern, when present it will take priority as the fill
 * 
 * outline?: border
 * 
 * opacity?: opacity
 * 
 * flipH?: horizontal flip
 * 
 * flipV?: vertical flip
 * 
 * shadow?: shadow
 * 
 * special?: special shape (marks shapes that are difficult to parse, e.g. paths using types other than L Q C A; such shapes become images after export)
 * 
 * text?: text within the shape
 * 
 * pathFormula?: shape path calculation formula
 * Normally, when a shape is resized, only the scaling ratio of width/height based on the viewBox is used to adjust the shape, while the viewBox itself and the path do not change.
 * However, some shapes need more precise control over the position of key points. In this case, a path calculation formula is required: when scaling, the viewBox is updated and the path is recalculated to redraw the shape.
 * 
 * keypoints?: key point position percentages
 */
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


export type LinePoint = '' | 'arrow' | 'dot' 
export type Broken2LineDirection = 'horizontal' | 'vertical'

/**
 * Line element
 * 
 * type: element type (line)
 * 
 * start: start position ([x, y])
 * 
 * end: end position ([x, y])
 * 
 * style: line style (solid, dashed, dotted)
 * 
 * color: line color
 * 
 * points: endpoint styles ([start style, end style], options: none, arrow, dot)
 * 
 * shadow?: shadow
 * 
 * broken?: broken line control point position ([x, y])
 * 
 * broken2?: double broken line control point position ([x, y])
 * 
 * broken2Direction?: double broken line direction
 * 
 * curve?: quadratic curve control point position ([x, y])
 * 
 * cubic?: cubic curve control point position ([[x1, y1], [x2, y2]])
 */
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

/**
 * Chart element
 * 
 * type: element type (chart)
 * 
 * fill?: fill color
 * 
 * chartType: base chart type (bar/line/pie); all chart types are derived from these three basic types
 * 
 * data: chart data
 * 
 * options: extended options
 * 
 * outline?: border
 * 
 * themeColors: theme colors
 * 
 * textColor?: axis and text color
 * 
 * lineColor?: grid color
 */
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


/**
 * Table cell style
 * 
 * bold?: bold
 * 
 * em?: italic
 * 
 * underline?: underline
 * 
 * strikethrough?: strikethrough
 * 
 * color?: font color
 * 
 * backcolor?: fill color
 * 
 * fontsize?: font size
 * 
 * fontname?: font
 * 
 * align?: alignment
 */
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


/**
 * Table cell
 * 
 * id: cell ID
 * 
 * colspan: number of merged columns
 * 
 * rowspan: number of merged rows
 * 
 * text: text content
 * 
 * style?: cell style
 */
export interface TableCell {
  id: string
  colspan: number
  rowspan: number
  text: string
  style?: TableCellStyle
}

/**
 * Table theme
 * 
 * color: theme color
 * 
 * rowHeader: header row
 * 
 * rowFooter: summary row
 * 
 * colHeader: first column
 * 
 * colFooter: last column
 */
export interface TableTheme {
  color: string
  rowHeader: boolean
  rowFooter: boolean
  colHeader: boolean
  colFooter: boolean
}

/**
 * Table element
 * 
 * type: element type (table)
 * 
 * outline: border
 * 
 * theme?: theme
 * 
 * colWidths: column width array, e.g. [0.3, 0.5, 0.2] means the three columns take up 30%, 50%, 20% of the total width respectively
 * 
 * cellMinHeight: minimum cell height
 * 
 * data: table data
 */
export interface PPTTableElement extends PPTBaseElement {
  type: 'table'
  outline: PPTElementOutline
  theme?: TableTheme
  colWidths: number[]
  cellMinHeight: number
  data: TableCell[][]
}


/**
 * LaTeX element (formula)
 * 
 * type: element type (latex)
 * 
 * latex: latex code
 * 
 * path: svg path
 * 
 * color: color
 * 
 * strokeWidth: path width
 * 
 * viewBox: SVG viewBox attribute
 * 
 * fixedRatio: fixed shape aspect ratio
 */
export interface PPTLatexElement extends PPTBaseElement {
  type: 'latex'
  latex: string
  path: string
  color: string
  strokeWidth: number
  viewBox: [number, number]
  fixedRatio: boolean
}

/**
 * Video element
 * 
 * type: element type (video)
 * 
 * src: video address
 * 
 * autoplay: autoplay
 * 
 * poster: preview cover
 * 
 * ext: video file extension; used to identify the resource type when the resource link is missing an extension
 */
export interface PPTVideoElement extends PPTBaseElement {
  type: 'video'
  src: string
  autoplay: boolean
  poster?: string
  ext?: string
}

/**
 * Audio element
 * 
 * type: element type (audio)
 * 
 * fixedRatio: fixed icon aspect ratio
 * 
 * color: icon color
 * 
 * loop: loop playback
 * 
 * autoplay: autoplay
 * 
 * src: audio address
 * 
 * ext: audio file extension; used to identify the resource type when the resource link is missing an extension
 */
export interface PPTAudioElement extends PPTBaseElement {
  type: 'audio'
  fixedRatio: boolean
  color: string
  loop: boolean
  autoplay: boolean
  src: string
  ext?: string
}


export type PPTElement = PPTTextElement | PPTImageElement | PPTShapeElement | PPTLineElement | PPTChartElement | PPTTableElement | PPTLatexElement | PPTVideoElement | PPTAudioElement

export type AnimationType = 'in' | 'out' | 'attention'
export type AnimationTrigger = 'click' | 'meantime' | 'auto'

/**
 * Element animation
 * 
 * id: animation id
 * 
 * elId: element ID
 * 
 * effect: animation effect
 * 
 * type: animation type (entrance, exit, emphasis)
 * 
 * duration: animation duration
 * 
 * trigger: animation trigger method (click - on click, meantime - simultaneously with the previous animation, auto - after the previous animation)
 */
export interface PPTAnimation {
  id: string
  elId: string
  effect: string
  type: AnimationType
  duration: number
  trigger: AnimationTrigger
}

export type SlideBackgroundType = 'solid' | 'image' | 'gradient'
export type SlideBackgroundImageSize = 'cover' | 'contain' | 'repeat'
export interface SlideBackgroundImage {
  src: string
  size: SlideBackgroundImageSize,
}

/**
 * Slide background
 * 
 * type: background type (solid color, image, gradient)
 * 
 * color?: background color (solid color)
 * 
 * image?: image background
 * 
 * gradientType?: gradient background
 */
export interface SlideBackground {
  type: SlideBackgroundType
  color?: string
  image?: SlideBackgroundImage
  gradient?: Gradient
}


export type TurningMode = 'no' | 'fade' | 'slideX' | 'slideY' | 'random' | 'slideX3D' | 'slideY3D' | 'rotate' | 'scaleY' | 'scaleX' | 'scale' | 'scaleReverse'

export interface NoteReply {
  id: string
  content: string
  time: number
  user: string
}

export interface Note {
  id: string
  content: string
  time: number
  user: string
  elId?: string
  replies?: NoteReply[]
}

export interface SectionTag {
  id: string
  title?: string
}

export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end'

/**
 * Slide page
 * 
 * id: page ID
 * 
 * elements: element collection
 * 
 * notes?: comments
 * 
 * remark?: notes
 * 
 * background?: page background
 * 
 * animations?: element animation collection
 * 
 * turningMode?: page turn mode
 * 
 * slideType?: page type
 */
export interface Slide {
  id: string
  elements: PPTElement[]
  notes?: Note[]
  remark?: string
  background?: SlideBackground
  animations?: PPTAnimation[]
  turningMode?: TurningMode
  sectionTag?: SectionTag
  type?: SlideType
}

/**
 * Slide theme
 * 
 * backgroundColor: page background color
 * 
 * themeColor: theme color, used for default created shape colors etc.
 * 
 * fontColor: font color
 * 
 * fontName: font
 */
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
