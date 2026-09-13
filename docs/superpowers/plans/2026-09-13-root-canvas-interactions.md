# Root Canvas Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HTML-extracted root elements edit exactly like ordinary Konva canvas elements while preserving intentional overflow outside the 1280×720 stage.

**Architecture:** HTML remains a generation-only layout intermediate; the editor continues to receive and persist only `ui.elements` JSON. Root-element transforms will use a pure geometry helper plus the same React live-preview pattern already used by components, while root drag/resize positions bypass stage clamping.

**Tech Stack:** TypeScript, React 19, Konva/react-konva, Node test runner for extraction regression tests, TypeScript compiler and Next production build for integration checks.

**Spec:** Approved in chat on 2026-09-13: do not crop overflow; allow elements outside the canvas; remove live text stretching during resize; preserve generated test decks.

## Global Constraints

- Do not crop, clamp, delete, or normalize intentionally overflowing generated elements.
- Keep nested component elements constrained to their parent; only root elements get unbounded stage coordinates.
- During side-handle text resize, change element bounds and reflow text without scaling glyph metrics.
- During corner resize, scale bounds and text metrics consistently.
- Do not persist HTML in the editor deck payload.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Pure root-element transform geometry

**Files:**
- Modify: `FE-codebase/components/slide-editor/model/model.ts`
- Create: `FE-codebase/components/slide-editor/model/root-element-transform.test.ts`

**Interfaces:**
- Consumes: `RawElement`, `Box`, `scaleRawElementTextMetrics`, and unclamped node-to-parent position conversion.
- Produces: `resizeRootElement(element, nextBox, mode)` with bounds-only and proportional-scale modes.

- [ ] **Step 1: Write failing geometry tests**

Cover negative `x/y`, right/bottom overflow, horizontal text resize with unchanged font size, and proportional corner resize with scaled font size.

- [ ] **Step 2: Run the focused test and verify failure**

Run the project-supported TypeScript test command if present; otherwise run TypeScript compilation and retain the helper assertions in the nearest supported test harness.

- [ ] **Step 3: Implement minimal pure transform helper**

Use unclamped position conversion for root elements. Bounds-only mode updates position/size/rotation but leaves text metrics unchanged; proportional mode additionally applies `scaleRawElementTextMetrics`.

- [ ] **Step 4: Run focused verification**

Confirm all four geometry cases pass and nested-element helpers remain unchanged.

### Task 2: Live root-element resize preview

**Files:**
- Modify: `FE-codebase/components/slide-editor/surface/nodes.tsx`
- Modify: `FE-codebase/components/slide-editor/selection/SelectionTransformers.tsx`

**Interfaces:**
- Consumes: Task 1 root transform helper and active Transformer anchor.
- Produces: live `transformPreview` state for `RawElementNode`, committed once on transform end.

- [ ] **Step 1: Add a failing behavior assertion or reproducible transform harness**

Assert that a middle-left/right transform produces a resized model with node scale reset to `1`, and that corner transforms select proportional scaling.

- [ ] **Step 2: Verify the old implementation fails**

Confirm the old handler leaves non-unit node scale throughout pointer movement and only normalizes on transform end.

- [ ] **Step 3: Implement live preview**

Mirror `RawComponentNode`: keep preview state/ref, resolve the active anchor, convert node transform into a new root element during `onTransform`, reset node scale immediately, render the preview, and commit the final preview on `onTransformEnd`.

- [ ] **Step 4: Keep drag positions unbounded**

Replace root drag persistence with unclamped node-to-parent position conversion. Do not alter component or nested child clamping.

- [ ] **Step 5: Run TypeScript and focused checks**

Run `npx tsc --noEmit` from `FE-codebase` and the focused geometry test/harness.

### Task 3: Extraction and end-to-end regression verification

**Files:**
- Modify only if necessary: `FE-codebase/lib/html-slides/dom-extract.test.js`
- Preserve: generated deck rows in PostgreSQL and any generated screenshot/output files.

**Interfaces:**
- Consumes: existing HTML-to-`ui.elements` extraction pipeline.
- Produces: evidence that overflow survives extraction and the editor payload contains canvas JSON rather than live HTML.

- [ ] **Step 1: Add an overflow-preservation extraction test**

Create a fixture with an element extending beyond `1280×720`; assert extracted coordinates and size remain unchanged and no clipping mutation is applied.

- [ ] **Step 2: Run extraction tests**

Run `node --test lib/html-slides/dom-extract.test.js` from `FE-codebase` and confirm the existing text-merge test plus overflow test pass.

- [ ] **Step 3: Run full static/build verification**

Run TypeScript checking and the Next production build. Record any pre-existing failures separately from new failures.

- [ ] **Step 4: Generate or inspect a fresh deck through the local API**

Call the configured local generation flow, wait for completion, inspect element bounds and payload keys, and leave the resulting deck/database row intact for user review.

- [ ] **Step 5: Report the retained result**

Return the deck ID/editor URL, verification commands, and any remaining visual caveats.
