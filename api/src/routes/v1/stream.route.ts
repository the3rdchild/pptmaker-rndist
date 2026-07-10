import { createRouter } from '@/config/create-app'
import { streamSSE } from 'hono/streaming'
import { Redis } from 'ioredis'
import { env } from '@/config/env'
import { getPoolRequestByJobId } from '@/repository/request'
import { getGenerationResultByJobId } from '@/repository/generation-result'

const stream = createRouter().basePath('/stream')

stream.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId')

	return streamSSE(c, async (sseStream) => {
		// Race condition: job sudah selesai sebelum SSE connect
		const row = await getPoolRequestByJobId(jobId).catch(() => null)
		if (row?.status === 'completed') {
			const result = await getGenerationResultByJobId(jobId).catch(() => null)
			if (result) {
				await sseStream.writeSSE({
					data: JSON.stringify({ type: 'done', result: result.result, resultType: result.type }),
				})
				return
			}
		}
		if (row?.status === 'failed') {
			await sseStream.writeSSE({
				data: JSON.stringify({ type: 'error', message: row.error ?? 'Job failed' }),
			})
			return
		}

		// Buat subscriber Redis terpisah
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

			const heartbeat = setInterval(() => {
				sseStream.writeSSE({ event: 'ping', data: 'ok' }).catch(() => cleanup())
			}, 8000)

			const timeout = setTimeout(async () => {
				clearInterval(heartbeat)
				try { await sseStream.writeSSE({ data: JSON.stringify({ type: 'timeout' }) }) } catch {}
				cleanup()
			}, 180000)

			sseStream.onAbort(() => {
				clearInterval(heartbeat)
				clearTimeout(timeout)
				cleanup()
			})

			subscriber.on('message', async (_ch, message) => {
				try {
					await sseStream.writeSSE({ data: message })
					const data = JSON.parse(message)
					if (data.type === 'done' || data.type === 'error') {
						clearInterval(heartbeat)
						clearTimeout(timeout)
						cleanup()
					}
				} catch {
					clearInterval(heartbeat)
					clearTimeout(timeout)
					cleanup()
				}
			})
		})
	})
})

export default stream
