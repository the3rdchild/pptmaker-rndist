# PPT Maker

AI-powered presentation maker. Hybrid architecture: Next.js dashboard (session + deck registry) embeds the PPTist Vue editor via iframe, backed by a Hono/Bun API and a Python worker (DeepInfra LLM).

## Architecture

```
Next.js (3000)              PPTist Vue (8082)                API (8081)          Worker (Python)
─────────────────           ───────────────────              ─────────           ───────────────
Dashboard                   Editor (240 templates,            Hono + Bun          DeepInfra LLM
  ├─ prompt input             149 shapes, full                 ├─ session          ├─ outline (markdown)
  ├─ recent decks             drag/resize/rotate,              ├─ deck CRUD        ├─ deck (JSONL slides)
  └─ session mgmt             rich text editing)                ├─ /tools/*         ├─ agent (tool-calling)
                                                                 │  ├─ aippt_outline └─ ai_writing
Editor route                 AI Assistant panel                 │  ├─ aippt
  └─ <iframe PPTist>            (chat: generate new deck          │  ├─ ai_writing
     ↕ postMessage               or edit the existing one)        │  └─ agent
       auto-save              iframe ←→ postMessage               └─ status/stream (poll/SSE)
                               auto-save ↔ backend
```

Everything you see in the editor — templates, drag/resize, rich text, AI generation — lives in `editor/` (a modified PPTist fork). The Next.js app is a thin shell: anonymous session, deck list, and the iframe wrapper. Both talk to the same `api/` backend, which enqueues jobs onto Redis for the Python `worker/` to process against DeepInfra.

## Stack
- **FE Dashboard**: Next.js 16, React 19, Tailwind v4, Zustand
- **Editor**: PPTist (Vue 3) — served standalone on its own dev server, embedded via iframe
- **API**: Hono + Bun, Drizzle ORM, Postgres 16, Redis 7 (BullMQ used as a plain queue — the worker BRPOPs directly)
- **Worker**: Python, DeepInfra (`deepseek-ai/DeepSeek-V3.1-Terminus` by default)
- **Docker**: postgres, redis, api, worker (Next.js dashboard and the PPTist editor run manually outside Docker)

## Quick start

### 0. Prerequisites
- Docker Desktop
- [Bun](https://bun.sh) (for the API and the Next.js dashboard)
- Node.js 18+ / npm (for the PPTist editor)
- A [DeepInfra](https://deepinfra.com) API key

### 1. Environment files
Copy each `.env.example` to `.env` (and `.env.docker` where present) and fill in `DEEPINFRA_API_KEY`:
```bash
cp api/.env.example api/.env
cp api/.env.example api/.env.docker   # then adjust DATABASE_URL/REDIS_HOST for in-Docker hostnames, see below
cp worker/.env.example worker/.env
cp worker/.env.example worker/.env.docker
cp FE-codebase/.env.example FE-codebase/.env.local
```
`.env` is used for services run **outside** Docker (host networking — `localhost` + remapped ports below). `.env.docker` is used **inside** Docker (container networking — service names like `postgres`/`redis`, default internal ports). The two are not interchangeable; see [Ports](#ports).

### 2. Infrastructure (Docker)
```bash
docker compose up -d --build       # postgres + redis + api + worker
```
Verify: `curl http://localhost:8081/api/v1/health` → `{"status":"healthy"}`

> **Always use `--build` after changing any file in `api/` or `worker/`.** These two services have no bind-mount — their code is baked into the image at build time. `docker compose restart` alone silently keeps serving the old code (no error, just stale behavior) — this bit us during development, don't repeat it.

### 3. Editor (PPTist Vue dev server)
```bash
cd editor
npm install --ignore-scripts   # skips husky (no .git in this subfolder)
npm run dev                    # or: npx vite --port 8082
```
Serves at `http://127.0.0.1:8082/editor/`. Must stay running alongside the dashboard — the dashboard's editor page embeds this exact URL in an iframe.

### 4. Frontend (Next.js)
```bash
cd FE-codebase
bun install
bun dev
```
Serves at `http://localhost:3000`

### 5. Open the app
`http://localhost:3000`

## Ports

Remapped from defaults to avoid collisions with other local projects:

| Service    | Default | Actual   |
|------------|---------|----------|
| API        | 8080    | **8081** |
| Postgres   | 5432    | **5434** |
| Redis      | 6379    | **6380** |
| PPTist     | 5173    | **8082** |
| Next.js    | 3000    | 3000     |

`api/.env` / `worker/.env` (host-side, outside Docker) point at `localhost:5434` / `localhost:6380`. `api/.env.docker` / `worker/.env.docker` (inside Docker) point at `postgres:5432` / `redis:6379` — the container-internal default ports, reached via Docker's own DNS, not the remapped host ports. Mixing these up is a common source of "connection refused" errors.

## Flow

**Generating a new deck**
1. Dashboard — enter a topic, click Generate.
2. Creates an empty deck row → redirects to `/editor/{deckId}?prompt=...&lang=...`.
3. PPTist iframe loads, reads the prompt from the URL, opens the AI Assistant panel and auto-sends it.
4. Outline streams in as markdown (editable) → pick one of 8 template packs → Generate.
5. Deck streams in as JSONL (one slide description per line); PPTist maps each onto the chosen template — font auto-fit, image placement, 240 official slide layouts.
6. Edit freely. Auto-saves via `postMessage` → dashboard → `PUT /decks/:id` → Postgres.

**Editing an existing deck via chat**
1. Open the AI Assistant panel on a deck that already has slides.
2. Type a natural-language instruction — "change all fonts to Poppins", "delete slide 3", "add a slide about pricing".
3. The backend agent (`/tools/agent`) resolves your message to a structured tool call via DeepInfra function-calling.
4. The client applies it through the *same* proven functions the rest of the editor uses (`applyFontToAllSlides`, `applyPresetTheme`, the template-mapping engine for new slides, existing store mutations for delete/reorder/text edits) — the LLM never authors layout or raw content directly, so a bad response can only fail to act, never corrupt the deck.

## Configuration

### API — `api/.env` (host) vs `api/.env.docker` (container)
```
DATABASE_URL=postgres://ppt:ppt123@localhost:5434/ppt_db   # .env
DATABASE_URL=postgres://ppt:ppt123@postgres:5432/ppt_db    # .env.docker
DEEPINFRA_API_KEY=<your-key>
DEEPINFRA_MODEL=deepseek-ai/DeepSeek-V3.1-Terminus
```

### Worker — `worker/.env` (host) vs `worker/.env.docker` (container)
```
DATABASE_URL=postgres://ppt:ppt123@localhost:5434/ppt_db   # .env
REDIS_URL=redis://localhost:6380                            # .env
DATABASE_URL=postgres://ppt:ppt123@postgres:5432/ppt_db    # .env.docker
REDIS_URL=redis://redis:6379                                # .env.docker
DEEPINFRA_API_KEY=<your-key>
```

### Frontend — `FE-codebase/.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:8081
```

## Project structure
```
├── FE-codebase/     # Next.js dashboard (session, deck list, editor iframe wrapper)
├── editor/          # PPTist Vue editor (standalone, modified for integration + dark theme)
│   └── src/views/Editor/AIAssistantPanel/   # chat panel: generate new deck + edit via agent
├── api/             # Hono + Bun backend
│   └── src/routes/v1/tools.route.ts         # /tools/aippt_outline, /aippt, /ai_writing, /agent
├── worker/          # Python worker (DeepInfra)
│   └── services/agent_service.py            # tool-calling: set_font, set_theme, add/delete/
│                                             #   reorder_slide, update_text, create_deck
├── docker/          # Dockerfiles
├── BUG_REPORT.md    # audit findings + fixes from an earlier review pass
└── docker-compose.yml
```

## Key integration points
- **PPTist API calls**: `editor/src/services/index.ts` → our `/api/v1/tools/*` streaming endpoints
- **Deck load**: `editor/src/App.vue` reads `?deckId=` param, fetches from our API
- **Auto-save**: PPTist `postMessage` (origin-checked) → Next.js listener → `PUT /decks/:id`
- **AI streaming contracts**: outline = raw markdown text stream; deck = JSONL `AIPPTSlide` stream; agent = JSONL `{tool, args}` action stream — all three use the same subscribe-before-enqueue + idle-timeout Redis pub/sub pattern in `api/src/routes/v1/tools.route.ts`

## Known gaps (see `BUG_REPORT.md` for the full audit)
- No rate limiting on `/tools/*` — every request triggers a paid DeepInfra call. Fine for local/trusted use, needed before any public deployment.
- Production build for the PPTist editor (serving it as static assets alongside the Next.js app, instead of a separate dev server) isn't wired up yet.
- Image search (`/tools/img_search`) is a stub returning empty results.
