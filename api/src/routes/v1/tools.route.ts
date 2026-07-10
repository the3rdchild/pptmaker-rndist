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
	language: z.string().optional().default('English'),
	model: z.string().optional(),
})
const aipptSchema = z.object({
	content: z.string(),
	language: z.string().optional().default('English'),
	style: z.string().optional(),
	model: z.string().optional(),
})
const writingSchema = z.object({
	content: z.string(),
	command: z.string().optional().default('polish'),
})

/**
 * Subscribe to the job's Redis pub/sub channel FIRST, then enqueue the job.
 * Returns the subscriber + a cleanup function. This avoids the race where
 * the worker publishes (or fails) before we subscribe.
 *
 * `onChunk` receives every `{"type":"chunk","text":...}` payload's text.
 * On `done`/`error`/timeout the stream resolves.
 *
 * `idleMs` resets on every chunk — protects long generations from a hard cap.
 */
async function streamJobToBody(
	s: { write: (data: string) => Promise<void> },
	jobId: string,
	onChunk: (text: string) => void,
	idleMs = 60000,
	absoluteMs = 600000,
): Promise<void> {
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

	const startedAt = Date.now()

	await new Promise<void>((resolve) => {
		const cleanup = () => {
			try { subscriber.disconnect() } catch {}
			resolve()
		}

		let idle = setTimeout(cleanup, idleMs)
		const resetIdle = () => {
			clearTimeout(idle)
			idle = setTimeout(cleanup, idleMs)
		}
		const absolute = setTimeout(cleanup, absoluteMs)

		subscriber.on('message', (_ch, message) => {
			resetIdle()
			try {
				const data = JSON.parse(message)
				if (data.type === 'chunk' && typeof data.text === 'string') {
					onChunk(data.text)
				} else if (data.type === 'done' || data.type === 'error') {
					clearTimeout(idle)
					clearTimeout(absolute)
					cleanup()
				}
			} catch {
				clearTimeout(idle)
				clearTimeout(absolute)
				cleanup()
			}
		})
	})
}

function requireSession(c: { var: { sessionId?: string } }): string | null {
	return c.var.sessionId ?? null
}

// ── POST /tools/aippt_outline — markdown stream ──

tools.post('/aippt_outline', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = outlineSchema.safeParse(body)
	if (!parsed.success) return c.json({ state: -1, message: 'Invalid body' }, 400)

	const sessionId = requireSession(c)
	if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)

	const jobId = crypto.randomUUID()

	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
		// Subscribe BEFORE enqueue (avoids losing early publishes)
		const job = streamJobToBody(s, jobId, (text) => {
			s.write(text).catch(() => {})
		})

		// Now safe to enqueue — subscriber is already listening
		const request = await createPoolRequest({
			job_id: jobId,
			session_id: sessionId,
			status: 'pending',
			params: { type: 'outline', prompt: parsed.data.content, language: parsed.data.language, stream_mode: 'raw' },
		})
		await QueueClient.enqueueJob(jobId, {
			request_id: request.id,
			session_id: sessionId,
			type: 'outline',
			prompt: parsed.data.content,
			language: parsed.data.language,
			stream_mode: 'raw',
		})

		await job
	})
})

// ── POST /tools/aippt — JSONL AIPPTSlide stream ──

tools.post('/aippt', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = aipptSchema.safeParse(body)
	if (!parsed.success) return c.json({ state: -1, message: 'Invalid body' }, 400)

	const sessionId = requireSession(c)
	if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)

	const jobId = crypto.randomUUID()

	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
		const job = streamJobToBody(s, jobId, (text) => {
			// JSONL: write each slide object on its own line
			s.write(text + '\n').catch(() => {})
		})

		const request = await createPoolRequest({
			job_id: jobId,
			session_id: sessionId,
			status: 'pending',
			params: { type: 'deck', outline: parsed.data.content, language: parsed.data.language, stream_mode: 'raw' },
		})
		await QueueClient.enqueueJob(jobId, {
			request_id: request.id,
			session_id: sessionId,
			type: 'deck',
			outline: parsed.data.content,
			language: parsed.data.language,
			stream_mode: 'raw',
		})

		await job
	})
})

// ── POST /tools/ai_writing — raw text stream ──

tools.post('/ai_writing', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = writingSchema.safeParse(body)
	if (!parsed.success) return c.json({ state: -1, message: 'Invalid body' }, 400)

	const sessionId = requireSession(c)
	if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)

	const jobId = crypto.randomUUID()

	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
		const job = streamJobToBody(s, jobId, (text) => {
			s.write(text).catch(() => {})
		}, 30000) // writing is shorter

		const request = await createPoolRequest({
			job_id: jobId,
			session_id: sessionId,
			status: 'pending',
			params: { type: 'writing', content: parsed.data.content, command: parsed.data.command, stream_mode: 'raw' },
		})
		await QueueClient.enqueueJob(jobId, {
			request_id: request.id,
			session_id: sessionId,
			type: 'writing',
			content: parsed.data.content,
			command: parsed.data.command,
			stream_mode: 'raw',
		})

		await job
	})
})

// ── POST /tools/img_search — returns PPTist-expected shape ──

tools.post('/img_search', (c) => {
	// PPTist expects { data: [...], total: number }
	// Stub until a real image search provider is wired (V2)
	return c.json({ data: [], total: 0 })
})

export default tools
