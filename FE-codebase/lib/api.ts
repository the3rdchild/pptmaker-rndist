import type { Presentation } from './types/presentation'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8081'

// ── Envelope helpers ──

type Envelope<T> = { message: string; data?: T; errors?: string[] }

async function unwrap<T>(res: Response): Promise<T> {
	const body = (await res.json().catch(() => ({}))) as Envelope<T>
	if (!res.ok) {
		const msg = body?.errors?.join(', ') || body?.message || `Request failed (${res.status})`
		throw new Error(msg)
	}
	if (body.data === undefined) throw new Error('Response without data')
	return body.data
}

// ── Session ──

export type SessionInfo = { id: string; token: string }

export async function ensureSession(token: string): Promise<SessionInfo> {
	const res = await fetch(`${API_BASE}/api/v1/session`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token }),
	})
	return unwrap<SessionInfo>(res)
}

// ── Deck CRUD ──

export type DeckRow = {
	id: string
	title: string
	payload: Presentation | null
	thumbnail: string | null
	is_favorite: boolean
	created_at: string
	updated_at: string
}

function authHeaders(token: string): Record<string, string> {
	return { 'x-session-token': token }
}

export async function listDecks(token: string): Promise<DeckRow[]> {
	const res = await fetch(`${API_BASE}/api/v1/decks`, {
		headers: authHeaders(token),
	})
	return unwrap<DeckRow[]>(res)
}

export async function getDeck(token: string, id: string): Promise<DeckRow> {
	const res = await fetch(`${API_BASE}/api/v1/decks/${id}`, {
		headers: authHeaders(token),
	})
	return unwrap<DeckRow>(res)
}

export async function createDeck(
	token: string,
	body: { title?: string; payload?: Presentation },
): Promise<DeckRow> {
	const res = await fetch(`${API_BASE}/api/v1/decks`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	return unwrap<DeckRow>(res)
}

export async function saveDeck(
	token: string,
	id: string,
	body: { title?: string; payload?: Presentation; thumbnail?: string | null },
): Promise<DeckRow> {
	const res = await fetch(`${API_BASE}/api/v1/decks/${id}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	return unwrap<DeckRow>(res)
}

export async function deleteDeck(token: string, id: string): Promise<void> {
	await fetch(`${API_BASE}/api/v1/decks/${id}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
}

export async function patchDeck(
	token: string,
	id: string,
	body: { title?: string; is_favorite?: boolean; thumbnail?: string | null },
): Promise<DeckRow> {
	const res = await fetch(`${API_BASE}/api/v1/decks/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	return unwrap<DeckRow>(res)
}

// ── Agent chat (structured action stream) ──
//
// Mirrors editor/src/services/index.ts's api.Agent() — same backend endpoint
// (/api/v1/tools/agent), same JSONL-over-fetch-stream contract. NOT the old
// job-queue+SSE pattern below (that targeted /api/v1/generate/*, which no
// longer exists — the whole Flow C job-queue module was removed).

export type AgentAction = { tool: string; args: Record<string, unknown> }

export async function streamAgent(
	token: string,
	body: {
		message: string
		deckSummary?: unknown
		history?: { role: 'user' | 'assistant'; content: string }[]
	},
): Promise<{ state: -1; message: string } | Response> {
	const res = await fetch(`${API_BASE}/api/v1/tools/agent`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	const contentType = res.headers.get('content-type') || ''
	if (!contentType.includes('text/event-stream')) {
		return res.json().catch(() => ({ state: -1, message: 'Request failed' }))
	}
	return res
}

export async function streamAipptDeck(
	token: string,
	body: { content: string; language?: string; style?: string },
): Promise<{ state: -1; message: string } | Response> {
	const res = await fetch(`${API_BASE}/api/v1/tools/aippt`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	const contentType = res.headers.get('content-type') || ''
	if (!contentType.includes('text/event-stream')) {
		return res.json().catch(() => ({ state: -1, message: 'Request failed' }))
	}
	return res
}

// ── Image generation (poll-based — see /tools/image + /status/:jobId) ──

export async function requestImage(
	token: string,
	body: { prompt: string; size?: string },
): Promise<{ jobId: string }> {
	const res = await fetch(`${API_BASE}/api/v1/tools/image`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
		body: JSON.stringify(body),
	})
	const json = await unwrap<{ jobId: string }>(res)
	return json
}

/** Enqueues an image job and polls until it completes/fails/times out. Returns
 * a data: URL, or null if generation failed (never throws — callers should
 * treat a null as "keep the template's placeholder image"). */
export async function generateImage(
	token: string,
	prompt: string,
	opts: { size?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
	const { size, timeoutMs = 45000, intervalMs = 1200 } = opts
	try {
		const { jobId } = await requestImage(token, { prompt, size })
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			const status = await pollStatus(token, jobId)
			if (status.status === 'completed') {
				const result = status.result as { data_url?: string } | undefined
				return result?.data_url ?? null
			}
			if (status.status === 'failed') return null
			await new Promise((resolve) => setTimeout(resolve, intervalMs))
		}
		return null
	} catch {
		return null
	}
}

// ── Status polling ──

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type StatusResult = {
	jobId: string
	status: JobStatus
	type: string | null
	error?: string
	result?: unknown
}

export async function pollStatus(token: string, jobId: string): Promise<StatusResult> {
	const res = await fetch(`${API_BASE}/api/v1/status/${jobId}`, {
		headers: authHeaders(token),
	})
	return unwrap<StatusResult>(res)
}

// ── SSE stream ──

export type StreamEvent =
	| { type: 'done'; result: unknown; resultType: string }
	| { type: 'error'; message: string }
	| { type: 'timeout' }
	| { type: 'ping' }

export function openStream(
	jobId: string,
	onEvent: (event: StreamEvent) => void,
	timeoutMs = 120000,
): () => void {
	const es = new EventSource(`${API_BASE}/api/v1/stream/${jobId}`)
	let settled = false

	const timer = setTimeout(() => {
		if (settled) return
		settled = true
		es.close()
		onEvent({ type: 'timeout' })
	}, timeoutMs)

	es.onmessage = (e) => {
		try {
			const data = JSON.parse(e.data) as StreamEvent
			onEvent(data)
			if (data.type === 'done' || data.type === 'error' || data.type === 'timeout') {
				settled = true
				clearTimeout(timer)
				es.close()
			}
		} catch {}
	}

	es.onerror = () => {
		if (settled) return
		settled = true
		clearTimeout(timer)
		es.close()
		onEvent({ type: 'error', message: 'Connection lost' })
	}

	return () => {
		settled = true
		clearTimeout(timer)
		es.close()
	}
}
