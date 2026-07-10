import { createRouter } from '@/config/create-app'
import { streamSSE } from 'hono/streaming'
import { Redis } from 'ioredis'
import { env } from '@/config/env'
import { getPoolRequestByJobId } from '@/repository/request'
import { getGenerationResultByJobId } from '@/repository/generation-result'
import { AppError } from '@/utils/error'

const stream = createRouter().basePath('/stream')

stream.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId')
	const sessionId = c.var.sessionId

	const row = await getPoolRequestByJobId(jobId)
	if (!row) throw AppError.notFound(`jobId ${jobId} not found`)

	// Auth: the session requesting the stream must own the job
	if (sessionId && row.session_id !== sessionId) {
		throw AppError.notFound(`jobId ${jobId} not found`)
	}

	return streamSSE(c, async (sseStream) => {
		// Race condition: job already finished before SSE connect
		if (row.status === 'completed') {
			const result = await getGenerationResultByJobId(jobId).catch(() => null)
			if (result) {
				await sseStream.writeSSE({
					data: JSON.stringify({ type: 'done', result: result.result, resultType: result.type }),
				})
				return
			}
		}
		if (row.status === 'failed') {
			await sseStream.writeSSE({
				data: JSON.stringify({ type: 'error', message: row.error ?? 'Job failed' }),
			})
			return
		}

		// Subscribe to the job's Redis channel BEFORE reading is safe here
		// (the job was already enqueued earlier, so we may have a fast-completion
		// race — but the `completed`/`failed` checks above catch the common case)
		const subscriber = new Redis({
			host: env.REDIS_HOST,
			port: Number(env.REDIS_PORT),
			password: env.REDIS_PASSWORD || undefined,
			maxRetriesPerRequest: null,
			lazyConnect: true,
		})

		await subscriber.connect()
		const channel = `ppt:stream:${jobId}`
		await subscriber.subscribe(channel)

		await new Promise<void>((resolve) => {
			const cleanup = () => {
				try { subscriber.disconnect() } catch {}
				resolve()
			}

			let idle = setInterval(() => {
				sseStream.writeSSE({ event: 'ping', data: 'ok' }).catch(() => cleanup())
			}, 8000)

			const idleTimeout = setTimeout(() => {
				clearInterval(idle)
				try { sseStream.writeSSE({ data: JSON.stringify({ type: 'timeout' }) }) } catch {}
				cleanup()
			}, 180000)

			const resetIdle = () => {
				clearTimeout(idleTimeout)
				// idle timeout resets on every message (protects long generations)
			}

			sseStream.onAbort(() => {
				clearInterval(idle)
				clearTimeout(idleTimeout)
				cleanup()
			})

			subscriber.on('message', async (_ch, message) => {
				resetIdle()
				try {
					await sseStream.writeSSE({ data: message })
					const data = JSON.parse(message)
					if (data.type === 'done' || data.type === 'error') {
						clearInterval(idle)
						clearTimeout(idleTimeout)
						cleanup()
					}
				} catch {
					clearInterval(idle)
					clearTimeout(idleTimeout)
					cleanup()
				}
			})
		})
	})
})

export default stream
