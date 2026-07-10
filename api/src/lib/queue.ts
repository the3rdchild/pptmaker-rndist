import { Queue } from 'bullmq'
import { env } from '@/config/env'
import RedisClient from '@/lib/redis'

class QueueClient {
	private static instance: Queue | null = null

	static getInstance(): Queue {
		if (!QueueClient.instance) {
			QueueClient.instance = new Queue(
				env.PPT_QUEUE_NAME ?? 'PPT_QUEUE',
				{ connection: RedisClient.getInstance() },
			)
		}
		return QueueClient.instance
	}

	static async enqueueJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
		await QueueClient.getInstance().add(
			env.PPT_JOB_NAME ?? 'PROCESS_PPT',
			{ jobId, payload },
			{
				jobId,
				removeOnComplete: true,
				removeOnFail: true,
			},
		)
	}

	static async close(): Promise<void> {
		if (QueueClient.instance) {
			await QueueClient.instance.close()
			QueueClient.instance = null
		}
	}
}

export default QueueClient
