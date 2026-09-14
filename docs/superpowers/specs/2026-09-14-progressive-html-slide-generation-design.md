# Progressive HTML Slide Generation Design

## Goal

Make HTML-mode deck generation visibly progressive: each completed slide is
available to view and edit in the canvas while the remaining slides continue
generating.

## Current behaviour and root cause

The browser client already consumes NDJSON and appends every `slide` event
immediately. The server pipeline, however, creates all HTML fragments, renders
all pages, validates all pages, and only then emits its slide events. The
client therefore gets no usable slide until the entire deck is ready.

## Architecture

Each outline slide becomes an independent work item:

```text
outline -> fragment + image fill -> render/extract -> quality gate -> slide event
```

A fixed two-worker pool performs the work concurrently. A worker emits only
after its page passes validation or is replaced with the existing safe fallback.
Workers can finish out of order; every event retains its original outline
index, and the client inserts it at that logical position instead of relying on
arrival order. The active canvas follows the page that just became ready.

## Interfaces

The NDJSON route shape remains unchanged:

```ts
type HtmlSlideEvent = {
  type: "slide";
  index: number;
  ui: Record<string, unknown>;
  heading: string;
  summary: string;
};
```

The server exports a pure `mapWithConcurrency(items, limit, mapper)` helper.
It starts at most two jobs, invokes each mapper once, and returns results in
source-index order. The mapper emits its completed slide itself.

The client adds `insertHtmlSlideAt(slides, index, slide)` to insert an arrived
slide into deterministic logical order. It does not create empty placeholders,
so all visible slides are immediately editable.

## Error handling and edge cases

- A single slide failure uses its own safe fallback while other workers continue.
- A failed safe fallback remains fatal, preserving the existing safety contract.
- Out-of-order events are displayed in index order.
- An arrived/edited slide is never overwritten by a later insertion.
- The returned server deck remains in outline order.
- HTML mode marks a received slide done in the existing progress panel.

## Acceptance criteria

1. The first valid slide event is sent before later slide work completes.
2. No more than two slide jobs run simultaneously.
3. The client displays any out-of-order arrivals in outline order.
4. Each emitted slide has passed validation or its own safe fallback.
5. Manual/template generation remains unchanged.

## Verification

- Unit-test bounded concurrency, early emission, and ordered returned results.
- Unit-test indexed insertion using arrival order `2`, `0`, `1`.
- Run affected Node tests, `npx tsc --noEmit`, and `git diff --check`.
- Run a live short HTML generation and confirm `slide` arrives before `done`.
