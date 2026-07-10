import { eq } from 'drizzle-orm'
import db from '@/db'
import { GenerationResult, generationResult, NewGenerationResult } from '@/db/schemas'

export async function createGenerationResult(values: NewGenerationResult): Promise<GenerationResult> {
	const [row] = await db.insert(generationResult).values(values).returning()
	return row
}

export async function getGenerationResultByJobId(jobId: string): Promise<GenerationResult | null> {
	const [row] = await db
		.select()
		.from(generationResult)
		.where(eq(generationResult.job_id, jobId))
		.limit(1)
	return row ?? null
}
