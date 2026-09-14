# Progressive HTML Slide Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream validated HTML slide UI records to the editor as each page finishes instead of after the full deck completes.

**Architecture:** A two-worker server-side pool owns per-slide fragment generation, rendering, quality repair/fallback, and emission. The client inserts the event into its original outline position so concurrent completion cannot reorder the editable deck.

**Tech Stack:** Next.js Node runtime, JavaScript ESM/Node test runner, React/Redux, existing Chrome DOM extractor.

**Spec:** `docs/superpowers/specs/2026-09-14-progressive-html-slide-generation-design.md`

## Global Constraints

- Preserve the NDJSON event contract and manual/template generation.
- Emit only a layout-validated slide or the existing safe fallback.
- Limit concurrent HTML slide work to two jobs.
- Never overwrite a slide that has already been received and edited.
- Commit and push this independently verified work after implementation.

---

### Task 1: Progressive server emission

**Files:**

- Modify: `FE-codebase/lib/html-slides/deck-pipeline.js`
- Create: `FE-codebase/lib/html-slides/deck-pipeline.test.js`

**Interfaces:**

- Produces `mapWithConcurrency(items, limit, mapper)` and makes `generateDeck()` emit a slide event from each completed work item.

- [ ] Write a failing Node test with three deferred async jobs. Assert `maxActive === 2`, that the first mapper completion happens before all jobs resolve, and that the helper returns results in original-index order.
- [ ] Run `node --test lib/html-slides/deck-pipeline.test.js`; confirm it fails because `mapWithConcurrency` does not exist.
- [ ] Implement the minimal two-worker mapper, then move one-slide fragment generation, rendering/extraction, validation/repair/fallback, warning output, and slide event emission into the mapper callback.
- [ ] Keep the final returned `slides` array in outline order.
- [ ] Re-run the new test and existing HTML slide tests.

### Task 2: Ordered client insertion

**Files:**

- Create: `FE-codebase/components/editor-react/html-slide-insertion.ts`
- Create: `FE-codebase/components/editor-react/html-slide-insertion.test.js`
- Modify: `FE-codebase/components/editor-react-client.tsx`

**Interfaces:**

- Produces `insertHtmlSlideAt<T>(slides, index, slide)`.

- [ ] Write a failing test that receives logical indices `2`, `0`, then `1` and asserts final visible order `[0, 1, 2]`; assert duplicate delivery does not overwrite the original.
- [ ] Run the test and confirm it fails because the helper is absent.
- [ ] Implement the immutable helper and use it for HTML slide events; retain arrival order state so index `2` is not interpreted as three missing physical slides.
- [ ] Mark an HTML slide done when it arrives, focus its physical position, and update the status label.
- [ ] Run the helper test and TypeScript type check.

### Task 3: Verify, commit, and push

- [ ] Run:

```powershell
node --test lib/html-slides/deck-pipeline.test.js lib/html-slides/layout-quality.test.js lib/html-slides/safe-fallback.test.js lib/html-slides/photo-fill.test.js components/editor-react/html-slide-insertion.test.js
npx tsc --noEmit
git diff --check
```

- [ ] Use a live short HTML generation to confirm a `slide` NDJSON event arrives before `done`.
- [ ] Commit only the five feature files plus this spec/plan, then push `origin main`.
