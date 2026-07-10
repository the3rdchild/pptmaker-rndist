import { z } from 'zod'

// ── Outline generation ──
export const generateOutlineSchema = z.object({
	prompt: z.string().trim().min(3, 'Prompt too short').max(5000),
	slideCount: z.number().int().min(3).max(20).optional().default(8),
	language: z.string().trim().max(50).optional().default('Bahasa Indonesia'),
	title: z.string().trim().max(255).optional(),
})

// ── Deck generation (from approved outline) ──
export const generateDeckSchema = z.object({
	outline: z.record(z.unknown()),        // { title, slides: [...] }
	theme: z.record(z.unknown()).optional(),
	textDensity: z.enum(['minimal', 'concise', 'detailed', 'extensive']).optional().default('concise'),
	language: z.string().trim().max(50).optional().default('Bahasa Indonesia'),
	title: z.string().trim().max(255).optional(),
})

// ── Single slide generation ──
export const generateSlideSchema = z.object({
	prompt: z.string().trim().min(3).max(5000),
	layoutHint: z.string().trim().max(100).optional(),
	theme: z.record(z.unknown()).optional(),
})

// ── Agentic assistant ──
export const generateAgentSchema = z.object({
	message: z.string().trim().min(2).max(2000),
	deckId: z.string().uuid().optional(),
	deck: z.record(z.unknown()).optional(),   // current deck payload (if not saved yet)
}).refine(d => d.deckId || d.deck, { message: 'Either deckId or deck payload is required' })

export type GenerateOutlineBody = z.infer<typeof generateOutlineSchema>
export type GenerateDeckBody = z.infer<typeof generateDeckSchema>
export type GenerateSlideBody = z.infer<typeof generateSlideSchema>
export type GenerateAgentBody = z.infer<typeof generateAgentSchema>
