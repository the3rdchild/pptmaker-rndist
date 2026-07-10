import { z } from 'zod'

// Deck payload = full presentation JSON. We validate loosely here (any object)
// since the strong typing lives on the FE (lib/types/slides.ts).
export const deckPayloadSchema = z.record(z.unknown())

export const createDeckSchema = z.object({
	title: z.string().trim().max(255).optional(),
	payload: deckPayloadSchema.optional(),
})

export const updateDeckSchema = z.object({
	title: z.string().trim().max(255).optional(),
	payload: deckPayloadSchema.optional(),
	thumbnail: z.string().nullable().optional(),
	is_favorite: z.boolean().optional(),
})

export const patchDeckSchema = z.object({
	title: z.string().trim().max(255).optional(),
	is_favorite: z.boolean().optional(),
	thumbnail: z.string().nullable().optional(),
})

export type CreateDeckBody = z.infer<typeof createDeckSchema>
export type UpdateDeckBody = z.infer<typeof updateDeckSchema>
export type PatchDeckBody = z.infer<typeof patchDeckSchema>
