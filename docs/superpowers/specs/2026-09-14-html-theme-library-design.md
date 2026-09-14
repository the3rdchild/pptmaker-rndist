# HTML Theme Library Design

## Goal

Make HTML generation choose an editable, persistent HTML theme rather than the
hard-coded `paper`/`midnight` palette. A theme describes an AI-facing design
system and a set of role-aware layout recipes; it is not a saved canvas layout.
Users can browse manual templates and HTML themes separately from
`/template-list`, choose the correct kind on `/outline`, edit HTML-theme rules,
and generate a deck whose extracted elements remain editable in the existing
canvas editor.

## Scope and decisions

- HTML themes are global, admin-authored records in object storage, matching
  the existing template-library ownership model.
- Manual templates and HTML themes use separate schemas, indexes, APIs, and
  editors. The list page is the only shared browsing surface.
- The homepage selects the generation engine only. It no longer chooses an HTML
  theme; the selection happens in the relevant sidebar on `/outline`.
- An HTML theme is editable through constrained form controls plus an advanced
  art-direction field. It never exposes raw per-slide canvas editing.
- A theme contains global rules and several layout recipes. Recipe selection is
  deterministic from the outline's slide role and index, rather than left to a
  second model decision.
- The supplied `template-slides-02-06-single.html` is visual source material
  for the initial `Corporate Tech Glass` theme; it is not uploaded or executed
  as an untrusted runtime template.

## User experience

### Home and outline

The homepage retains the existing Template/HTML engine toggle. When HTML is
active it removes the old `Terang`/`Gelap` mini-picker. Existing URLs carrying
`htmlTheme=paper` map to `paper-editorial`, and `htmlTheme=midnight` maps to
`midnight-signal`, before the picker or generation request reads the registry.

`/outline` conditionally renders exactly one picker:

| Generation mode | Heading | Data source | Selection behaviour |
| --- | --- | --- | --- |
| `template` | Select Theme | existing `TemplateTheme` registry | Optional manual-theme pin; no pin retains current auto-choice behaviour. |
| `html` | Select HTML Theme | HTML-theme registry | Selects a required HTML theme; initial value is the registry default. |

The HTML picker uses a compact deterministic thumbnail, theme name, and active
state. Its `More Theme` link opens `/template-list?kind=html`. A stale or
unknown `htmlTheme` URL value is replaced in local state by the current default
and is never sent to generation. If the HTML registry cannot load or contains
no themes, the page shows a recoverable error/link to the library and disables
HTML generation rather than quietly applying a manual template.

On Generate, `/outline` places the selected `htmlTheme=<id>` in the editor URL.
The existing manual `theme=<id>` parameter remains reserved for manual mode.

### Theme library

`/template-list` becomes a URL-backed two-way switch:

- `?kind=manual` (the default for backwards compatibility) lists current
  template-engine theme cards and continues to open `/template-engine`.
- `?kind=html` lists `HtmlTheme` cards and opens
  `/html-theme-engine?theme=<id>`.

Each tab has its own count, empty state, create CTA, rename, and delete action.
The HTML card shows the number of layout recipes and its default badge. The
last HTML theme cannot be deleted. If the current default is deleted while
others exist, the server atomically assigns the first remaining theme as the
new default before returning the updated index.

### HTML theme editor

`/html-theme-engine` is a rules editor, not a Konva/canvas editor. It has:

1. Identity: name and description.
2. Palette: eight named colour tokens with validated hex input.
3. Typography: heading/body fonts selected only from the editor's supported
   Google-font catalogue; compact/balanced/expressive scale.
4. Visual treatment: surface style, radius, border strength, shadow strength,
   grid/no-grid decoration, slide-number treatment, and image treatment.
5. Layout recipes: create, rename, delete, order, and configure each recipe's
   supported roles, composition, regions, decorations, and AI instruction.
6. Art direction: `do`, `don't`, and a bounded free-text instruction for the
   traits that cannot be expressed by a select field.
7. Preview: a deterministic thumbnail updates as tokens/rules change. A
   secondary **Generate AI preview** action, available after save, runs one
   canonical cover through the HTML pipeline and stores a rendered preview PNG;
   failures preserve the last valid preview and show the route error.

Saving validates the whole draft before a storage write. Leaving with unsaved
changes requires the existing app's normal browser warning pattern or an
explicit discard confirmation. The editor never inserts a preview slide into a
real deck.

## Domain model

`HtmlTheme` is a distinct model. Field names below are the implementation
contract; values are intentionally bounded so user input cannot expand the
CSS/prompt surface beyond what the DOM extractor can faithfully map.

```ts
type HtmlSlideRole =
  | "cover"
  | "content"
  | "stat"
  | "comparison"
  | "quote"
  | "section"
  | "visual"
  | "closing";

type HtmlComposition =
  | "centered"
  | "split-left"
  | "split-right"
  | "editorial-right"
  | "two-column"
  | "metric-rail"
  | "visual-focus"
  | "quote-statement"
  | "full-bleed";

interface HtmlThemeRecipe {
  id: string;
  name: string;
  roles: HtmlSlideRole[];
  composition: HtmlComposition;
  description: string;
  regions: Array<{
    kind: "heading" | "body" | "bullets" | "metric" | "image" | "quote" | "label" | "footer";
    placement: "left" | "center" | "right" | "top" | "bottom" | "background";
    emphasis: "primary" | "secondary" | "supporting";
  }>;
  decorations: Array<"accent-rule" | "grid" | "pill" | "slide-number" | "section-index" | "icon-box">;
  instructions: string;
}

interface HtmlTheme {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  previewUrl: string | null;
  colors: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    muted: string;
    border: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    scale: "compact" | "balanced" | "expressive";
  };
  effects: {
    surface: "flat" | "translucent" | "gradient";
    radius: "none" | "soft" | "round";
    shadow: "none" | "subtle" | "elevated";
    imageTreatment: "natural" | "monochrome" | "duotone";
    grid: "none" | "subtle" | "technical";
    slideNumber: "none" | "minimal" | "rule";
  };
  guidance: {
    artDirection: string;
    dos: string[];
    donts: string[];
  };
  recipes: HtmlThemeRecipe[];
  updatedAt: string;
}

interface HtmlThemeIndex {
  schemaVersion: 1;
  defaultThemeId: string;
  themes: string[];
}
```

IDs use the existing safe lower-case slug rule. HTML colour values accept only
six-digit hexadecimal values. Font values must be members of
`GOOGLE_FONT_OPTIONS`. Text instructions are trimmed, escaped for prompt
assembly, length-capped, and never rendered via `dangerouslySetInnerHTML`.
Every theme needs at least one recipe, and each recipe needs at least one role.

## Storage, server interfaces, and prompt contract

The new S3 namespace is independent of `templates/`:

```text
html-themes/index.json
html-themes/<theme-id>/theme.json
html-themes/<theme-id>/preview.png
```

The client reads metadata through a dedicated `lib/html-themes` loader. Node
route handlers and the HTML generation pipeline read the authoritative theme
through a server-only store. Cached client results are invalidated after any
create/update/delete/seed action.

Routes:

| Route | Method | Responsibility |
| --- | --- | --- |
| `/api/html-themes` | GET | List summaries plus `defaultThemeId`. |
| `/api/html-themes` | POST | Create a validated theme. |
| `/api/html-themes/[themeId]` | GET | Read one complete editable theme. |
| `/api/html-themes/[themeId]` | PATCH | Validate and atomically update a theme. |
| `/api/html-themes/[themeId]` | DELETE | Delete a non-final theme and repair the default index if necessary. |
| `/api/html-themes/[themeId]/preview` | POST | Render/persist a canonical one-slide preview from the saved theme. |
| `/api/html-themes/seed` | POST | Idempotently create missing starter themes; never overwrite an author edit. |

All writing routes use the same development/explicit-production write guard as
the template engine. Read routes and deck generation remain available in
production.

The generation API accepts only a theme ID. It validates the ID, loads the
stored theme, compiles theme tokens and a selected recipe into the existing
per-slide prompt, then renders/extracts as today. The old hard-coded `THEMES`
object is removed from runtime resolution.

Recipe resolution is deterministic:

1. Select recipes whose `roles` contain the outline role.
2. If none match, select `content` recipes.
3. If still none match, use the theme's first recipe.
4. Cycle candidates by slide index so two compatible content slides vary.

The compiler states the global tokens, effects, selected recipe's region
contract and instructions, and existing DOM-safe restrictions. It continues to
prohibit unextractable effects such as blur/filter/mask/pseudo-elements and
requires real elements for grids, accent lines, decorations, and background
images. The `duotone` image treatment is expressed with extractable overlay
layers, never a CSS filter. There is no raw CSS or raw HTML field in the
persisted theme.

## Starter HTML themes

An idempotent seed route creates four editable themes:

1. `corporate-tech-glass` — the supplied reference: deep navy, cyan accent,
   technical grid, translucent panels, rule-style slide numbers; recipes for
   section divider, content/KPI rail, visual focus, quote statement, and
   two-column comparison.
2. `paper-editorial` — migration of the current Paper appearance: warm paper,
   deep green/copper, expressive serif heading, editorial split layouts.
3. `midnight-signal` — migration of the current Midnight appearance: dark
   blue, high-contrast violet/gold accents, dense information hierarchy.
4. `warm-studio` — a light, rounded, image-led strategy style with restrained
   coral and ink contrast, varied cover/content/stat recipes.

`corporate-tech-glass` becomes the default HTML theme. The supplied document's
embedded background image is not copied into a generated deck. Its visual
character is expressed with extractable token-driven layers and photo/image
slots, preserving the editor and PPTX-export fallback.

## Error handling and edge cases

- Unknown or deleted IDs in a URL/API request return a clear 404 for management
  routes and resolve to the registry default only at picker UI level; generation
  rejects an invalid explicit ID rather than silently generating a different
  visual result.
- Empty/missing HTML index is surfaced as an unavailable HTML library. The seed
  action repairs the initial state without overwriting existing themes.
- A preview generation failure, LLM timeout, or Chrome failure changes neither
  the saved theme nor the previous preview image.
- Concurrent author updates use `updatedAt` as an optimistic concurrency value;
  a stale PATCH receives `409` and the editor asks the author to reload instead
  of overwriting newer rules.
- Delete is blocked for the last remaining HTML theme. Deleting a default with
  alternatives chooses a replacement in the same server operation.
- Malformed storage JSON, invalid colours, unsupported fonts, duplicate recipe
  IDs, or an empty recipe list are rejected at the route boundary and skipped
  in non-authoring summaries with an actionable error.
- A theme may change after an outline is opened. Generation uses the version
  read at request start; a single deck never mixes revisions between slides.
- Existing manual template flow, legacy links without `mode`, and non-HTML
  editor generation must be byte-for-byte behaviourally unchanged.

## Acceptance criteria

1. Template mode shows only manual themes in the outline sidebar and preserves
   existing pin/auto-choice behaviour.
2. HTML mode shows only HTML themes, initially selects the registry default,
   and carries that exact ID into the editor/generation request.
3. `/template-list` visibly switches between manual and HTML libraries without
   cross-loading or cross-editing the two theme types.
4. HTML-theme CRUD persists to S3, validates input, protects the final theme,
   and invalidates stale client caches.
5. The HTML editor changes tokens, effects, art direction, and layout recipes
   without exposing canvas element editing.
6. The four starter themes are present after the idempotent seed action; the
   Corporate Tech Glass theme expresses all five supplied-reference recipes.
7. The selected theme's compiled global/recipe contract is present in the
   slide-generation prompt, and a different selected theme produces a different
   resolved token set.
8. HTML deck generation still streams slide UI records into the existing editor;
   resulting elements remain selectable, draggable, text-editable, and
   exportable through the current workflow.
9. Invalid/stale IDs, failed preview generation, and empty registry states
   produce explicit recovery UI and never fall back to an unrelated manual
   template.

## Verification strategy

- Unit-test schema validation, summary parsing, theme/recipe resolution, and
  prompt compilation as pure functions.
- Unit-test S3-store index/default repair with mocked storage functions.
- Test route validation for create, stale update conflict, delete-last refusal,
  and invalid generation IDs.
- Add DOM/prompt regression coverage that proves a selected recipe is injected
  while the current HTML output contract remains intact.
- Run `npx tsc --noEmit` and `npm run build` in `FE-codebase`; run existing
  `node --test lib/html-slides/dom-extract.test.js` to protect extraction.
- Manually smoke-test both library tabs, create/edit/save one HTML theme,
  select Corporate Tech Glass in HTML outline mode, generate a short deck,
  edit an extracted text/shape in canvas, and export PPTX.
