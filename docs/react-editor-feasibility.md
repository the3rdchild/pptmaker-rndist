# Feasibility: Can the PPTist (Vue) editor be replaced by a React editor?

**Status:** Feasibility report
**Date:** 2026-07-11
**Scope:** Whether the Vue/PPTist slide editor can be replaced by a React editor of comparable capability, while keeping the Next.js shell + Hono API + Python/DeepInfra worker.
**TL;DR answer:** **Yes, it is possible — but NOT as a drop-in fork of any single existing repo.** The realistic path is a **hybrid build** (estimated 3–6 dev-months for a team). There is exactly one strong foundation to start from (Presenton), with well-defined gaps to fill. Detailed below.

---

## 1. The question, precisely

> *Bisakah editor slide Vue (PPTist) diganti dengan editor React yang sekomplit itu — drag/resize/rotate, rich text, 240 template, ~149 shape, chart/table/line/video/audio/formula, export & import PPTX — dengan shell Next.js + API + worker DeepInfra tetap dipertahankan?*

This is an **editor-layer replacement**, not a full rewrite. The surrounding architecture (dashboard, session, deck registry, AI worker) stays.

---

## 2. Baseline: what PPTist actually provides (verified)

Source: `editor/src/` (197 Vue components, 805-line `types/slides.ts`).

- **Canvas approach:** DOM-based (absolute-positioned divs), **not** HTML5 canvas/Konva/fabric.
- **Element types (9):** `text | image | shape | line | chart | table | latex (formula) | video | audio` — union at `editor/src/types/slides.ts:669`, base at `:134` (`{id, left, top, width, height, rotate, lock?, groupId?, link?}`).
- **Rich text:** ProseMirror (`ProsemirrorEditor.vue`) — full inline formatting, lists, etc.
- **Charts:** echarts.
- **Templates:** ~240 layouts across template packs; ~149 shapes.
- **Export:** pptxgenjs → `.pptx`; also PDF/PNG/JSON.
- **Import:** pptxtojson → `.pptx` to editable slide JSON.
- **License:** **AGPL-3.0** (copyleft — the main commercial blocker, and the main reason a React replacement is being investigated).

---

## 3. Candidate React repos — deep-dive results

All findings below are **verified** by cloning and reading source. Strengths and gaps are stated against the PPTist baseline above.

### 3.1 Presenton — `presenton/presenton` ⭐9004 — **PRIMARY CANDIDATE**

| Aspect | Finding | vs PPTist |
|---|---|---|
| WYSIWYG editor | **Yes, real.** Konva `<Stage>/<Layer>`, `<Transformer>` for resize/rotate, multi-select, group, undo/redo, clipboard. `components/slide-editor/surface/TemplateV2KonvaSlide.tsx`. | Comparable editing UX. |
| Canvas approach | **Konva** (HTML5 canvas) | **Different** from PPTist's DOM. Slide data won't port. |
| Element types | 13: `text, text-list, image, rectangle, ellipse, line, svg, table, chart, infographic, container, flex, grid, group` | **Missing: video, audio, formula/latex.** Shapes minimal (rect/ellipse/line/svg only) vs PPTist's ~149. Has flex/grid auto-layout PPTist lacks. |
| Rich text | **TipTap** (`@tiptap/react` + custom `runStyle` mark), model = `TextRun[]`. | Comparable (TipTap wraps ProseMirror). |
| Charts | chart.js, 12 types. | PPTist uses echarts; library swap. |
| Templates | **4 templates, ~42 layouts** (`templates/{general,modern,standard,swift}/template.json`). | **Huge gap vs 240.** Plus custom templates can be derived from an uploaded PPTX (`POST /api/v2/templates`). |
| Slide schema | Clean JSON: `{id, components:[{id, position:{x,y}, size:{w,h}, elements:[{type, ...}]}]}`. Fixed 1280×720 coord system. | **Good fit** for programmatic injection from the worker (JSONL → one `ui` object per slide). |
| PPTX export | Claimed "fully editable PPTX", but via a **separate closed binary runtime** (`presenton-export`, Linux x64/arm64 prebuilt only; source not public; pinned `presentationExportVersion: v0.3.43`). | **Risk.** pptxgenjs is NOT used. For commercial use, either audit that binary's license or write your own exporter (pptxgenjs) against the `ui` schema. |
| PPTX import | **No full import.** PPTX → screenshots + XML → derives a *new template*, not an editable deck. | **Gap.** No pptxtojson equivalent. |
| AI generation | Backend (FastAPI), multi-LLM (DeepSeek/OpenAI/Gemini/etc.), two-stage: markdown outline → JSON layout (Template V2), SSE-streamed, schema-validated w/ retries. | Our worker (DeepInfra) would need to emit the Presenton `ui` schema instead of the current JSONL. |
| License | **Apache-2.0** (commercially usable; attribution required). | **Solves the AGPL problem.** (Note: export binary licensed separately — verify.) |
| Extractability | Editor in `components/slide-editor/` (28 .tsx + 39 .ts, ~29.7k LOC). **Highly decoupled** — only outside deps are shadcn `ui`, `cn` util, and **one** Redux action (`updateSlideUi`). Auth/DB live in the FastAPI backend; the editor is network-stateless. | **Medium effort** to lift into our Next.js app (shim ~6 imports, not a rewrite). |
| Stack | React 19, Next.js 16, **Redux Toolkit**, Konva 10, TipTap 2.11, chart.js, shadcn/ui, Tailwind, zod. | React 19/Next 16 matches our shell. Redux vs our Zustand is a minor mismatch. |

**Verdict:** The strongest candidate by far. Real editor, clean schema, clean license, extractable. But **not** a drop-in — hard gaps are video/audio/formula elements, the shape library, template breadth, PPTX import, and the closed export binary.

### 3.2 presentation-ai — `allweonedev/presentation-ai` ⭐2889 — COMPLEMENT (reference only)

- **Not a free-form canvas.** Editor model = **layout template + rich text** (`layoutType: left|right|vertical|background|none` + Plate.js content + one optional `rootImage`). No per-element drag/resize/rotate.
- Strengths: mature AI gen, ~38 themes, ~25 chart types, Plate.js rich text, pptxgenjs export (DOM-scanned).
- **License:** MIT. Stack: Next.js 16, React 19, Plate.js, Prisma/Postgres.
- **Role:** reference design for AI-gen flow, themes, and pptxgenjs-from-DOM export. **Not** a PPTist-like editor.

### 3.3 react-design-editor — `salgum1114/react-design-editor` ⭐1702 — COMPLEMENT (canvas engine)

- **Genuine direct-manipulation canvas** (fabric.js 5): drag/resize/rotate/group/align/snap/crop/undo-redo. The closest thing to "PowerPoint-like canvas" in React.
- But: **single-canvas, no slide-deck model**, no PPTX I/O, no tables, weak rich text (fabric `i-text`), no shape-library parity.
- **License:** MIT. Actively maintained (fabric v5 rewrite, 2026-07).
- **Role:** candidate **canvas-engine foundation** if building from scratch on fabric rather than Konva. You'd still build deck/template/PPTX/rich-text layers yourself.

### 3.4 react-pptx — `wyozi/react-pptx` ⭐213 — COMPLEMENT (export only)

- Declarative JSX → `.pptx` renderer (wraps pptxgenjs). **No editor at all.** Stale (last commit 2025-02).
- **Role:** maybe a piece of an export pipeline. Not an editor.

### 3.5 Rejected / out-of-scope
- **Polotno** — React canvas editor, but the **SDK is commercial ($899/mo, closed source)**. Only demos are MIT. Excluded.
- **Slidev (47k★), reveal.js** — markdown/HTML slide frameworks, different paradigm (no WYSIWYG editor). Excluded.

---

## 4. Gap matrix: PPTist vs the best React option (Presenton)

| Capability | PPTist | Presenton | Gap to fill? |
|---|---|---|---|
| Visual drag/resize/rotate | ✅ | ✅ | none |
| Multi-select, group, undo/redo | ✅ | ✅ | none |
| Rich text | ✅ ProseMirror | ✅ TipTap | none (swap) |
| Text / image / table / chart | ✅ | ✅ | none |
| Lines/arrows | ✅ | ✅ | none |
| **Video element** | ✅ | ❌ | **build** |
| **Audio element** | ✅ | ❌ | **build** |
| **Formula (LaTeX)** | ✅ | ❌ | **build** (katex/mathjax) |
| **Shape library (~149)** | ✅ | ❌ (4 primitives + svg) | **build/curate** |
| **Templates (~240)** | ✅ | ~42 | **curate/build packs** |
| PPTX export | ✅ pptxgenjs | ⚠️ closed binary | **build** (pptxgenjs against `ui` schema) |
| **PPTX import** | ✅ pptxtojson | ❌ | **build** |
| Slide schema → worker feed | custom | clean JSON | adapt worker output |
| License | ⚠️ AGPL-3.0 | ✅ Apache-2.0 | solved |

---

## 5. Feasibility verdict & paths

**Is it possible? Yes.** But there is no existing React repo that is a drop-in replacement. Three realistic strategies, in order of recommendation:

### Path A (recommended): Fork Presenton's editor, fill the gaps
- Lift `components/slide-editor/` into our Next.js app (medium effort — shim ~6 imports).
- Build the missing element types (video, audio, formula) and a shape library on Konva.
- Write a pptxgenjs exporter against Presenton's `ui` schema (don't depend on the closed binary).
- Adapt the worker to emit the Presenton `ui` JSON instead of the current JSONL.
- Curate/build template packs to reach an acceptable breadth.
- **Pros:** clean Apache license, real editor, clean schema, least redundant work.
- **Cons:** Konva (canvas) means existing PPTist-authored decks don't migrate; must rebuild template/shape assets; must write exporter + importer.

### Path B: Build on react-design-editor's fabric canvas
- Use its proven drag/resize/rotate/group/snap engine as the foundation.
- Build the slide-deck model, rich text (Plate/ProseMirror), templates, shapes, charts, PPTX I/O yourself.
- **Pros:** fabric canvas engine is the hardest part and it's done; DOM-agnostic.
- **Cons:** most assembly work of the three; fabric ecosystem for slides is thinner than Konva+react-konva.

### Path C: Rewrite from scratch on our own schema
- Full control, align schema with the worker's output, pick any canvas lib.
- **Cons:** highest effort and risk; reinvents what Presenton already solved. **Not recommended** unless there are hard requirements the other paths can't meet.

> **Recommendation to dev team:** **Path A.** Start from Presenton's editor. The gaps (video/audio/formula, shape library, templates, PPTX I/O) are well-scoped build items, not research unknowns. Expect the bulk of effort in **assets** (templates/shapes) and **PPTX I/O**, not in the canvas engine.

---

## 6. Risks & open items for dev

1. **Closed export binary (`presenton-export`)** — source not public. Must either (a) audit its license for commercial use, or (b) commit to writing a pptxgenjs exporter against the `ui` schema. Recommend (b).
2. **No real PPTX import** in any candidate. pptxtojson (PPTist's lib) is JS and could be reused for parsing, but mapping to a React schema is extra work.
3. **Template/shape breadth** (240/~149 → ~42/4) is mostly a **content production** effort, not engineering — but it's large. Decide the minimum viable set before starting.
4. **Schema migration:** existing decks authored in PPTist (DOM, PPTist schema) will **not** port to a Konva/Presenton schema automatically. Plan a cut-over or a one-time converter.
5. **State mgmt mismatch:** Presenton uses Redux Toolkit; our shell uses Zustand. Minor, but the editor's `updateSlideUi` action must be bridged.
6. **Konva vs DOM trade-off:** Konva gives better transform performance but complicates rich-text (TipTap renders in an HTML overlay, not on canvas). Confirm this is acceptable for text-heavy decks.

---

## 7. Sources (all verified by source inspection)

- PPTist baseline: `editor/src/types/slides.ts` (schema, `:134`, `:669`), `editor/src/views/components/element/` (element dirs), `editor/package.json` (deps), `editor/src/hooks/useExport.ts`.
- Presenton: `components/slide-editor/types.ts`, `.../surface/TemplateV2KonvaSlide.tsx`, `.../selection/SelectionTransformers.tsx`, `templates/*/template.json`, `lib/run-bundled-presentation-export.ts`, `store/slices/presentationGeneration.ts`, `servers/nextjs/package.json`, `LICENSE`.
- presentation-ai: `src/components/notebook/presentation/utils/parser.ts`, `.../export/domToPptxConverter.ts`, `.../export/domSlideScanner.ts`, `src/lib/presentation/pptx-theme-extractor.ts`, `package.json`.
- react-design-editor: `src/canvas/handlers/Handler.ts`, `src/canvas/objects/`, `src/editors/imagemap/Descriptors.json`, `package.json`.
- react-pptx: `src/nodes.ts`, `src/renderer.ts`, `src/preview/Preview.tsx`, `package.json`.
- GitHub metadata via API (stars/forks/license/pushed_at) fetched 2026-07-11.

External links: [presenton](https://github.com/presenton/presenton) · [PPTist](https://github.com/pipipi-pikachu/PPTist) · [presentation-ai](https://github.com/allweonedev/presentation-ai) · [react-design-editor](https://github.com/salgum1114/react-design-editor) · [react-pptx](https://github.com/wyozi/react-pptx) · [PptxGenJS](https://github.com/gitbrent/PptxGenJS)
