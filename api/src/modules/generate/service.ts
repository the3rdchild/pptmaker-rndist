import { createPoolRequest } from '@/repository/request'
import QueueClient from '@/lib/queue'
import { env } from '@/config/env'
import type {
	GenerateAgentBody,
	GenerateDeckBody,
	GenerateOutlineBody,
	GenerateSlideBody,
} from './dto'

export class GenerateService {
	/** Submit outline generation → worker. Returns jobId + statusURL. */
	async outline(sessionId: string, body: GenerateOutlineBody) {
		return this.enqueue(sessionId, 'outline', body, { body })
	}

	/** Submit full deck generation from approved outline. */
	async deck(sessionId: string, body: GenerateDeckBody) {
		return this.enqueue(sessionId, 'deck', body, { body })
	}

	/** Submit single slide generation (from editor AI modal). */
	async slide(sessionId: string, body: GenerateSlideBody) {
		return this.enqueue(sessionId, 'slide', body, { body })
	}

	/** Submit agentic assistant job (edit deck via natural language). */
	async agent(sessionId: string, body: GenerateAgentBody) {
		return this.enqueue(sessionId, 'agent', body, { body })
	}

	private async enqueue(
		sessionId: string,
		type: string,
		rawBody: Record<string, unknown>,
		_options: { body: Record<string, unknown> },
	) {
		const jobId = crypto.randomUUID()

		const deckId = (rawBody as { deckId?: string }).deckId ?? null

		const request = await createPoolRequest({
			job_id: jobId,
			session_id: sessionId,
			deck_id: deckId ?? undefined,
			status: 'pending',
			params: {
				type,
				...rawBody,
			},
		})

		await QueueClient.enqueueJob(jobId, {
			request_id: request.id,
			session_id: sessionId,
			deck_id: deckId,
			type,
			...rawBody,
		})

		return {
			jobId,
			statusURL: `${env.SERVICE_URL}/api/v1/status/${jobId}`,
			streamURL: `${env.SERVICE_URL}/api/v1/stream/${jobId}`,
		}
	}
}
