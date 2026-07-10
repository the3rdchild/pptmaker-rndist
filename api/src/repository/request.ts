import { eq } from 'drizzle-orm'
import db from '@/db'
import { NewPoolRequest, PoolRequest, poolRequest } from '@/db/schemas'

export async function createPoolRequest(values: NewPoolRequest): Promise<PoolRequest> {
	const [row] = await db.insert(poolRequest).values(values).returning()
	return row
}

export async function getPoolRequestByJobId(jobId: string): Promise<PoolRequest | null> {
	const [row] = await db
		.select()
		.from(poolRequest)
		.where(eq(poolRequest.job_id, jobId))
		.limit(1)
	return row ?? null
}
