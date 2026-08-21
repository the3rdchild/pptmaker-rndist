# PPT Maker

AI presentation maker: describe a deck (optionally attach a `.docx`), review the
generated outline, and land in a full slide editor where every element is real,
editable canvas content — not a rendered image.

Four pieces: a **Next.js** app (dashboard + editor + template authoring), a
**Hono/Bun** API, a **Python worker** that talks to the LLM providers, and
**S3-compatible object storage** holding the template themes.

> **Status:** RnD prototype, feature-complete for its scope and handed over for
> productionisation. It runs end to end on a developer machine. It has **no
> authentication** and **no rate limiting** — read
> [Before this ships](#before-this-ships) before deploying it anywhere public.

---

## Contents

- [Architecture](#architecture)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Ports](#ports)
- [Configuration](#configuration)
- [How the app works](#how-the-app-works)
- [The editor](#the-editor)
- [Templates and themes](#templates-and-themes)
- [AI provider layer](#ai-provider-layer)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Traps that will bite you](#traps-that-will-bite-you)
- [Before this ships](#before-this-ships)
- [Known gaps](#known-gaps)
- [Repo docs](#repo-docs)
- [Credits](#credits)

---

## Architecture

```
  BROWSER ─────────────────────────────────────────────────────────────────
  Next.js :3000
    /                       dashboard: topic, page count, .docx attach
    /outline                outline review + theme pick
    /editor-react/[deckId]  the Konva editor
    /template-list          theme gallery
    /template-engine        theme authoring
         │                                    │
         │ x-session-token                    │ same-origin server routes
         ▼                                    ▼
  API :8081 (Hono + Bun) ──────────────  NEXT.JS SERVER ROUTES ────────────
    POST /session                          /api/ai/*             theme pick,
    /decks   CRUD + versions                                     enhance,
    /tools/* enqueue a job                                       visual review
    /status/:jobId                         /api/template-engine/*  authoring
    /stream/:jobId   SSE  ◄──────┐         /api/templates/*        asset proxy
         │                       │         /api/fonts/*  /api/elements
         ▼                       │         /api/stock-images/*
    Postgres 16  ·  Redis 7      │              │
         │  BullMQ add           │ pub/sub      │
         ▼                       │              │
  WORKER (Python) ───────────────┘              │
    BRPOP → dispatch on params.type             │
    outline · deck · outline_chat               │
    agent · writing · image (FLUX)              │
         │                                      │
         ▼                                      ▼
    LLM providers                        S3 / DO Spaces
    deepinfra · gpt · codex · glm ·      templates · elements
    glm-flash · kimi · *-vl              fonts · uploads
```

Two independent LLM paths, on purpose:

- **Worker path** — long generation jobs (outline, deck, chat agent). The API
  writes a `pool_request` row, enqueues onto Redis, and streams the worker's
  Redis pub/sub output back to the browser over SSE.
- **Next.js route path** — short server-side calls the editor makes directly
  (`/api/ai/*`: theme choice, prompt enhance, visual review, auto-label). No
  queue, no worker.

Both resolve providers from their own mirrored registry with matching ids — see
[AI provider layer](#ai-provider-layer).

---

## Stack

| Layer | What |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind v4, Zustand (app state), Redux Toolkit (editor state) |
| Canvas | Konva 10 + react-konva 19, fixed 1280x720 stage, CSS-transform zoom |
| Rich text | TipTap 2 (StarterKit + Underline + custom `RunStyle` mark) |
| Charts / formula | Chart.js 4, MathJax 3 |
| Import / export | `jszip` + `fast-xml-parser` (.pptx and .docx in), `pptxgenjs` (.pptx out), `jspdf` (.pdf out) |
| API | Hono + Bun, Drizzle ORM, Postgres 16, Redis 7 (BullMQ enqueues; the worker `BRPOP`s the wait list directly) |
| Worker | Python 3, `openai` SDK against OpenAI-compatible endpoints |
| Storage | S3-compatible (DO Spaces in dev; R2 / MinIO / AWS also supported) |
| Docker | postgres, redis, api, worker. **Next.js runs outside Docker.** |

---

## Quick start

### 0. Prerequisites

- Docker Desktop
- [Bun](https://bun.sh) (for the Next.js app)
- At least one LLM API key (DeepInfra is the default provider; OpenAI, Zhipu
  GLM and Kimi are supported alternatives)
- An S3-compatible bucket + credentials — **required**, the template themes no
  longer ship in the repo

### 1. Environment files

```bash
cp api/.env.example api/.env && cp api/.env.example api/.env.docker && cp worker/.env.example worker/.env && cp worker/.env.example worker/.env.docker && cp FE-codebase/.env.example FE-codebase/.env.local
```

`.env` is for processes run **outside** Docker (host networking: `localhost` +
the remapped ports). `.env.docker` is for processes run **inside** Docker
(container networking: service names `postgres` / `redis` on their default
internal ports). They are not interchangeable — see [Ports](#ports). Fill in
DB/Redis URLs, at least one LLM key, and the `CDN_*` block in all of them.

### 2. Infrastructure

```bash
docker compose up -d --build
```

Verify: `curl http://localhost:8081/api/v1/health` → `{"status":"healthy"}`

The API container runs `bun run db:push` before starting, so the schema is
created on first boot.

### 3. Frontend

```bash
cd FE-codebase && bun install && bun dev
```

Serves at `http://localhost:3000`.

### 4. First run

Open `http://localhost:3000`, type a topic, hit generate. You should get an
outline at `/outline`, then a streaming deck in the editor.

If the deck comes back with no styling, the bucket is empty or unreachable —
check that `templates/index.json` exists in your bucket and that `CDN_*` is set
in `FE-codebase/.env.local`.

---

## Ports

Remapped from the defaults to avoid collisions with other local projects.

| Service | Default | Host port |
|---|---|---|
| API | 8080 | **8081** |
| Postgres | 5432 | **5434** |
| Redis | 6379 | **6380** |
| Next.js | 3000 | 3000 |

Inside Docker nothing is remapped: `postgres:5432`, `redis:6379`, api on `8080`.
Pointing a `.env.docker` at `localhost:5434` (or a host-side `.env` at
`postgres:5432`) is the most common source of "connection refused" here.

---

## Configuration

Every key below is documented inline in the matching `.env.example` — those
files are the authority, this is the map.

### `FE-codebase/.env.local`

| Key | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the Hono API (`http://localhost:8081`) |
| `CDN_BUCKET_NAME`, `CDN_ENDPOINT`, `CDN_PUBLIC_URL`, `CDN_ACCESS_KEY_ID`, `CDN_SECRET_ACCESS_KEY`, `CDN_REGION` | Object storage. **Server-only — never prefix with `NEXT_PUBLIC_`** |
| `S3_USE_OBJECT_ACL` | `true` for AWS S3 / DO Spaces; leave unset for R2 / MinIO |
| `TEMPLATE_ASSETS_PROXY` | Serve bucket images same-origin. Defaults on, and **required while the bucket has no CORS policy** — canvas export taints without it |
| `TEMPLATE_ENGINE_WRITES` | `true` to allow template authoring in a production build. Off by default because those routes have no auth |
| `KIMI_*`, `OPENAI_*`, `ZHIPU_API_KEY`, `DEEPINFRA_API_KEY` | Providers for the `/api/ai/*` routes |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY` | Stock photo search. The first key set becomes the default provider |

> Bucket names containing dots need the **path-style** endpoint form
> (`https://<region>.digitaloceanspaces.com/<bucket>`) — the virtual-host form
> fails TLS validation against wildcard certs.

### `api/.env` / `api/.env.docker`

`DATABASE_URL`, `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`, `PORT`,
`ORIGIN`, the `CDN_*` block (used for image uploads), and `PPT_QUEUE_NAME` /
`PPT_JOB_NAME` — the last two **must match the worker's**.

### `worker/.env` / `worker/.env.docker`

`DATABASE_URL`, `REDIS_URL`, the queue names, `STREAM_CHANNEL_PREFIX` (must
match what the API's SSE route subscribes to), plus:

| Key | Purpose |
|---|---|
| `LLM_PROVIDER` | Default text provider: `deepinfra` (default), `gpt`, `codex`, `glm`, `glm-flash`, `qwen-vl`, `gemma-vl`, `llama-vl`, `kimi` |
| `DEEPINFRA_*` | Text model, and the **image** model (`black-forest-labs/FLUX-2-klein-4b`) — image generation always goes to DeepInfra regardless of `LLM_PROVIDER` |
| `OPENAI_*`, `ZHIPU_*`, `KIMI_*` | Alternative provider credentials |

> `worker/.env.docker` ships with `LLM_PROVIDER=openai` while `worker/.env` uses
> `deepinfra` — "the default model" means different things depending on whether
> the worker runs in Docker or on the host.

---

## How the app works

### Generate a deck

1. **Dashboard** (`/`) — topic, language, page count, provider overrides for
   each stage (generate / verify / repair), AI-vs-stock image source, and an
   optional `.docx` attachment. All of it travels as query params.
2. **Outline** (`/outline`) — streams `POST /tools/aippt_outline` as raw
   markdown. The user edits pages, picks a theme (or lets `/api/ai/choose-theme`
   pick one from the topic), and hits Generate. A deck row is created and the
   approved outline is passed on.
3. **Editor** (`/editor-react/[deckId]`) — streams `POST /tools/aippt` as JSONL.
   For each slide the client picks a layout from the theme, fills the layout's
   named slots with the model's text, kicks off photo generation for the image
   slots, and (optionally) runs a visual review + repair pass.
4. Everything after that is normal editing. Edits go through Redux and autosave
   is debounced 1.5s to `PUT /decks/:id`. That endpoint snapshots the
   about-to-be-overwritten payload into `deck_version` — throttled to one
   checkpoint per deck per 10 minutes, not one per autosave.

The approved outline's page count rides the **deck** request as well as the
outline one (`slideCount`, counted from `^## ` headings), because the deck
generator otherwise sees only the outline text and merges pages down to its own
6-9 default.

### Other entry points

- **Blank deck** — `/editor-react?blank=1` creates a deck holding one empty
  slide (without `blank=1` the editor seeds the theme's first layout instead).
- **Import .pptx** — parsed entirely in the browser
  (`components/slide-editor/importing/`), then saved as a normal deck.
- **Attach .docx** — parsed in the browser too. Prose feeds the outline and the
  copy; figures and tables inside the document become placeable assets the model
  can drop into a layout's image slots by id (`fig-3`, `tbl-1`). Extraction
  stays local — nothing is uploaded, and only the assets actually placed end up
  in the deck payload.

### Job lifecycle (worker path)

```
POST /tools/*  →  pool_request row  →  BullMQ add  →  worker BRPOP
                                                          │
browser  ←── SSE /stream/:jobId ←── API subscribes ←── worker publishes
                                     ppt:stream:<jobId>
```

The API subscribes **before** enqueueing and applies an idle timeout, so a fast
job cannot finish before the client is listening. Job types the worker
dispatches: `outline`, `deck`, `outline_chat`, `agent`, `writing`, `image`.

---

## The editor

Entry: `app/editor-react/[deckId]/page.tsx` →
`components/editor-react-client.tsx` (the top-level shell: header, slide
sidebar, canvas, right rail, AI panel).

It is a React component tree embedded directly in the Next.js app — no iframe,
no second dev server. The canvas is Konva; the older Vue/PPTist editor is gone.

**What it does:**

- Drag / resize / rotate with multi-select, grouping, undo/redo, Canva-style
  snap guides and spacing badges
- Inline rich text (TipTap), 12 element types: `text`, `text-list`, `image`,
  `rectangle`, `ellipse`, `line`, `svg`, `path`, `table`, `chart`, `formula`,
  `media` (`components/slide-editor/types.ts` is the authority)
- Insert rail: Templates, Elements (shapes, charts, media, icons, saved
  elements), Text (styles, table, formula), Uploads, Background — drag-and-drop
  onto the canvas at the size the element will land
- Per-element animation: effect catalog, build order, on-click builds, canvas
  preview, playback in present mode
- Present mode with slide transitions (including morph), presenter view with a
  synced second window, and a media overlay
- Export: `.pptx` (`export-pptx.ts`) and `.pdf` (rasterised via
  `PdfExportCapture`)
- Version history (`/decks/:id/versions`), find & replace, colour-palette
  editor, motif library, stock-photo fill, and a font library with upload plus
  automatic substitution for unresolvable fonts
- AI assistant panel: natural language → tool call → the same mutation
  functions the UI uses. The model never authors layout or raw content
  directly, so a bad response can fail to act but cannot corrupt the deck. It
  has its own model switcher (`localStorage.ppt_chat_provider`).

**State:** Redux Toolkit, scoped to the editor route by a Provider in the
layout. `slide.ui` **is** the layout — the template importer is only the render
path, and Konva owns `uiDraft`; mutate through `commitUi`, not the layout prop.

**Where the heavy code is:**

| File | Role |
|---|---|
| `components/editor-react-client.tsx` | 134KB shell — load, save, header, all panel wiring |
| `components/slide-editor/surface/TemplateV2KonvaSlide.tsx` | ~2000 lines — rendering, drag/resize, snap guides, spacing badges |
| `components/editor-react/ai-layout-fill.ts` | 76KB — the deck-generation client: layout choice, slot fill, photos, review/repair |
| `components/template-engine/template-engine-panel.tsx` | 90KB — the template authoring UI |
| `components/editor-react/present-mode.tsx` | 46KB — present mode, transitions, animation playback |

**Design tokens** live in `app/globals.css` (`--bg-*`, `--accent*`,
`--shadow-*`, `--border*`); shared editor primitives in
`components/editor-react/ui.tsx`.

---

## Templates and themes

Nothing ships in `public/` any more. A theme is one prefix in the bucket:

```
templates/index.json                  the theme list (authority)
templates/<theme>/theme.json          authored metadata: AI guidance + palette
templates/<theme>/template.json       the built bundle the renderer consumes
templates/<theme>/layouts/<id>.json   per-layout sources (template engine)
templates/<theme>/static/…            the theme's own images
elements/…                            the shared element library
fonts/…                               the global font library
```

`lib/templates/themes.ts` is the single registry every consumer goes through —
it tags each layout with the theme it came from, which both the asset resolver
and the template engine's save target depend on. Themes present at last sync:
`adventure`, `business`, `cassual-2`, `financial`, `general`, `history`,
`modern`, `portofolio`, `standard`, `startup`, `swift`, `technology`.

Manifests are fetched **server-side** through `/api/templates/…` so the bucket
needs no CORS policy; images are proxied same-origin by
`/api/templates/asset/[...key]` for the same reason (and because canvas export
taints on a cross-origin image).

**Authoring** happens at `/template-engine` — import a `.pptx` page or build one
by hand, then label its slots. **Bulk slot labelling** is better done as a text
edit: `node scripts/theme-sync.mjs pull <theme>` drops the authored JSON into
`FE-codebase/.theme-work/<theme>/`, and `push <theme>` sends it back through the
running dev server (which owns the merge rule deciding which version of a layout
wins). `--dry-run` is supported.

### What generation is allowed to fill

Three **independent** detectors, no shared list — add an element type and you
must check all three:

| Slot | Detector | Requires |
|---|---|---|
| Text / chart | `collectNamedTextSlots` (`ai-slot-fill.ts`) | type `text` / `text-list` / `chart`, `decorative !== true`, non-empty `name`. A named element is a leaf; its descendants are not searched |
| Photo | `findAllPhotoSlots` (`ai-layout-fill.ts`) | `isImageFrameElement` → filled **unconditionally**; otherwise `is_icon !== true`, `decorative !== true`, named, and area > 20000px² |
| Icon | — | `is_icon === true` **and** `data === "/static/icons/placeholder.svg"` exactly |

Never touched: `path`, `rectangle`, `ellipse`, `line`, `table`, `media`,
`formula`, unnamed text, anything `decorative`.

Consequence: a freshly imported `.pptx` page names nothing and sets
`is_frame: false`, so it offers **0 slots** and is inert until an author names
them in the template engine. That is deliberate. `isImageFrameElement` infers
`is_frame` from a non-empty `clippath` when the flag is absent — which is why a
decorative clipped image can silently become a mandatory photo slot.

The agent's `replace_image` mirrors the photo predicate on purpose
(`isPhotoSlotElement` in `agent-dispatch.ts`). Keep the two in agreement.

---

## AI provider layer

Providers are presets in **two mirrored registries** whose ids match
one-for-one:

- `FE-codebase/lib/ai-providers.ts` → `PROVIDER_PRESETS` (Next.js routes)
- `worker/core/configs/env.py` → `PROVIDER_CONFIGS` (worker)

`openai` and `zhipu` survive as aliases of `gpt` and `glm-flash`. Unknown ids
degrade to the default rather than erroring — convenient in production,
treacherous in testing (see [Traps](#traps-that-will-bite-you)).

Each preset declares `api`: `"chat"` (`/chat/completions`, default) or
`"responses"` (`/responses`). The `gpt-*-codex` models are served on
`/responses` **only** — `/chat/completions` answers 404. `callProvider` (FE) and
`llm_client` (worker) hide the difference, so call sites always pass chat-style
messages. Under the hood the `responses` shape differs in five ways:
`messages` → `input`; image parts become
`{type:"input_image", image_url:"<url>"}` with a bare string url;
`max_tokens` → `max_output_tokens`; `temperature` is rejected at every explicit
value (so it is dropped, not pinned); and tools flatten out of the `"function"`
wrapper.

**The one worth remembering:** reasoning tokens bill against the same
`max_output_tokens` budget as the answer, so a call site that sized the budget
for the answer alone gets HTTP 200 with empty text and `status:"incomplete"`.
Both layers floor it at 4000 (`RESPONSES_MIN_OUTPUT_TOKENS`) and keep
`reasoning.effort` low.

Timeouts: vision calls and any `responses` preset get 180s, plain text 60s.
There is **no client-side timeout** on the editor panel's fetch, so a slow
provider shows as an indefinite spinner rather than an error.

Measured (single run, same 149KB PNG, 2026-08-14): auto-label 6.6s on codex vs
13.8s on qwen-vl; visual-review verify 2.3s vs 6.6s. `llama-vl` is 2-5x slower
than `qwen-vl` and wildly variable — don't make it a default. Payload weight
dominates at the top end, which is why `captureSlidePng` sends a 1x JPEG rather
than a 2x PNG.

---

## API reference

Base: `http://localhost:8081/api/v1`. Auth: an `x-session-token` header holding
an anonymous token the browser generates and keeps in `localStorage`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | |
| `POST` | `/session` | Idempotent upsert of the anonymous token |
| `GET` | `/decks` · `/decks/:id` | |
| `POST` | `/decks` | |
| `PUT` | `/decks/:id` | Full save (what autosave calls). Snapshots a version first, throttled to 10 min/deck |
| `PATCH` | `/decks/:id` | Metadata only: title, favourite, thumbnail |
| `DELETE` | `/decks/:id` | |
| `GET` | `/decks/:id/versions` · `/decks/:id/versions/:versionId` | |
| `POST` | `/decks/:id/versions/:versionId/restore` | |
| `POST` | `/tools/aippt_outline` | → job. Raw markdown stream |
| `POST` | `/tools/aippt` | → job. JSONL `AIPPTSlide` stream |
| `POST` | `/tools/outline_chat` | → job. Outline refinement chat |
| `POST` | `/tools/agent` | → job. JSONL `{tool, args}` action stream |
| `POST` | `/tools/ai_writing` | → job |
| `POST` | `/tools/image` | → job. FLUX via DeepInfra |
| `POST` | `/tools/img_search` | **Stub** — always `{data: [], total: 0}`. Working stock search lives in the Next.js routes instead |
| `GET` | `/status/:jobId` | Poll fallback |
| `GET` | `/stream/:jobId` | SSE. Rejects a job the session does not own |

Next.js server routes (same origin as the app, not the Hono API):
`/api/ai/{choose-theme,enhance-prompt,providers,visual-review}`,
`/api/template-engine/*`, `/api/templates/*`, `/api/fonts/*`, `/api/elements`,
`/api/stock-images/*`.

---

## Project structure

```
├── FE-codebase/                     # Next.js app — dashboard, editor, template engine
│   ├── app/
│   │   ├── page.tsx                 # dashboard
│   │   ├── outline/                 # outline review step
│   │   ├── editor-react/[deckId]/   # the editor
│   │   ├── template-list/           # theme gallery
│   │   ├── template-engine/         # theme authoring
│   │   └── api/                     # server-only routes (ai, templates, fonts, stock images)
│   ├── components/
│   │   ├── editor-react-client.tsx  # editor shell (134KB)
│   │   ├── editor-react/            # panels, generation client, animation, present mode, export
│   │   ├── slide-editor/            # Konva engine (95 files, forked from Presenton)
│   │   │   ├── surface/             # rendering, drag/resize/snap
│   │   │   ├── importing/           # .pptx import + DrawingML geometry
│   │   │   └── …                    # animation, charts, tables, text, selection, state
│   │   ├── template-engine/         # authoring panel + auto-label
│   │   └── dashboard/ outline/ template-list/ shared/ ui/
│   ├── lib/
│   │   ├── api.ts                   # API client + SSE
│   │   ├── ai-providers.ts          # FE provider registry
│   │   ├── templates/               # theme registry, manifest, auto-label, palette
│   │   ├── source-docs/             # .docx extraction, digest, IndexedDB store
│   │   ├── storage/                 # S3 client + asset proxy
│   │   └── fonts/ elements/         # global libraries
│   ├── scripts/                     # theme-sync, storage migration, icon generation
│   └── store/                       # Zustand (session/deck) + Redux (editor)
├── api/                             # Hono + Bun
│   └── src/routes/v1/               # health, session, deck, tools, status, stream
├── worker/                          # Python worker
│   ├── services/                    # outline, deck, agent, writing, image, llm_client
│   └── core/                        # configs (provider registry), db, queue, logging
├── docker/                          # Dockerfiles
├── docs/                            # storage notes, React-editor feasibility study
└── docker-compose.yml
```

---

## Traps that will bite you

Every one of these has already cost someone a debugging session.

1. **`docker compose restart` runs stale code.** `api/` and `worker/` have no
   bind mount — their source is baked into the image at build time. Always
   `docker compose up -d --build <service>` after touching either. No error is
   raised; it quietly serves the old build.

2. **Zod silently strips unknown keys.** Anything added to a `/tools/*` request
   body must also be declared in that route's schema in
   `api/src/routes/v1/tools.route.ts`, or it vanishes in transit and the worker
   never sees it. This has swallowed both the `model` override and the
   `imageSlots` deck summary. Verify against the stored row, not the HTTP
   response:
   `select params->'deckSummary'->'slides'->0 ? 'imageSlots' from pool_request;`

3. **Provider fallback masks a dropped param.** `resolve_provider` degrades to
   the default for anything it cannot resolve, so a request whose `model` was
   stripped behaves *identically* to one that worked. The only thing that
   reveals it is the worker log:
   `docker compose logs worker | grep agent_service` → look for `provider=`.

4. **`adaptImage` / `adaptStroke` in `template-v2-import.ts` are whitelists.**
   A field not listed there is silently dropped every time a template loads.
   This has bitten four times (`is_frame`, then `credit` / `credit_url` /
   `source_url` / `prompt`, plus a stroke-width clamp). Any new field on
   `ImageElement` or `Stroke` must be added there in the same change.

5. **Anything that enumerates element types needs to know about `path`.**
   `state.ts`'s `ShapeSlideElement`, `toolbarTarget.ts`'s toolbar gate, and the
   template-import whitelist all had to be updated when it was added. Check
   those first if an element ever behaves inertly on the canvas.

6. **The two provider registries must stay in sync.** The editor panel reads its
   list from `/api/ai/providers` (the Next.js env) but the chat executes on the
   worker (a different env file). Drift degrades to the default model instead of
   erroring — if a picked model behaves like the default, check that first.

7. **`.env` vs `.env.docker`.** See [Ports](#ports).

8. **Test AI features against imported decks, not just generated ones.** An
   imported deck has dozens of unnamed decorative images and sets neither
   `is_icon` nor `decorative`; a generated one is tidy. A fixture where the
   image count equals the slot count will pass even while the slot list is being
   dropped entirely.

9. **`.pptx` media weight.** The deck importer inlines media as `data:` URLs, so
   every embedded byte is re-paid on each autosave, undo snapshot and clone.
   Images over 2560px are re-encoded to WebP on the way in (a 148MB source deck
   lands at 43MB). The template-engine path avoids this by uploading to S3
   instead. Don't disable RTK's dev immutability checks to "fix" slowness here —
   they cost ~1ms; the real cost is serialization.

---

## Before this ships

Nothing in this list is a bug. These are the deliberate RnD-scope boundaries
that productionisation has to close.

- **No authentication.** `POST /session` accepts any client-generated string of
  8+ characters and creates a row for it. Deck ownership is scoped to that
  token, so guessing one grants full access to those decks. There is no user
  model.
- **No rate limiting on `/tools/*`.** Every request triggers a paid LLM call.
- **Template engine routes have no auth.** They are blocked in production builds
  unless `TEMPLATE_ENGINE_WRITES=true`; that flag is a stopgap for a single
  trusted author, not a permission model.
- **Bucket objects are public-read by URL.** Anyone who knows or guesses a key
  can fetch any asset. See `docs/storage-staging-notes.md`.
- **Bucket CORS is unset**, so template assets are proxied through the Next.js
  server (`TEMPLATE_ASSETS_PROXY`). Configure CORS and turn the proxy off to
  stop paying that hop.
- **Secrets live in `.env` files only** — no secret manager, no key rotation.
- **The Next.js app is not containerised.** `docker-compose.yml` has a commented
  `fe` service and `docker/Dockerfile.fe` exists, but the frontend has only ever
  been run via `bun dev`.

Also out of scope by agreement, owned by other teams: offline mode, sharing and
permissions, account/sign-up onboarding, brand kits, comments, and live
collaboration. (The editor does ship a small first-run feature tour —
`onboarding-tour.tsx`, driver.js, flagged in `localStorage` — that is the whole
of what exists here.)

---

## Known gaps

**Import / export**

- `.pptx` import does not handle charts or SmartArt (`p:graphicFrame` with
  non-table graphic data — 2 occurrences across the 20 sample decks), gradient
  fills (approximated by their first stop), `a:tile` picture fills, group-level
  flips, `a:bodyPr` text insets, or per-paragraph indentation.
- `.pptx` export does not understand gradient / pattern / image backgrounds. The
  legacy solid-colour `ui.background` is kept in sync as a fallback so export
  will not crash — a gradient background exports flat.
- Source documents: `.docx` only. `.pdf` needs `pdfjs-dist`, and PDF image
  extraction is genuinely messy. There is no manual "insert from document"
  panel — placement is AI-chosen, with a caption↔slide-text keyword fallback
  that runs only when the model placed nothing at all.

**Editor**

- Shape-icon elements (triangle / star / polygon / arrows / diamond) are `image`
  elements holding self-contained SVG data URIs, so they are **not** recolorable
  through the shape fill/stroke toolbar — only through the image toolbar.
  `lib/svg-color.ts` references an `/api/update-svg` route that **does not exist
  in this codebase**; don't assume that pipeline works.
- Resize snapping is single-component only; spacing badges fire on drag, not on
  resize.
- "Recently used" / "Recently uploaded" are in-memory React state — reset on
  reload, never persisted.
- "Magic Write" (Text tab) and "Magic Media" are visible stubs.
- `/tools/img_search` is a stub; the working stock search is
  `/api/stock-images/*`.

---

## Repo docs

| File | What it is |
|---|---|
| `api/README.md` | API-only dev notes |
| `FE-codebase/components/slide-editor/README.md` | Konva engine internals |
| `docs/storage-staging-notes.md` | What the S3 migration left open for staging/production. **Read before deploying** |
| `docs/react-editor-feasibility.md` | Historical: the study behind replacing the Vue editor |
| `BUG_REPORT.md` | **Historical audit from 2026-07-10.** Most findings are fixed, and some describe an architecture (the Vue/iframe editor) that no longer exists. Not an open bug list |

---

## Credits

The slide editor (`FE-codebase/components/slide-editor/`) is forked from
**[Presenton](https://github.com/presenton/presenton)** (Apache-2.0) — Konva
canvas engine, element model, selection/transformer, toolbars, template-v2
layout system, import/adaptation logic.

| Library | Repo | Role |
|---|---|---|
| Konva + react-konva | [konvajs/konva](https://github.com/konvajs/konva) | Canvas rendering + interaction |
| TipTap | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Inline rich text |
| Chart.js | [chartjs/Chart.js](https://github.com/chartjs/Chart.js) | Chart elements |
| MathJax | [mathjax/MathJax-src](https://github.com/mathjax/MathJax-src) | Formula elements |
| PptxGenJS | [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | `.pptx` export |
| jsPDF | [parallax/jsPDF](https://github.com/parallax/jsPDF) | `.pdf` export |
| fast-xml-parser | [NaturalIntelligence/fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) | `.pptx` / `.docx` parsing |
| Redux Toolkit | [reduxjs/redux-toolkit](https://github.com/reduxjs/redux-toolkit) | Editor state |
| Radix UI | [radix-ui/primitives](https://github.com/radix-ui/primitives) | shadcn primitives |
| Lucide + Tabler | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | Icons |

Licensed under Apache-2.0 — see `LICENSE`.
