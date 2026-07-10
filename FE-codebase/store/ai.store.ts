'use client'

import { create } from 'zustand'

export type OutlineSlide = {
	title: string
	bullets: string[]
	layout: string
}

export type Outline = {
	title: string
	slides: OutlineSlide[]
}

export type GenStatus = 'idle' | 'submitting' | 'streaming' | 'done' | 'error'

interface AIState {
	// outline flow
	prompt: string
	slideCount: number
	language: string
	status: GenStatus
	outline: Outline | null
	error: string | null
	jobId: string | null

	setPrompt: (v: string) => void
	setSlideCount: (n: number) => void
	setLanguage: (l: string) => void
	setStatus: (s: GenStatus) => void
	setOutline: (o: Outline | null) => void
	setError: (e: string | null) => void
	setJobId: (id: string | null) => void
	reset: () => void
}

export const useAIStore = create<AIState>((set) => ({
	prompt: '',
	slideCount: 8,
	language: 'Bahasa Indonesia',
	status: 'idle',
	outline: null,
	error: null,
	jobId: null,

	setPrompt: (v) => set({ prompt: v }),
	setSlideCount: (n) => set({ slideCount: n }),
	setLanguage: (l) => set({ language: l }),
	setStatus: (s) => set({ status: s }),
	setOutline: (o) => set({ outline: o }),
	setError: (e) => set({ error: e }),
	setJobId: (id) => set({ jobId: id }),
	reset: () => set({ prompt: '', status: 'idle', outline: null, error: null, jobId: null }),
}))
