import type { Slide, SlideTheme } from './slides'

/**
 * Root presentation type — the full deck.
 * This is what gets serialized to the `deck.payload` jsonb column in Postgres.
 */
export interface Presentation {
	title: string
	width: number            // canvas width in px (== viewportSize)
	height: number           // canvas height in px (== viewportSize * viewportRatio)
	viewportSize: number     // base canvas width (default 1000)
	viewportRatio: number    // height/width ratio (16:9 = 0.5625)
	theme: SlideTheme
	slides: Slide[]
}

/** Default 16:9 viewport. */
export const DEFAULT_VIEWPORT_SIZE = 1000
export const DEFAULT_VIEWPORT_RATIO = 0.5625 // 16:9

export const DEFAULT_THEME: SlideTheme = {
	backgroundColor: '#ffffff',
	themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
	fontColor: '#333333',
	fontName: '',
	outline: { width: 2, color: '#525252', style: 'solid' },
	shadow: { h: 3, v: 3, blur: 2, color: '#808080' },
}

/** Create an empty presentation with one blank slide. */
export function createEmptyPresentation(title = 'Untitled Presentation'): Presentation {
	return {
		title,
		width: DEFAULT_VIEWPORT_SIZE,
		height: DEFAULT_VIEWPORT_SIZE * DEFAULT_VIEWPORT_RATIO,
		viewportSize: DEFAULT_VIEWPORT_SIZE,
		viewportRatio: DEFAULT_VIEWPORT_RATIO,
		theme: { ...DEFAULT_THEME },
		slides: [],
	}
}
