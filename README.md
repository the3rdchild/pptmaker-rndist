# PPT Maker

Presentation maker with a React/Konva slide editor, Next.js dashboard, Hono/Bun API, and a Python worker (DeepInfra LLM).

## Architecture

```
Next.js (3000)                          API (8081)            Worker (Python)
─────────────────                       ─────────             ───────────────
Dashboard                               Hono + Bun            DeepInfra LLM
  ├─ deck list                          ├─ session            ├─ outline (markdown)
  └─ session mgmt                       ├─ deck CRUD          ├─ deck (JSONL slides)
                                        └─ /tools/*           └─ agent (tool-calling)
Editor (React, Konva canvas)
  ├─ slide sidebar + multi-slide
  ├─ drag/resize/rotate, rich text
  ├─ insert toolbar (text/image/shape/chart/table)
  └─ assistant panel (chat-style edit)
     ↕ direct API calls
       auto-save (debounced)
```

The editor is a React component tree embedded directly in the Next.js app — no iframe. The slide canvas runs on Konva (HTML5 canvas) with rich text via TipTap, charts via Chart.js, and 4 template packs (42 layouts). The dashboard and editor talk to the same `api/` backend, which enqueues jobs onto Redis for the Python `worker/` to process against DeepInfra.

## Stack
- **Frontend**: Next.js 16, React 19, Tailwind v4, Zustand (dashboard state), Redux Toolkit (editor state)
- **Editor canvas**: Konva 10 + react-konva 19
- **Rich text**: TipTap 2 (StarterKit + Underline + custom RunStyle mark)
- **Charts**: Chart.js 4
- **API**: Hono + Bun, Drizzle ORM, Postgres 16, Redis 7 (BullMQ used as a plain queue — the worker BRPOPs directly)
- **Worker**: Python, DeepInfra (`deepseek-ai/DeepSeek-V3.1-Terminus` by default)
- **Docker**: postgres, redis, api, worker (Next.js runs manually outside Docker)

## Quick start

### 0. Prerequisites
- Docker Desktop
- [Bun](https://bun.sh) (for the Next.js frontend)
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

### 3. Frontend (Next.js)
```bash
cd FE-codebase
bun install
bun dev
```
Serves at `http://localhost:3000`

### 4. Open the editor
`http://localhost:3000/editor-react` — auto-creates a deck and opens the editor.

## Ports

Remapped from defaults to avoid collisions with other local projects:

| Service    | Default | Actual   |
|------------|---------|----------|
| API        | 8080    | **8081** |
| Postgres   | 5432    | **5434** |
| Redis      | 6379    | **6380** |
| Next.js    | 3000    | 3000     |

`api/.env` / `worker/.env` (host-side, outside Docker) point at `localhost:5434` / `localhost:6380`. `api/.env.docker` / `worker/.env.docker` (inside Docker) point at `postgres:5432` / `redis:6379` — the container-internal default ports, reached via Docker's own DNS, not the remapped host ports. Mixing these up is a common source of "connection refused" errors.

## Editor

The slide editor lives in `FE-codebase/components/slide-editor/` (forked from [Presenton](https://github.com/presenton/presenton), Apache-2.0). It is embedded directly in the Next.js app as a client route — no iframe, no separate dev server.

**Key capabilities:**
- Visual drag/resize/rotate with multi-select, group, undo/redo (via Konva Transformer)
- Rich text editing inline (TipTap)
- 9 element types: text, text-list, image, rectangle, ellipse, line, svg, table, chart
- 4 template packs (general/modern/standard/swift) — 42 positioned layouts total
- Insert toolbar (text/image/shape/chart/table) with variant submenus
- Slide sidebar with thumbnail previews, add/duplicate/delete, and a layout flyout picker
- Assistant panel for chat-style slide editing

**State management:** Redux Toolkit (scoped to the editor route via a Provider in the layout). Active slide index is local component state. Edits dispatch `updateSlideUi` → debounced 1.5s save → `PUT /decks/:id`.

**Template assets** are served from `FE-codebase/public/templates/{general,modern,standard,swift}/`. The asset resolver (`FE-codebase/utils/api.ts`) maps relative `static/` paths to the active pack.

## Flow

**Editing a deck**
1. Open `http://localhost:3000/editor-react` → auto-creates a deck and renders the first template layout.
2. Edit freely — drag, resize, rotate, double-click text to edit inline, insert elements via the right toolbar.
3. Changes auto-save (debounced 1.5s) → `PUT /decks/:id` → Postgres.

**Assistant (chat-style edit)**
1. Open the Assistant panel on a deck that already has slides.
2. Type a natural-language instruction — "change all fonts to Poppins", "delete slide 3".
3. The backend agent (`/tools/agent`) resolves your message to a structured tool call via DeepInfra function-calling.
4. The client applies it through the same mutation functions the rest of the editor uses — the LLM never authors layout or raw content directly, so a bad response can only fail to act, never corrupt the deck.

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
├── FE-codebase/                      # Next.js app (dashboard + editor)
│   ├── app/editor-react/             # editor route (auto-create deck + render)
│   ├── components/
│   │   ├── slide-editor/             # Konva editor (69 files, forked from Presenton)
│   │   ├── editor-react/             # editor UI: sidebar, insert toolbar, assistant, dispatch
│   │   ├── editor-react-client.tsx   # main editor client (deck load → render → save)
│   │   ├── dashboard/                # landing/deck list
│   │   └── ui/                       # shadcn components
│   ├── store/                        # Zustand (session/deck) + Redux (editor)
│   ├── lib/api.ts                    # API client (session, deck CRUD, generate jobs)
│   ├── utils/                        # asset resolver, analytics stubs, api errors
│   └── public/templates/             # 4 template packs (42 layouts) + shared static assets
├── api/                              # Hono + Bun backend
│   └── src/routes/v1/tools.route.ts  # /tools/aippt_outline, /aippt, /ai_writing, /agent
├── worker/                           # Python worker (DeepInfra)
│   └── services/                     # outline, deck, agent generation
├── docker/                           # Dockerfiles
└── docker-compose.yml
```

## Key integration points
- **Editor API calls**: `FE-codebase/components/editor-react-client.tsx` → `/api/v1/decks/:id` (CRUD), `/api/v1/tools/*` (streaming generation)
- **Deck load**: editor route reads `deckId` from URL, fetches from API, seeds Redux
- **Auto-save**: Redux `presentationData` change → debounced 1.5s → `PUT /decks/:id`
- **AI streaming contracts**: outline = raw markdown text stream; deck = JSONL `AIPPTSlide` stream; agent = JSONL `{tool, args}` action stream — all three use the same subscribe-before-enqueue + idle-timeout Redis pub/sub pattern in `api/src/routes/v1/tools.route.ts`

## Credits

The slide editor (`FE-codebase/components/slide-editor/`) is forked from:

- **[Presenton](https://github.com/presenton/presenton)** (Apache-2.0) — Konva canvas engine, element model, selection/transformer, toolbars, template-v2 layout system, importing/adaptation logic

Core libraries used by the editor:

| Library | Repo | Role |
|---------|------|------|
| Konva + react-konva | [konvajs/konva](https://github.com/konvajs/konva) | Canvas rendering + interaction |
| TipTap | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Inline rich text editing |
| Chart.js | [chartjs/Chart.js](https://github.com/chartjs/Chart.js) | Chart elements |
| PptxGenJS | [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | PPTX export (planned) |
| Redux Toolkit | [reduxjs/redux-toolkit](https://github.com/reduxjs/redux-toolkit) | Editor state |
| Radix UI | [radix-ui/primitives](https://github.com/radix-ui/primitives) | shadcn component primitives |
| Lucide | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | Icons |

## Known gaps
- No rate limiting on `/tools/*` — every request triggers a paid DeepInfra call. Fine for local/trusted use, needed before any public deployment.
- PPTX export not wired yet (PptxGenJS is a dependency; needs the JSON→PPTX mapping).
- Image search (`/tools/img_search`) is a stub returning empty results.
- Full AI deck generation (prompt → outline → deck) via the worker is not yet wired into the React editor.
