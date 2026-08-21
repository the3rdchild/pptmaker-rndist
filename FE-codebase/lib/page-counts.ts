// How many pages the user asked for, shared by the homepage prompt box and the
// /outline toolbar so the choice made in one is the choice the other shows.
//
// Each option is a RANGE in the UI but a single number in the prompt: the
// midpoint. A model given "6-10" writes to the top of the range or past it; a
// model given "8" writes 8.

export const PAGE_COUNTS = [
	{ id: 'auto', label: 'Auto', slideCount: undefined },
	{ id: '4-6', label: '4-6 Pages', slideCount: 5 },
	{ id: '6-10', label: '6-10 Pages', slideCount: 8 },
	{ id: '10-15', label: '10-15 Pages', slideCount: 12 },
] as const

export type PageCountId = (typeof PAGE_COUNTS)[number]['id']

export const DEFAULT_PAGE_COUNT_ID: PageCountId = '6-10'

/** Query param carrying the choice from the homepage to /outline. */
export const PAGE_COUNT_PARAM = 'pages'

export function isPageCountId(value: string | null | undefined): value is PageCountId {
	return PAGE_COUNTS.some((option) => option.id === value)
}

export function pageCountLabel(id: PageCountId): string {
	return PAGE_COUNTS.find((option) => option.id === id)?.label ?? 'Auto'
}

export function pageCountFor(id: PageCountId): number | undefined {
	return PAGE_COUNTS.find((option) => option.id === id)?.slideCount
}

export function pageCountIdFromLabel(label: string): PageCountId {
	return PAGE_COUNTS.find((option) => option.label === label)?.id ?? DEFAULT_PAGE_COUNT_ID
}
