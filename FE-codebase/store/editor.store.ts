'use client'

import { create } from 'zustand'
import type {
	PPTElement,
	Slide,
	SlideBackground,
	SlideTheme,
} from '@/lib/types/slides'
import type { Presentation } from '@/lib/types/presentation'
import { DEFAULT_THEME, DEFAULT_VIEWPORT_SIZE, DEFAULT_VIEWPORT_RATIO, createEmptyPresentation } from '@/lib/types/presentation'

interface EditorState {
	// deck data
	presentation: Presentation
	deckId: string | null
	slideIndex: number

	// selection
	activeElementIds: string[]

	// viewport
	canvasScale: number

	// dirty + saving
	dirty: boolean
	saving: boolean

	// history (undo/redo) — snapshot of slides
	history: Slide[][]
	historyIndex: number

	// actions
	loadDeck: (deckId: string, data: Presentation) => void
	setSlideIndex: (i: number) => void
	setCanvasScale: (s: number) => void

	// element ops
	updateElement: (id: string, props: Partial<PPTElement>) => void
	addElement: (element: PPTElement) => void
	deleteElement: (id: string) => void
	selectElements: (ids: string[]) => void
	clearSelection: () => void

	// slide ops
	addSlide: (slide?: Slide) => void
	deleteSlide: (index: number) => void
	duplicateSlide: (index: number) => void
	moveSlide: (from: number, to: number) => void
	updateSlide: (index: number, props: Partial<Slide>) => void

	// deck ops
	setTitle: (title: string) => void

	// history
	pushHistory: () => void
	undo: () => void
	redo: () => void

	// save
	markDirty: () => void
	setSaving: (s: boolean) => void
}

function makeId(): string {
	return Math.random().toString(36).slice(2, 12)
}

function emptySlide(): Slide {
	return { id: makeId(), elements: [] }
}

export const useEditorStore = create<EditorState>((set, get) => ({
	presentation: createEmptyPresentation(),
	deckId: null,
	slideIndex: 0,
	activeElementIds: [],
	canvasScale: 0.6,
	dirty: false,
	saving: false,
	history: [[]],
	historyIndex: 0,

	loadDeck: (deckId, data) => {
		set({
			presentation: data,
			deckId,
			slideIndex: 0,
			activeElementIds: [],
			dirty: false,
			history: [data.slides],
			historyIndex: 0,
		})
	},

	setSlideIndex: (i) => set((s) => ({ slideIndex: i, activeElementIds: [] })),
	setCanvasScale: (scale) => set({ canvasScale: scale }),

	updateElement: (id, props) =>
		set((s) => {
			const slides = [...s.presentation.slides]
			const idx = s.slideIndex
			if (!slides[idx]) return {}
			slides[idx] = {
				...slides[idx],
				elements: slides[idx].elements.map((el) =>
					el.id === id ? { ...el, ...props } as PPTElement : el
				),
			}
			return { presentation: { ...s.presentation, slides }, dirty: true }
		}),

	addElement: (element) =>
		set((s) => {
			const slides = [...s.presentation.slides]
			const idx = s.slideIndex
			if (!slides[idx]) return {}
			slides[idx] = { ...slides[idx], elements: [...slides[idx].elements, element] }
			return { presentation: { ...s.presentation, slides }, activeElementIds: [element.id], dirty: true }
		}),

	deleteElement: (id) =>
		set((s) => {
			const slides = [...s.presentation.slides]
			const idx = s.slideIndex
			if (!slides[idx]) return {}
			slides[idx] = { ...slides[idx], elements: slides[idx].elements.filter((el) => el.id !== id) }
			return {
				presentation: { ...s.presentation, slides },
				activeElementIds: s.activeElementIds.filter((eid) => eid !== id),
				dirty: true,
			}
		}),

	selectElements: (ids) => set({ activeElementIds: ids }),
	clearSelection: () => set({ activeElementIds: [] }),

	addSlide: (slide) =>
		set((s) => {
			const newSlide = slide ?? emptySlide()
			const slides = [...s.presentation.slides]
			slides.splice(s.slideIndex + 1, 0, newSlide)
			return { presentation: { ...s.presentation, slides }, slideIndex: s.slideIndex + 1, dirty: true }
		}),

	deleteSlide: (index) =>
		set((s) => {
			if (s.presentation.slides.length <= 1) return {}
			const slides = s.presentation.slides.filter((_, i) => i !== index)
			const newIndex = Math.min(index, slides.length - 1)
			return { presentation: { ...s.presentation, slides }, slideIndex: newIndex, dirty: true }
		}),

	duplicateSlide: (index) =>
		set((s) => {
			const original = s.presentation.slides[index]
			if (!original) return {}
			const copy: Slide = {
				...JSON.parse(JSON.stringify(original)),
				id: makeId(),
				elements: original.elements.map((el) => ({ ...el, id: makeId() })),
			}
			const slides = [...s.presentation.slides]
			slides.splice(index + 1, 0, copy)
			return { presentation: { ...s.presentation, slides }, slideIndex: index + 1, dirty: true }
		}),

	moveSlide: (from, to) =>
		set((s) => {
			const slides = [...s.presentation.slides]
			const [moved] = slides.splice(from, 1)
			slides.splice(to, 0, moved)
			return { presentation: { ...s.presentation, slides }, slideIndex: to, dirty: true }
		}),

	updateSlide: (index, props) =>
		set((s) => {
			const slides = [...s.presentation.slides]
			if (!slides[index]) return {}
			slides[index] = { ...slides[index], ...props }
			return { presentation: { ...s.presentation, slides }, dirty: true }
		}),

	setTitle: (title) => set((s) => ({ presentation: { ...s.presentation, title }, dirty: true })),

	pushHistory: () =>
		set((s) => {
			const newHistory = s.history.slice(0, s.historyIndex + 1)
			newHistory.push(JSON.parse(JSON.stringify(s.presentation.slides)))
			// cap at 30
			while (newHistory.length > 30) newHistory.shift()
			return { history: newHistory, historyIndex: newHistory.length - 1 }
		}),

	undo: () =>
		set((s) => {
			if (s.historyIndex <= 0) return {}
			const newIndex = s.historyIndex - 1
			return {
				presentation: { ...s.presentation, slides: JSON.parse(JSON.stringify(s.history[newIndex])) },
				historyIndex: newIndex,
				activeElementIds: [],
			}
		}),

	redo: () =>
		set((s) => {
			if (s.historyIndex >= s.history.length - 1) return {}
			const newIndex = s.historyIndex + 1
			return {
				presentation: { ...s.presentation, slides: JSON.parse(JSON.stringify(s.history[newIndex])) },
				historyIndex: newIndex,
				activeElementIds: [],
			}
		}),

	markDirty: () => set({ dirty: true }),
	setSaving: (saving) => set({ saving }),
}))
