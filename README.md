# PPT Maker

AI-powered presentation maker. Hybrid architecture: Next.js dashboard + PPTist Vue editor (iframe) + Hono/Bun API + Python worker (DeepInfra).

## Architecture

```
Next.js (3000)          PPTist Vue (8082)          API (8081)         Worker
─────────────────       ───────────────────         ─────────         ──────
Dashboard (React)       Editor (240 templates,      Hono + Bun        Python
  ├─ prompt input         149 shapes, full           ├─ session        ├─ DeepInfra LLM
  ├─ recent decks         interactions)              ├─ deck CRUD      ├─ outline (markdown)
  └─ templates            └─ AI dialog built-in       ├─ generate       ├─ deck (JSONL)
                                                       ├─ SSE stream     ├─ agent (tools)
Editor route            iframe ←→ postMessage         └─ /tools/*       └─ writing
  └─ <iframe PPTist>     auto-save ↔ BE
```

## Stack
- **FE Dashboard**: Next.js 16, React 19, Tailwind v4, Zustand
- **Editor**: PPTist (Vue 3) — served standalone, embedded via iframe
- **API**: Hono + Bun, Drizzle ORM, Postgres 16, Redis 7 (BullMQ)
- **Worker**: Python, DeepInfra (DeepSeek-V3.1-Terminus)
- **Docker**: postgres, redis, api, worker

## Quick start

### 1. Infrastructure (Docker)
```bash
docker compose up -d        # postgres + redis + api + worker
```
Verify: `curl http://localhost:8081/api/v1/health` → `{"status":"healthy"}`

Ports (remapped to avoid conflicts):
- API: **8081**
- Postgres: **5434**
- Redis: **6380**

### 2. Editor (PPTist Vue dev server)
```bash
cd editor
npm install --ignore-scripts
npx vite --port 8082
```
Serves at `http://127.0.0.1:8082/editor/`

### 3. Frontend (Next.js)
```bash
cd FE-codebase
bun install
bun dev
```
Serves at `http://localhost:3000`

### 4. Open the app
`http://localhost:3000`

## Flow
1. **Dashboard** — enter topic, click Generate
2. Creates empty deck in DB → opens PPTist editor
3. PPTist auto-opens AI dialog with your topic
4. AI generates outline (markdown stream) → you review/edit
5. Click generate → AI creates deck (JSONL AIPPTSlide stream)
6. PPTist maps slides to 240 templates (fonts, images, shapes)
7. Edit freely → auto-saves via postMessage → API → Postgres

## Configuration

### API (`api/.env`)
```
DATABASE_URL=postgres://ppt:ppt123@localhost:5434/ppt_db
DEEPINFRA_API_KEY=<your-key>
DEEPINFRA_MODEL=deepseek-ai/DeepSeek-V3.1-Terminus
```

### Worker (`worker/.env`)
```
DATABASE_URL=postgres://ppt:ppt123@localhost:5434/ppt_db
REDIS_URL=redis://localhost:6380
DEEPINFRA_API_KEY=<your-key>
```

### Frontend (`FE-codebase/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:8081
```

## Project structure
```
├── FE-codebase/     # Next.js dashboard + outline + editor iframe wrapper
├── editor/          # PPTist Vue editor (standalone, modified for integration)
├── api/             # Hono + Bun backend
├── worker/          # Python worker (DeepInfra AI)
├── docker/          # Dockerfiles
└── docker-compose.yml
```

## Key integration points
- **PPTist API calls**: `editor/src/services/index.ts` → our `/api/v1/tools/*` streaming endpoints
- **Deck load**: `editor/src/App.vue` reads `?deckId=` param, fetches from our API
- **Auto-save**: PPTist `postMessage` → Next.js listener → `PUT /decks/:id`
- **AI streaming**: outline = markdown text stream; deck = JSONL AIPPTSlide stream
