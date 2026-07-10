import { createRouter } from '@/config/create-app'
import { stream } from 'hono/streaming'
import { Redis } from 'ioredis'
import { env } from '@/config/env'
import { createPoolRequest } from '@/repository/request'
import QueueClient from '@/lib/queue'
import { z } from 'zod'

const tools = createRouter().basePath('/tools')

const outlineSchema = z.object({
	content: z.string(),
	language: z.string().optional().default('Bahasa Indonesia'),
	model: z.string().optional(),
})
const aipptSchema = z.object({
	content: z.string(),
	language: z.string().optional().default('Bahasa Indonesia'),
	style: z.string().optional(),
	model: z.string().optional(),
})

/**
 * POST /tools/aippt_outline
 * PPTist expects a raw text/markdown stream (NOT SSE events).
 * Flow: submit outline job → worker streams markdown chunks via Redis pub/sub
 *       → this route proxies them as raw text body.
 */
tools.post('/aippt_outline', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = outlineSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ state: -1, message: 'Invalid body' }, 400)
	}

	const sessionId = c.var.sessionId
	const jobId = crypto.randomUUID()

	const request = await createPoolRequest({
		job_id: jobId,
		session_id: sessionId!,
		status: 'pending',
		params: {
			type: 'outline',
			prompt: parsed.data.content,
			language: parsed.data.language,
			stream_mode: 'raw',
		},
	})

	await QueueClient.enqueueJob(jobId, {
		request_id: request.id,
		session_id: sessionId,
		type: 'outline',
		prompt: parsed.data.content,
		language: parsed.data.language,
		stream_mode: 'raw',
	})

	// Stream raw text from Redis pub/sub back to PPTist
	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
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
			const timeout = setTimeout(() => {
				s.write('\n').catch(() => {})
				cleanup()
			}, 120000)

			subscriber.on('message', (_ch, message) => {
				try {
					const data = JSON.parse(message)
					if (data.type === 'chunk') {
						// Raw text chunk — write directly to body
						s.write(data.text).catch(() => {})
					} else if (data.type === 'done') {
						clearTimeout(timeout)
						cleanup()
					} else if (data.type === 'error') {
						clearTimeout(timeout)
						cleanup()
					}
				} catch {
					clearTimeout(timeout)
					cleanup()
				}
			})
		})
	})
})

/**
 * POST /tools/aippt
 * PPTist expects a JSONL stream (one AIPPTSlide per line).
 */
tools.post('/aippt', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = aipptSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ state: -1, message: 'Invalid body' }, 400)
	}

	const sessionId = c.var.sessionId
	const jobId = crypto.randomUUID()

	const request = await createPoolRequest({
		job_id: jobId,
		session_id: sessionId!,
		status: 'pending',
		params: {
			type: 'deck',
			outline: parsed.data.content,
			language: parsed.data.language,
			stream_mode: 'raw',
		},
	})

	await QueueClient.enqueueJob(jobId, {
		request_id: request.id,
		session_id: sessionId,
		type: 'deck',
		outline: parsed.data.content,
		language: parsed.data.language,
		stream_mode: 'raw',
	})

	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
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
			const timeout = setTimeout(() => {
				cleanup()
			}, 120000)

			subscriber.on('message', (_ch, message) => {
				try {
					const data = JSON.parse(message)
					if (data.type === 'chunk') {
						// JSONL: one slide object per line
						s.write(data.text + '\n').catch(() => {})
					} else if (data.type === 'done' || data.type === 'error') {
						clearTimeout(timeout)
						cleanup()
					}
				} catch {
					clearTimeout(timeout)
					cleanup()
				}
			})
		})
	})
})

export default tools
