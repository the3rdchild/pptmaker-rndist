# ai-ppt-maker — Bug Audit Report

Date: 2026-07-10 · Audited by: Claude Code (full source scan + live testing against the running Docker stack)

Every finding below was verified by reading the actual code, and where possible by exercising the running API (`http://localhost:8081`). Findings are grouped by severity. Each one has: what's wrong, where, proof, and how to fix.

---

## 🔴 CRITICAL — broken user-facing functionality

### C1. Dashboard → Editor AI auto-generate can NEVER work (cross-origin sessionStorage)

**Where:** `FE-codebase/components/dashboard/prompt-input.tsx:41-42` (writer) ↔ `editor/src/App.vue:96` and `editor/src/views/Editor/AIPPTDialog.vue:163-164` (readers)

**What:** The dashboard writes the prompt with `sessionStorage.setItem('ppt_ai_prompt', ...)` on origin `http://localhost:3000`. The PPTist iframe runs on `http://127.0.0.1:8082` — a **different origin**. `sessionStorage` is isolated per origin, so PPTist reads its own (empty) storage. The "auto-open AI dialog and generate" flow — the main product flow from the dashboard — silently never triggers. The user lands in a blank editor and nothing happens.

The GLM summary marked this "coded but needs browser testing" — it will fail that test 100% of the time in dev.

**Fix (recommended — URL params):**
1. `prompt-input.tsx`: stop using sessionStorage. Keep only `router.push(\`/editor/\${deck.id}?prompt=\${encodeURIComponent(prompt)}&lang=\${encodeURIComponent(language)}\`)` or stash it in the Zustand store.
2. `editor-page.tsx`: append `&prompt=...&lang=...` to `editorUrl`.
3. `App.vue` / `AIPPTDialog.vue`: read `prompt` / `lang` from `new URLSearchParams(location.search)` instead of sessionStorage.

Alternative: parent `postMessage({type:'ai-prompt', prompt, lang})` to the iframe after load, but URL params are simpler and survive iframe reloads.

---

### C2. Worker failures never notify the client → PPTist spinner hangs up to 120 s

**Where:** `worker/workers/ppt_worker.py:43-49`

**What:** When any service throws (LLM error, bad JSON, DeepInfra outage, rate limit), the worker does `save_error()` + `update_status('failed')` in Postgres — but **never publishes** `{"type":"error"}` to the `ppt:stream:{jobId}` Redis channel. The streaming routes (`tools.route.ts`) only terminate on `done`/`error` pub/sub messages, so:
- PPTist flows (`/tools/aippt_outline`, `/tools/aippt`, `/tools/ai_writing`): the user stares at "AI is generating…" for the full 120 s timeout, then gets an empty result with no error message.
- Next.js Flow C is only saved by its polling fallback.

**Fix:** in the `except` block of `handle()`:
```python
from services.pubsub import publish
...
except Exception as e:
    logger.exception("[ppt_worker] error | job_id=%s", job_id)
    try:
        save_error(job_id, str(e))
    except Exception:
        logger.exception(...)
    update_status(job_id, "failed")
    publish(job_id, {"type": "error", "message": str(e)})   # ← add this
```
And in PPTist's dialog, surface an error toast when the stream ends with no content.

---

### C3. `/tools/*` endpoints crash with HTTP 500 when session token is missing

**Where:** `api/src/routes/v1/tools.route.ts:41, 120, 198` — `session_id: sessionId!`

**What:** The non-null assertion `sessionId!` passes `undefined` into a NOT NULL DB column when the `x-session-token` header is absent, producing an unhandled exception.

**Proof (live):**
```
$ curl -X POST localhost:8081/api/v1/tools/aippt_outline -d '{"content":"test"}' -H "Content-Type: application/json"
Internal Server Error   (HTTP 500)
```
Deck routes correctly return 401; tools routes crash.

**Fix:** at the top of each `/tools` handler (or a small middleware on the tools router):
```ts
const sessionId = c.var.sessionId
if (!sessionId) return c.json({ state: -1, message: 'Missing session' }, 401)
```

---

### C4. Flow C (Next.js outline screen) is broken end-to-end: contract mismatch

**Where:** `worker/services/outline_service.py:66-72` (producer) ↔ `FE-codebase/store/ai.store.ts:11-14` + `components/outline/outline-page.tsx:38,57` (consumers) ↔ `worker/services/deck_service.py:104-131` (downstream)

**What:** The worker's JSON-mode outline result is `{title, markdown}` — there is **no `slides` array**. The FE `Outline` type expects `{title, slides: [{title, bullets, layout}]}` and immediately calls `o.slides.map(...)` → TypeError, outline page stuck on error/loading forever. Downstream, `deck_service._process_json` also expects `outline.get("slides")`, so even if the page rendered, deck generation would produce an empty deck.

**Proof (live):**
```
$ POST /api/v1/generate/outline {"prompt":"Tips hemat listrik",...}  → jobId
$ GET  /api/v1/status/<jobId>
{"result":{"title":"Tips Hemat Listrik...","markdown":"# Tips Hemat..."}}   ← no "slides"
```

**Fix — pick one:**
- **Option A (recommended): delete Flow C.** Flow A (PPTist native dialog) is the good path and the dashboard already routes to it. Remove `/generate/[jobId]` + `/generate/deck/[jobId]` pages, `outline-page.tsx`, `customization-panel.tsx`, `deck-loading-page.tsx`, and `layouts.py` flat layouts. Less code, one flow, no confusion.
- **Option B: fix the contract.** In `outline_service.py` JSON mode, use `llm_client.chat_json()` with a schema prompt producing `{title, slides:[{title, bullets, layout}]}`, and make `_process_json` consume it. You still end up with the "sampah" flat layouts unless you also port PPTist's template mapping server-side — which is why Option A is better.

---

### C5. AI Writing commands silently degrade — Chinese/English key mismatch

**Where:** `editor/src/views/Editor/Toolbar/common/RichTextBase.vue:337-341` ↔ `worker/services/writing_service.py:12-17`

**What:** PPTist sends `command: '美化改写' | '扩写丰富' | '精简提炼'` (kept for the original server.pptist.cn backend). Your worker only knows `rewrite/expand/summarize/polish` and falls back to `rewrite` for anything unknown. Result: "Polish", "Expand", and "Simplify" in the toolbar all do the same generic rewrite. No error, just wrong behavior.

**Fix (worker side, one line each):**
```python
COMMAND_PROMPTS = {
    ...existing...
    "美化改写": COMMAND_PROMPTS-style polish prompt,
    "扩写丰富": expand prompt,
    "精简提炼": summarize prompt,
}
```
Or cleaner: change `AI_COMMAND_MAP` in `RichTextBase.vue` to `{polish:'polish', expand:'expand', simplify:'summarize'}` since the backend is now yours. Update the stale comment that says the values must stay Chinese.

---

## 🟠 HIGH — reliability & correctness under real conditions

### H1. Subscribe-after-enqueue race in every streaming route

**Where:** `api/src/routes/v1/tools.route.ts` (all 3 stream endpoints), `api/src/routes/v1/stream.route.ts`

**What:** The job is pushed to the queue **before** the Redis subscriber connects and subscribes. The worker BRPOPs instantly; if it publishes anything (fast failure, or first chunk on a warm LLM) before `subscriber.subscribe()` completes, those messages — including a terminal `done`/`error` — are lost forever. Redis pub/sub has no replay. Flow C has a polling fallback; the PPTist tools flows have none → hang until the 120 s timeout. This is the same class of bug as the already-fixed "Bug 3" in the GLM summary, one layer deeper.

**Fix:** restructure each handler to connect + `await subscriber.subscribe(channel)` **first**, then `createPoolRequest` + `enqueueJob`, then start the read loop. (Also dedupe: the three tools handlers are near-identical — extract one `streamJobToBody(c, jobId, mapChunk)` helper.)

### H2. 120 s hard cap truncates long deck generations

**Where:** `tools.route.ts:82,165` (`setTimeout(..., 120000)`)

**What:** The timeout is absolute, not idle-based. A 12–15 slide deck in DeepSeek-V3.1 streaming JSONL can exceed 2 minutes; when it does, the stream is cut mid-deck and the user gets a partial presentation with no error. (Measured live: a short outline alone streamed for ~30 s.)

**Fix:** make it an **idle timeout** — reset a 60 s timer on every received chunk, and/or raise the absolute cap to 10 min:
```ts
let idle = setTimeout(cleanup, 60000)
subscriber.on('message', ... => { clearTimeout(idle); idle = setTimeout(cleanup, 60000); ... })
```

### H3. Worker processes jobs strictly one-at-a-time

**Where:** `worker/core/queue/worker.py:24-51` (synchronous BRPOP loop), `worker/entry.py`

**What:** `handler(data)` runs inline in the loop and each job holds it for the entire LLM stream (30 s – 3 min). Two simultaneous users = the second waits for the first's whole deck. With the 120 s API timeout (H2), a queued job's stream can time out **before the worker even starts it**.

**Fix:** wrap the handler in a `concurrent.futures.ThreadPoolExecutor(max_workers=4)` and submit jobs to it (the work is I/O-bound, threads are fine), or run multiple worker replicas in docker-compose (`deploy.replicas` / duplicated service).

### H4. PPTist deck stream parsing can corrupt slides on chunk boundaries

**Where:** `editor/src/views/Editor/AIPPTDialog.vue:299-316` (`chunk.split(/\n+/)` per network chunk, each fragment passed through `jsonrepair`)

**What:** A JSONL line split across two network chunks gets "repaired" into a truncated-but-valid JSON → a corrupted slide is rendered, and the second half fails to parse → slide lost. The API publishes line-per-message, which usually aligns, but Bun/proxies can coalesce or split writes; long content slides are most at risk.

**Fix:** buffer partial lines like the worker does:
```ts
let buf = ''
// in read loop:
buf += chunk
const lines = buf.split('\n'); buf = lines.pop() || ''
for (const line of lines) if (line.trim()) processChunk(line)
// on done: if (buf.trim()) processChunk(buf)
```

### H5. Infinite spinner if a deck payload has an empty `slides` array

**Where:** `editor/src/App.vue:65-72` — `if (deck.payload.slides)` is true for `[]`, then `setSlides([])` leaves `slides.length === 0`, and the app template shows `FullscreenSpin` forever.

**Fix:** `if (deck?.payload?.slides?.length) {...} else { slidesStore.setSlides([{ id: nanoid(10), elements: [] }]) }`

### H6. `img_search` stub returns the wrong shape → image panel breaks

**Where:** `api/src/routes/v1/tools.route.ts:262-264` returns `{photos: []}`; `editor/src/views/Editor/ImageLibPanel.vue:131-133` expects `{data: [...], total: n}`.

**Fix:** return `c.json({ data: [], total: 0 })` until a real Pexels/Unsplash proxy is added.

---

## 🟡 SECURITY

### S1. Rotate the DeepInfra API key — it's been shared in plaintext

The DeepInfra key is (correctly) not in git, but it was pasted verbatim into external AI chat conversations. Treat it as compromised: rotate it at deepinfra.com and update `api/.env*`, `worker/.env*`.

### S2. `/status/:jobId` and `/stream/:jobId` have no auth at all

**Proof (live):** `GET /api/v1/status/<jobId>` with **no** `x-session-token` returned the full generation result. UUIDv4 jobIds make guessing hard, but any leaked jobId (logs, browser history, referrer) exposes generated content. **Fix:** require a session and check `pool_request.session_id === c.var.sessionId` in both routes.

### S3. postMessage endpoints trust everyone

- `editor/src/App.vue:121` posts the entire deck to `window.parent` with target `'*'` → a malicious page embedding the editor receives the user's deck content.
- `FE-codebase/components/editor/editor-page.tsx:27` accepts `deck-changed` from **any** origin → any window/iframe can overwrite the user's saved deck.

**Fix:** post to an explicit origin (pass the parent origin via URL param or hardcode per env), and check `e.origin` + `e.source` in the dashboard listener.

### S4. Unlimited anonymous sessions + unmetered paid LLM calls

`sessionMiddleware` mints a session row for **any** token string, and every `/tools/*` or `/generate/*` request triggers a paid DeepInfra call with no rate limiting. Anyone who finds the endpoint can drain your DeepInfra balance and bloat the DB. **Fix:** rate-limit per session/IP (even a simple Redis token bucket), validate the token format (48-hex from the FE generator), and cap concurrent pending jobs per session.

### S5. Session token in URL query string

`/editor/?deckId=…&token=…` leaks the token into browser history, vite/proxy access logs, and any referrer. Acceptable for local dev; for production prefer passing it via postMessage after iframe load, or a short-lived exchange token.

---

## 🔵 MEDIUM / cleanup

| # | Issue | Where | Fix |
|---|---|---|---|
| M1 | `api/.env` has `REDIS_PORT=6379`, but host Redis is on **6380** → running the API outside Docker fails at bootstrap | `api/.env` | Set `REDIS_PORT=6380` (docker uses `.env.docker`, unaffected) |
| M2 | Production build not wired: `next.config.ts` is empty, so the prod editor URL `/editor/` 404s; PPTist is dev-server-only | `FE-codebase/next.config.ts`, `editor/` | Build PPTist (`vite build`, base `/editor/`), serve `dist/` via Next.js `public/editor/` copy or a reverse proxy route; test `Dockerfile.fe` |
| M3 | Model dropdown in AIPPTDialog (`deepseek-v4-flash`) is cosmetic — API validates `model` but never forwards it to the worker | `tools.route.ts`, `AIPPTDialog.vue:157` | Either pass `model` through job params → `llm_client(model=…)` with an allowlist, or remove the selector |
| M4 | BullMQ used only as a glorified LPUSH: BRPOP bypass leaves `bull:PPT_QUEUE:id`, `:events`, marker keys growing forever; `removeOnComplete` never runs (no BullMQ worker) | `api/src/lib/queue.ts`, `worker/core/queue/worker.py` | Simplest: drop BullMQ, use plain Redis `LPUSH`/`BRPOP` with a JSON payload. Or periodically `XTRIM bull:PPT_QUEUE:events` |
| M5 | No retry for failed jobs; job hash deleted even on crash between BRPOP and completion → job lost if worker dies mid-processing | `worker.py:51` | Acceptable for MVP; if it matters, move to `BRPOPLPUSH` (reliable queue pattern) with a processing list |
| M6 | `listDecksBySession` returns full `payload` JSONB for every deck → dashboard list gets slow/heavy as decks accumulate (payloads can be MBs) | `api/src/repository/deck.ts:15-21` | Select only `id, title, thumbnail, is_favorite, created_at, updated_at` for the list endpoint |
| M7 | New psycopg2 connection per query in the worker | `worker/core/db/repository.py:_db` | Fine at current scale; use a connection pool (`psycopg2.pool` or one long-lived conn per thread) when adding H3 concurrency |
| M8 | `generation_result` table has no primary key (only a unique index on `job_id`) | `api/src/db/schemas/generation-result.ts` | Add `id uuid defaultRandom().primaryKey()` or make `job_id` the PK |
| M9 | `int(params.get("slideCount", …))` raises `TypeError` if a client sends `"slideCount": null` → job fails | `worker/services/outline_service.py:41` | `int(params.get("slideCount") or 0)` |
| M10 | Deck thumbnails are never generated (auto-save sends only title+payload) → dashboard cards have no previews | `editor/src/App.vue` auto-save, `editor-page.tsx` | PPTist has thumbnail export hooks (`useExport`); render slide 1 to a small image and include it in the `deck-changed` message |
| M11 | On stream timeout, outline route writes a stray `'\n'` and closes silently; PPTist shows a half-outline with no error | `tools.route.ts:83` | After C2/H2, write nothing on error — surface a toast client-side when the stream ends while `outlineCreating` |

---

## ✅ What I verified is working

- Docker stack healthy (`postgres`, `redis`, `api`, `worker` all up; `/health` OK)
- Anonymous session create/upsert works; deck CRUD auth + ownership checks are correct (404 on other sessions' decks, 401 without token)
- **Flow A end-to-end works**: `/tools/aippt_outline` streamed a correct Indonesian markdown outline in ~30 s (verified live); `/tools/aippt` JSONL plumbing is sound (same pipeline)
- Worker BRPOP-bypass consumption of BullMQ jobs works in practice
- Secrets are properly gitignored (`.env*` not in git history — checked with `git log -S`)
- SSE + polling fallback in Flow C's deck-loading page is a solid pattern (it's the outline **contract**, C4, that's broken, not the transport)

## Suggested fix order

1. **C1** (auto-generate via URL params) — the product's core flow is dead without it
2. **C2 + H1 + H2** (error publish, subscribe-before-enqueue, idle timeout) — these three together make generation failures visible and streams reliable; touch the same files, do as one change
3. **C3, C5, H6** — small guards/mappings, quick wins
4. **C4** — decide: delete Flow C (recommended) or fix its contract
5. **S1 rotate key now**; S2–S4 before any public deployment
6. H3–H5, then the M-list opportunistically
