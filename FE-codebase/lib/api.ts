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

// ── Deck version history ──
// Throttled checkpoints (max ~1/10min), not one row per autosave — see
// api/src/db/schemas/deck-version.ts for why. Payload is omitted from the
// list response (same pattern as listDecks) and only fetched per-version if
// needed.

export type DeckVersionRow = {
	id: string
	deck_id: string
	title: string
	created_at: string
}

export async function listDeckVersions(token: string, deckId: string): Promise<DeckVersionRow[]> {
	const res = await fetch(`${API_BASE}/api/v1/decks/${deckId}/versions`, {
		headers: authHeaders(token),
	})
	return unwrap<DeckVersionRow[]>(res)
}

export async function restoreDeckVersion(
	token: string,
	deckId: string,
	versionId: string,
): Promise<DeckRow> {
	const res = await fetch(`${API_BASE}/api/v1/decks/${deckId}/versions/${versionId}/restore`, {
		method: 'POST',
		headers: authHeaders(token),
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
		/** Provider id from the chat panel's model switcher. Same param name
		 *  the homepage picker uses for deck jobs; unset = worker default. */
		model?: string
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
	body: { content: string; language?: string; style?: string; model?: string; manifest?: unknown },
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

/** Streams a markdown outline for a topic (/tools/aippt_outline). Same SSE
 *  envelope as streamAipptDeck, but the chunks are RAW markdown text (no
 *  JSONL) — append them as they arrive. `slideCount` is the outline-only
 *  page-count hint from the /outline page's "6-10 Pages" pill. */
export async function streamAipptOutline(
	token: string,
	body: { content: string; language?: string; model?: string; slideCount?: number },
): Promise<{ state: -1; message: string } | Response> {
	const res = await fetch(`${API_BASE}/api/v1/tools/aippt_outline`, {
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

/** Streams a reply from the /outline page's chat (/tools/outline_chat). Raw
 *  text chunks like the outline stream; when the model revises the slide, the
 *  full reply contains a ```slide fenced block the caller can parse+apply. */
export async function streamOutlineChat(
	token: string,
	body: {
		message: string
		language?: string
		model?: string
		history?: { role: 'user' | 'assistant'; content: string }[]
		context?: unknown
	},
): Promise<{ state: -1; message: string } | Response> {
	const res = await fetch(`${API_BASE}/api/v1/tools/outline_chat`, {
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

// ── Theme manifest (slot-by-slot generation contract) ─────────────────────

/** Asks the server (Kimi) which theme best fits a deck topic, matched against
 * each theme's authored when_to_use / avoid_when / keywords. Returns null on
 * any failure or "no defensible fit" — the caller falls back to the
 * deterministic DeckLayoutPicker seed instead of dying. */
export async function chooseThemeForTopic(
	topic: string,
	language?: string,
): Promise<{ themeId: string; reason: string | null } | null> {
	try {
		const res = await fetch(`/api/ai/choose-theme`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ topic, language }),
		})
		if (!res.ok) return null
		const json = await res.json()
		if (typeof json?.theme_id !== 'string' || !json.theme_id) return null
		return {
			themeId: json.theme_id,
			reason: typeof json.reason === 'string' ? json.reason : null,
		}
	} catch {
		return null
	}
}

/** Fetches one theme's layout manifest from the same-origin Next API — the
 *  payload the deck generator shows the model (slots + budgets per layout).
 *  Returns null on any failure so generation can fall back to the legacy
 *  contract instead of dying. */
export async function fetchThemeManifest(themeId: string): Promise<unknown | null> {
	try {
		const res = await fetch(`/api/template-engine/manifest?theme=${encodeURIComponent(themeId)}`)
		if (!res.ok) return null
		const json = await res.json()
		// The endpoint returns {themes:[...]} for the choice manifest — the deck
		// generator needs the full single-theme layout manifest instead.
		return json && Array.isArray(json.layouts) ? json : null
	} catch {
		return null
	}
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
