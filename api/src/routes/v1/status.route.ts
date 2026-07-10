import { createRouter } from '@/config/create-app'
import { getPoolRequestByJobId } from '@/repository/request'
import { getGenerationResultByJobId } from '@/repository/generation-result'
import { AppError } from '@/utils/error'

const status = createRouter().basePath('/status')

status.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId')
	const sessionId = c.var.sessionId

	const row = await getPoolRequestByJobId(jobId)
	if (!row) throw AppError.notFound(`jobId ${jobId} not found`)

	// Auth: the session requesting status must own the job
	if (sessionId && row.session_id !== sessionId) {
		throw AppError.notFound(`jobId ${jobId} not found`)
	}

	const params = row.params as { type?: string } | null

	if (row.status !== 'completed') {
		return c.json({
			message: 'sukses',
			data: {
				jobId: row.job_id,
				status: row.status,
				type: params?.type ?? null,
				...(row.error ? { error: row.error } : {}),
			},
		})
	}

	const result = await getGenerationResultByJobId(jobId)
	if (!result) throw AppError.notFound('Result not found for completed job')

	return c.json({
		message: 'sukses',
		data: {
			jobId: row.job_id,
			status: row.status,
			type: result.type,
			result: result.result,
		},
	})
})

export default status
