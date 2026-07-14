# Handoff: AI PPT Maker — React Editor Prototype (RnD)

> **For:** Claude (or any AI agent) continuing development
> **Branch:** `feat/react-editor-prototype` on `github.com/the3rdchild/pptmaker-rndist`
> **Date:** 2026-07-11
> **Author:** ZCode session (RnD feasibility prototype)

This document is self-contained. Read it top-to-bottom before touching code.

---

## 1. Project context

This is an **RnD prototype** inside a larger PPT maker product. The goal is to determine whether the current **Vue/PPTist** slide editor can be replaced by a **React** editor of comparable capability. The prototype lives inline in the existing Next.js dashboard (`FE-codebase/`).

### Architecture (current product)

```
Next.js dashboard (FE-codebase/)  ──iframe──  PPTist Vue editor (editor/, port 8082)
        │                                          │
        │  deck CRUD (Zustand)                     │  fetch deck + /tools/* streaming
        ▼                                          ▼
Hono/Bun API (api/, port 8081)  ←──  Python worker (worker/, DeepInfra LLM)
        │                                   │
   Postgres (5434)                    Redis (6380, BullMQ queue)
```

- **PPTist** (Vue 3, AGPL-3.0) is the current editor — 197 components, 9 element types, 240 templates, ProseMirror rich text, pptxgenjs export. AGPL is a commercial blocker.
- **Replacement**: forked Presenton's slide-editor (Apache-2.0, React 19/Konva) into `FE-codebase/components/slide-editor/`.

### Key directories

| Path | What |
|------|------|
| `FE-codebase/components/slide-editor/` | **69 files forked from Presenton** — the Konva editor, types, model, toolbars, importing. Do not edit unless necessary. |
| `FE-codebase/components/editor-react/` | **New UI components** built in this prototype: `slide-sidebar.tsx`, `insert-toolbar.tsx` |
| `FE-codebase/components/editor-react-client.tsx` | Main editor client — loads deck, renders active slide, wires sidebar + toolbar |
| `FE-codebase/store/presentationGeneration.ts` | **Redux slice** (scoped to editor route) — slides array + slide ops (add/delete/duplicate/updateSlideUi) |
| `FE-codebase/store/editorStore.ts` | `makeEditorStore()` factory + `RootState`/`AppDispatch` types |
| `FE-codebase/app/editor-react/[deckId]/` | Next.js route — `page.tsx` (entry) + `layout.tsx` (Redux Provider) |
| `FE-codebase/lib/`, `FE-codebase/utils/`, `FE-codebase/components/ui/` | **Shims** for Presenton's outside deps (cn, shadcn components, asset resolver, analytics stubs, apiErrorMessages) |
| `FE-codebase/public/templates/{general,modern,standard,swift}/` | **4 Presenton template packs** (42 layouts total) — real positioned layouts, NOT AI-generated |
| `FE-codebase/public/static/` | Shared assets (placeholder.svg, replaceable_template_image.png) |
| `editor/` | The existing PPTist Vue editor (still running, not removed) |
| `worker/services/{outline,deck,agent}_service.py` | Python worker — emits AI generation output to Redis |

---

## 2. What's been built (Phases 1–3)

### Phase 1: Vertical slice ✅ (commit `f602fc7a`)
- Forked Presenton `slide-editor/` (69 files) into `FE-codebase/components/slide-editor/`
- Created all shims so the editor compiles standalone:
  - `lib/utils.ts` (`cn`), `lib/svg-color.ts`
  - `components/ui/` — 8 shadcn components (button, input, sheet, skeleton, switch, dropdown-menu, sonner, tooltip)
  - `components/ToolTip.tsx`
  - `utils/api.ts` — asset resolver (`resolveBackendAssetSource/Url`) pointing at `/templates/{pack}/static/` and `/static/`
  - `utils/analytics.ts`, `utils/mixpanel.ts` — no-op stubs (full `MixpanelEvent` enum preserved so editor code compiles)
  - `store/presentationGeneration.ts` + `store/editorStore.ts` + `store/store.ts` — scoped Redux
  - `app/(presentation-generator)/services/api/{images,presentation-generation,types}.ts` — stubs (ImagesApi.uploadImage returns object URL, searchIcons returns [])
- Copied 4 Presenton template packs to `public/templates/`
- Route `app/editor-react/[deckId]/page.tsx` renders single editable slide, loads deck from API, debounced save (1.5s) round-trips to `PUT /decks/:id`
- **Verified:** slide renders, drag triggers PUT 200, state persists after refresh, zero typecheck errors, zero console errors

### Phase 2: Slide sidebar + multi-slide ✅ (commit `ec6bb4e6`)
- Redux slice: added `addSlide`, `deleteSlide`, `duplicateSlide` actions with re-indexing
- `SlideSidebar` component (`components/editor-react/slide-sidebar.tsx`):
  - Thumbnail list (each renders Konva slide scaled at `THUMB_SCALE = 0.094`)
  - Per-slide duplicate/delete buttons on hover
  - **Add box** at bottom of list: single box matching thumbnail size, split into `+` (left, add blank slide) and `>` (right, toggle layout flyout). This is the final design the user explicitly approved.
  - `LayoutPicker`: flyout panel expands **to the right** of the sidebar (NOT a modal overlay), 2-column grid of 12 layouts from `general/template.json`
- `editor-react-client.tsx`: multi-slide with local `activeIndex` state, renders active slide only (`key={safeActive}` remounts on switch)
- **Design note:** The user was very specific about the add box UX. Do NOT change it back to a modal or separate buttons. The box is ONE element with `+` (flex-1 area) and `>` (narrow right strip, border-left separator). Click `+` = instant blank slide. Click `>` = toggle flyout.

### Phase 3: Insert toolbar ✅ (commit `14fbb76f`)
- `InsertToolbar` component (`components/editor-react/insert-toolbar.tsx`):
  - Vertical toolbar on the far right: Text, Image, Shape, Chart, Table
  - Text/Shape/Chart have **submenus** that pop out to the left (since toolbar is on the right edge)
  - Text submenu: title-block, subtitle, body-text, bullet-list, numbered-list, quote
  - Shape submenu: rectangle, ellipse, line
  - Chart submenu: bar, line, pie, donut
- Uses Presenton's own insert functions: `createTextInsertElements`, `createElementInsertElements`, `createChartInsertElements`, `createTableInsertElements`, `createImageInsertContent` + `appendInsertedContent` from `model/inserted-content.ts`
- Insert flow: `createXxxInsertElements(kind)` → `appendInsertedContent(activeUi, elements, [])` → returns new ui → `dispatch(updateSlideUi({index, ui}))`
- **Verified:** text box and ellipse shape spawn correctly on canvas

### What's NOT built yet (future phases)
- ❌ AI generation (Phase 4 — see §4)
- ❌ PPTX export (needs `template-v2-json-to-html.ts` 2364 lines + pptxgenjs mapping)
- ❌ PPTX import
- ❌ LaTeX/formula (needs TipTap math extension + KaTeX)
- ❌ Slide reorder via drag-drop (needs dnd-kit)
- ❌ Undo/redo UI (Presenton editor has internal `undoStackRef`/`redoStackRef` but no toolbar button wired)
- ❌ Dashboard link switch (`/editor/{deckId}` → `/editor-react/{deckId}`)

---

## 3. Schema mismatch — the core problem for AI gen

This is the **most important section** to understand before building Phase 4.

### Two incompatible slide schemas coexist

**PPTist / worker schema** (`editor/src/types/AIPPT.ts`):
```ts
// ABSTRACT — no positioning, no layout
type AIPPTSlide =
  | { type: "cover";      data: { title: string; text: string } }
  | { type: "contents";   data: { items: string[] } }
  | { type: "transition"; data: { title: string; text: string } }
  | { type: "content";    data: { title: string; items: { title: string; text: string }[] } }
  | { type: "end" }
```
The worker (`worker/services/deck_service.py`) emits these as **JSONL** (one slide per line) via a streaming POST to `/api/v1/tools/aippt`. PPTist then maps each onto its own static template packs (8 packs of `Slide[]` with `textType`-tagged elements).

**Presenton / React editor schema** (`components/slide-editor/types.ts` + `model/core.ts`):
```ts
// CONCRETE — positioned elements with px coordinates, colors, fonts
type RawUi = TemplateV2Layout & UnknownRecord
type TemplateV2Layout = { id?, description?, elements?: unknown[], components?: unknown[] }
// Each component: { id, position: {x,y}, size: {width,height}, elements: SlideElement[] }
// Each element: { type: "text"|"image"|"rectangle"|"chart"|..., position, size, fill, font, runs, ... }
```
The editor renders `ui` directly — it contains fully-positioned elements. There's no "fill this abstract slot" step.

### The worker CANNOT emit Presenton `ui` directly

The worker's LLM prompt instructs it to emit the abstract `AIPPTSlide` JSONL. It has no knowledge of Presenton's coordinate system, element types, or layout structure. Options to bridge:

---

## 4. Bridge options for AI generation (Phase 4)

### Option A: Client-side adapter ⭐ RECOMMENDED

**How:** Worker stays untouched (emits AIPPTSlide JSONL). The React editor has a mapping layer that converts each `AIPPTSlide` into a Presenton `RawUi` using pre-baked layouts.

**Pre-baked layouts needed** (1 per AIPPT type, stored as JSON):
- `cover-layout.json` — title + subtitle text elements, centered
- `contents-layout.json` — numbered list of items
- `transition-layout.json` — section header with accent
- `content-layout.json` — title + bullet items (the `text-list` element type)
- `end-layout.json` — simple "Thank you" centered

These can be **derived from the existing `general/template.json` layouts** — pick one layout per type, then the adapter fills its text slots with `AIPPTSlide.data`.

**Mapping function** (pseudocode):
```
for each AIPPTSlide in stream:
  layout = preBakedLayouts[slide.type]  // clone
  if slide.type == "cover":
    fill layout's title element with slide.data.title
    fill layout's subtitle element with slide.data.text
  if slide.type == "content":
    fill title element with slide.data.title
    fill text-list element's items with slide.data.items.map(i => i.title + ": " + i.text)
  dispatch(addSlide({ ui: layout }))
```

**Pros:**
- Worker unchanged (zero backend risk)
- Fast, deterministic, no extra LLM calls
- Reliable — no risk of LLM emitting malformed layout JSON
- Reuses Presenton's own element model

**Cons:**
- Only 5 layout variations (static — every cover looks the same, every content slide looks the same)
- No image generation, no dynamic element selection
- To add variety, you'd need multiple pre-baked layouts per type and randomize

**Effort:** Medium. Build ~5 layout JSON files (can adapt from existing templates), write `mapAIPPTSlideToUi()` function (~100 lines), build UI panel to trigger generation.

### Option B: Worker new output mode

**How:** Add `stream_mode='presenton'` to `deck_service.py`. The LLM prompt changes to emit Presenton `ui` JSON per slide instead of AIPPTSlide.

**Pros:**
- Dynamic layouts — LLM designs each slide
- Closest to what Presenton's own backend does

**Cons:**
- High LLM token cost (Presenton `ui` is verbose — 100+ lines per slide)
- Error-prone — LLM must emit valid positioned JSON with correct element types
- Needs schema validation + retries (Presenton does up to 5 retries)
- Changes the worker (backend risk, needs `docker compose up --build`)

**Effort:** High. New prompt engineering, new schema validation, worker changes, API changes.

### Option C: Two-stage (outline → fill) — Presenton's approach

**How:** Replicate Presenton's exact flow:
1. Outline stage: LLM emits markdown outline (worker already does this via `outline_service.py`)
2. Template selection: user picks from 4 packs (42 layouts)
3. Fill stage: for each outline slide, pick a layout, extract its content schema (slot definitions), call LLM with `SLIDE_CONTENT_SYSTEM_PROMPT` + schema → LLM fills slots → merge content into layout `ui`

Presenton's fill prompt is at `servers/fastapi/utils/llm_calls/generate_slide_content.py` (in the Presenton clone, not in this repo). The schema extraction is at `servers/fastapi/templates/v2/schema.py`.

**Pros:**
- Best output quality (LLM fills real template slots)
- Full variety (42 layouts to choose from)
- This is the production-grade approach

**Cons:**
- Heaviest build — needs schema extraction logic, content-merge logic, 2 LLM calls per deck
- Must port Presenton's `_apply_template_v2_content_to_ui` merge function (Python → TS, or reimplement)
- May need to add a new worker endpoint or do fill-stage client-side

**Effort:** Very high. Multiple days of work. Best left for after the prototype proves viable.

### ⭐ Recommendation

**Start with Option A.** It proves the end-to-end flow (prompt → stream → slides in editor) with minimal risk. Once that works, upgrade to Option C if output variety matters. Option B is a trap — LLM-emitted layouts are unreliable.

---

## 5. Worker output formats (reference)

All from `worker/services/`. The worker publishes to Redis pub/sub channel `ppt:stream:<jobId>`. The API (`api/src/routes/v1/tools.route.ts`) subscribes first, then enqueues, then forwards chunks to the HTTP stream.

### Outline — `POST /api/v1/tools/aippt_outline`
- Request: `{ content: string, language?: string, model?: string }`
- Response: streaming text (raw markdown). NOT framed with `\n`.
- Worker: `outline_service.py` — single LLM call, markdown output with `#`/`##`/`-` structure.

### Deck — `POST /api/v1/tools/aippt`
- Request: `{ content: string, language?: string, style?: string, model?: string }`
- Response: streaming **JSONL**, one AIPPTSlide per line. Each line is a complete `{...}` JSON object. The API appends `\n` per chunk.
- Worker: `deck_service.py` — LLM prompted to emit JSONL. Service buffers partial lines, strips ```` ```jsonl/json ```` fences, republishes each complete line.
- **Client-side line buffering required** — network chunks may split mid-line. Reference: `editor/src/views/Editor/AIPPTDialog.vue:303-329` (PPTist's buffer + split-on-`\n` + `JSON.parse(jsonrepair(text))`).

### Agent — `POST /api/v1/tools/agent`
- Request: `{ message: string, deckSummary?: { slideCount, slides: [{index, title?, elementCount}] } }`
- Response: streaming JSONL, one `{ tool: string, args: object }` per line.
- Worker: `agent_service.py` — single-turn tool-calling. Tools: `set_font`, `set_theme`, `add_slide`, `update_text`, `delete_slide`, `reorder_slide`, `create_deck`.
- If no tool called, emits `{ tool: "_reply", args: { text } }`.

### Auth
All endpoints require `x-session-token` header. The FE session store (`store/session.store.ts`) generates an anonymous random hex token and persists to `localStorage['ppt_session_token']`.

---

## 6. How PPTist consumes the worker (reference for replication)

PPTist's flow (in `editor/src/views/Editor/AIPPTDialog.vue` + `editor/src/hooks/useAIPPT.ts`):

1. User enters prompt → `api.AIPPT_Outline({content, language})` → streams markdown → display in textarea (editable)
2. User clicks Generate → `api.AIPPT({content: outlineMarkdown, language, style})` → streams JSONL
3. Client buffers chunks, splits on `\n`, `JSON.parse(jsonrepair(line))` → `AIPPTSlide`
4. For each slide: `AIPPT(templateSlides, [slide])` maps it onto a random matching template from PPTist's template pack (`getMockData('template_1')`)
5. The `AIPPT()` function (`useAIPPT.ts:244-531`) handles:
   - Splitting over-long content slides (5+ items → 2 slides)
   - Bucketing templates by slide type
   - Matching template elements by `textType` tags
   - Auto-fitting font size via canvas measurement
   - Placing images from an image pool

**PPTist template packs** are at `editor/public/mocks/template_1.json` through `template_8.json`. Each is `{ slides: Slide[], theme: SlideTheme }`. These are PPTist-schema, NOT Presenton-schema — they cannot be used directly by the React editor.

---

## 7. Considerations & gotchas

### State management
- The editor route uses a **scoped Redux Provider** (`store/editorStore.ts` → `makeEditorStore()`). It does NOT interfere with the dashboard's Zustand stores.
- Active slide index is **local `useState`** in `editor-react-client.tsx`, NOT in Redux. This matches Presenton's pattern.
- The Konva editor (`TemplateV2KonvaSlide`) is **write-only to Redux** — it dispatches `updateSlideUi({index, ui})` on every edit but doesn't read from Redux for rendering (it takes `layout` as a prop).

### Konva + Next.js RSC
- `react-konva` is client-only. All editor components must have `'use client'` at the top.
- The main editor canvas uses `dynamic(() => import('...TemplateV2KonvaSlide'), { ssr: false })`.
- There are TWO `<canvas>` elements per Konva Stage (main + hit-canvas for click detection). Don't be confused by this.

### Save behavior
- Save is **debounced 1.5s** after any `presentationData` change in Redux.
- `isFirstSave` ref skips the initial load (so we don't immediately write back what we just fetched).
- Save serializes ALL slides (not just active) as `{ title, slides: presentationData.slides }`.

### Asset resolution
- Template image paths in `template.json` use relative paths like `static/image2-xxx.png` or `/static/icons/placeholder.svg`.
- The asset resolver (`utils/api.ts` → `resolveBackendAssetUrl`) maps:
  - `static/xxx` → `/templates/{ACTIVE_TEMPLATE_PACK}/static/xxx` (currently hardcoded to `"general"`)
  - `/static/xxx` → `/static/xxx` (served from `public/static/`)
- If you add a template picker that changes the active pack, you must update `ACTIVE_TEMPLATE_PACK` or make it dynamic.

### `/api/update-svg` 404 (harmless)
- Presenton's editor colorizes SVG icons via a backend endpoint `/api/update-svg?url=...&color=...`. We don't have this backend. Icons render without color theming. This causes 404s in console but is **not a real error** — ignore it.

### IconsEditor is heavily coupled
- `components/slide-editor/images/IconsEditor.tsx` is the most coupled file to Presenton's backend (uses `useSelector`/`RootState`, `setPresentationData`, `PresentationGenerationApi.searchIcons` stub). If it causes issues, it can be stubbed/skipped — it's not needed for the core editing flow.

### lucide-react version
- The original `package.json` had `lucide-react: "^1.11.0"` which is a nonexistent stable version. Changed to `"^0.469.0"` (the real latest). If icon imports break, check `lucide-react` exports.

### shadcn + Tailwind v4
- FE-codebase uses Tailwind v4 (`@import "tailwindcss"` + `@theme {}` for tokens). Presenton uses Tailwind v3.
- shadcn component classes (bg-primary, text-foreground, border-input, etc.) work because we added the token vars to `globals.css` `@theme {}` block.
- If a shadcn component looks unstyled, check that its CSS classes have corresponding tokens in the `@theme` block.

---

## 8. Suggested next steps (Phase 4 and beyond)

### Phase 4: AI generation (Option A — client adapter)

1. **Create 5 pre-baked Presenton layouts** (one per AIPPT type). These are JSON files derived from `public/templates/general/template.json` layouts — pick suitable ones and strip them down to text-only.
   - Store at `FE-codebase/public/templates/ai-gen/{cover,contents,transition,content,end}.json`
   - Each must have identifiable text elements (by `name` or `description`) so the adapter can find and fill them.

2. **Write `mapAIPPTSlideToUi(slide: AIPPTSlide): RawUi`** in a new file `components/editor-react/ai-gen/map-slide.ts`. Clone the layout for the slide type, fill text slots.

3. **Build the AI panel** — a sidebar/panel with:
   - Prompt input (`<textarea>`)
   - Language selector (en/id)
   - "Generate" button
   - Streaming progress indicator
   - On generate: call `POST /api/v1/tools/aippt_outline` (optional, for outline preview) or directly `POST /api/v1/tools/aippt` for the deck

4. **Stream consumer** — `fetch()` to `/api/v1/tools/aippt`, read `response.body.getReader()`, buffer chunks, split on `\n`, `JSON.parse` each line, map via `mapAIPPTSlideToUi()`, `dispatch(addSlide(...))` as each slide arrives.
   - Reference for line buffering: `editor/src/views/Editor/AIPPTDialog.vue:303-329`
   - Use `jsonrepair` for tolerance (PPTist does): `import jsonrepair from 'jsonrepair'` — add to deps if not present.

5. **Verify:** enter prompt "Machine Learning Basics" → deck streams in → slides appear in sidebar → each renders correctly.

### Phase 5+: Future work
- **PPTX export** — fork `template-v2-json-to-html.ts` (2364 lines) from Presenton, then use pptxgenjs to convert HTML → PPTX. Heavy.
- **Slide reorder** — add `@dnd-kit/core` + `@dnd-kit/sortable` to the sidebar (Presenton's `SidePanel.tsx` is the reference).
- **LaTeX** — add `@tiptap/extension-mathematics` + KaTeX to the TipTap editor config (`TiptapInlineTextEditor.tsx`).
- **Undo/redo** — wire Presenton's internal `undoStackRef`/`redoStackRef` to a toolbar button or Ctrl+Z/Y.
- **Image upload in toolbar** — the Image button currently calls `createImageInsertContent()` which uses a placeholder. Wire a file input → `ImagesApi.uploadImage(file)` → replace the placeholder `data` field.
- **Switch dashboard entry** — in `FE-codebase/components/editor/editor-page.tsx`, change the iframe URL or replace with direct `<EditorReactClient>`.
- **Upgrade AI gen to Option C** (two-stage template fill) if output variety matters.

---

## 9. How to verify the prototype is still working

```bash
# 1. Start infra (postgres + redis + api + worker)
cd /d/Projects/Reacteev/Ransel/ai-ppt-maker
docker compose up -d --build

# 2. Start FE dev server
cd FE-codebase && bun dev

# 3. Create a test session + deck
TOKEN="rnd-test-token-123"
curl -X POST http://localhost:8081/api/v1/session -H "Content-Type: application/json" -d '{"token":"'$TOKEN'"}'
DECK=$(curl -s -X POST http://localhost:8081/api/v1/decks -H "Content-Type: application/json" -H "x-session-token: $TOKEN" -d '{"title":"Test"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")

# 4. Open in browser
# http://localhost:3000/editor-react/$DECK
# (set localStorage 'ppt_session_token' = '$TOKEN' first)

# 5. Typecheck
cd FE-codebase && npx tsc --noEmit
```

**Expected:** Slide renders from `general/template.json` layout[0]. Sidebar shows 1 thumbnail. `+` box adds blank slide. `>` opens layout flyout. Insert toolbar spawns text/shapes/charts. Drag triggers debounced save. Refresh preserves state.

---

## 10. Key file reference (quick lookup)

| Need to... | Look at |
|------------|---------|
| Understand slide schema | `components/slide-editor/types.ts` (454 lines, 65 types) |
| Understand raw model layer | `components/slide-editor/model/model.ts`, `model/core.ts` |
| How editor renders a slide | `components/slide-editor/surface/TemplateV2KonvaSlide.tsx` (2075 lines, props at line 218) |
| Insert new element | `components/slide-editor/insert/insert-elements.ts` + `model/inserted-content.ts:20` (`appendInsertedContent`) |
| Template import/adapter | `components/slide-editor/importing/template-v2-import.ts` |
| TipTap config | `components/slide-editor/text/TiptapInlineTextEditor.tsx` (line 75: `TIPTAP_EXTENSIONS`) |
| Worker deck prompt | `worker/services/deck_service.py` (system prompt lines 22-27) |
| Worker outline prompt | `worker/services/outline_service.py` (lines 16-35) |
| API streaming routes | `api/src/routes/v1/tools.route.ts` |
| PPTist's AIPPT consumer | `editor/src/views/Editor/AIPPTDialog.vue` + `editor/src/hooks/useAIPPT.ts` |
| Presenton's full AI flow (reference clone) | `C:\Users\Arfandi\AppData\Local\Temp\presenton-templates\servers\` |
