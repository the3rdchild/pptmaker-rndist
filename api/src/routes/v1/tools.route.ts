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
const imageSchema = z.object({
	prompt: z.string(),
	size: z.string().optional(),
})
const agentSchema = z.object({
	message: z.string(),
	history: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string(),
			}),
		)
		.optional(),
	deckSummary: z.object({
		activeSlideIndex: z.number().optional(),
		slideCount: z.number(),
		slides: z.array(z.object({
			index: z.number(),
			isActive: z.boolean().optional(),
			title: z.string().optional(),
			elementCount: z.number(),
			elements: z.array(z.string()).optional(),
		})),
	}).optional(),
})

/**
 * Create + connect + subscribe to the job's Redis pub/sub channel.
 * MUST be awaited before enqueueing the job, so no publishes are missed.
 * Returns the subscriber (caller must disconnect it).
 */
async function subscribeToJob(jobId: string): Promise<Redis> {
	const subscriber = new Redis({
		host: env.REDIS_HOST,
		port: Number(env.REDIS_PORT),
		password: env.REDIS_PASSWORD || undefined,
		maxRetriesPerRequest: null,
		lazyConnect: true,
	})
	await subscriber.connect()
	await subscriber.subscribe(`ppt:stream:${jobId}`)
	return subscriber
}

/**
 * Read loop: listen on the subscriber for chunk/done/error events.
 * - onChunk is called for every {type:'chunk', text} message.
 * - Idle timeout resets on every message (60s default) — protects long generations.
 * - Absolute cap (10 min) prevents infinite hangs.
 */
async function readJobStream(
	subscriber: Redis,
	onChunk: (text: string) => void,
	idleMs = 60000,
	absoluteMs = 600000,
): Promise<void> {
	await new Promise<void>((resolve) => {
		const cleanup = () => resolve()

		let idle = setTimeout(cleanup, idleMs)
		const absolute = setTimeout(cleanup, absoluteMs)

		const resetIdle = () => {
			clearTimeout(idle)
			idle = setTimeout(cleanup, idleMs)
		}

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
	}).finally(() => {
		// Always disconnect — no connection leak even if createPoolRequest throws
		try { subscriber.disconnect() } catch {}
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
		// 1. Subscribe FIRST (await it — truly listening before enqueue)
		const subscriber = await subscribeToJob(jobId)

		// 2. Enqueue the job
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

		// 3. Read loop (disconnects in finally)
		await readJobStream(subscriber, (text) => {
			s.write(text).catch(() => {})
		})
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
		const subscriber = await subscribeToJob(jobId)

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

		await readJobStream(subscriber, (text) => {
			// JSONL: write each slide object on its own line
			s.write(text + '\n').catch(() => {})
		})
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
		const subscriber = await subscribeToJob(jobId)

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

		await readJobStream(subscriber, (text) => {
			s.write(text).catch(() => {})
		}, 30000) // shorter idle for writing
	})
})

// ── POST /tools/agent — structured action stream (JSONL) ──
//
// The LLM only decides + describes actions (e.g. {"tool":"set_font","args":{...}}).
// It never authors slide layout/content directly — the client applies each
// action via existing store functions (applyFontToAllSlides, AIPPT(), etc.),
// exactly mirroring how /aippt's streamed slides are applied today. This keeps
// generation quality/consistency owned by the proven client-side pipeline,
// not by raw LLM output.

tools.post('/agent', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = agentSchema.safeParse(body)
	if (!parsed.success) return c.json({ state: -1, message: 'Invalid body' }, 400)

	const sessionId = requireSession(c)
	if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)

	const jobId = crypto.randomUUID()

	c.header('Content-Type', 'text/event-stream')
	c.header('Cache-Control', 'no-cache')
	c.header('Connection', 'keep-alive')

	return stream(c, async (s) => {
		const subscriber = await subscribeToJob(jobId)

		const request = await createPoolRequest({
			job_id: jobId,
			session_id: sessionId,
			status: 'pending',
			params: {
				type: 'agent',
				message: parsed.data.message,
				history: parsed.data.history,
				deckSummary: parsed.data.deckSummary,
				stream_mode: 'raw',
			},
		})
		await QueueClient.enqueueJob(jobId, {
			request_id: request.id,
			session_id: sessionId,
			type: 'agent',
			message: parsed.data.message,
			history: parsed.data.history,
			deckSummary: parsed.data.deckSummary,
			stream_mode: 'raw',
		})

		await readJobStream(subscriber, (text) => {
			// JSONL: one action (or {tool:'_reply', args:{text}}) per line
			s.write(text + '\n').catch(() => {})
		}, 30000) // single-turn tool-call-or-reply, no need for the long idle window
	})
})

// ── POST /tools/image — enqueues an image-gen job, returns jobId to poll ──
//
// Not SSE like the other tools: image generation is one shot (no partial
// chunks worth streaming), so this reuses the existing poll infrastructure
// (GET /status/:jobId + worker's save_result) instead of the chunk-forwarding
// stream() plumbing above.

tools.post('/image', async (c) => {
	const body = await c.req.json().catch(() => ({}))
	const parsed = imageSchema.safeParse(body)
	if (!parsed.success) return c.json({ state: -1, message: 'Invalid body' }, 400)

	const sessionId = requireSession(c)
	if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)

	const jobId = crypto.randomUUID()

	const request = await createPoolRequest({
		job_id: jobId,
		session_id: sessionId,
		status: 'pending',
		params: { type: 'image', prompt: parsed.data.prompt, size: parsed.data.size },
	})
	await QueueClient.enqueueJob(jobId, {
		request_id: request.id,
		session_id: sessionId,
		type: 'image',
		prompt: parsed.data.prompt,
		size: parsed.data.size,
	})

	return c.json({ message: 'sukses', data: { jobId } })
})

// ── POST /tools/img_search — returns PPTist-expected shape ──

tools.post('/img_search', (c) => {
	// PPTist expects { data: [...], total: number }
	return c.json({ data: [], total: 0 })
})

export default tools
