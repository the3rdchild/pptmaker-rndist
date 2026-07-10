import { z } from 'zod'

export const sessionBodySchema = z.object({
	token: z.string().trim().min(8, 'Token too short').max(255),
})

export type SessionBody = z.infer<typeof sessionBodySchema>
