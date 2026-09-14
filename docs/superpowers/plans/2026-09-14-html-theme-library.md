# HTML Theme Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded HTML light/dark choices with a persistent, editable HTML-theme library whose role-aware recipes control HTML generation and whose output stays editable in the canvas.

**Architecture:** Add an isolated `html-themes/` S3 domain, with pure JavaScript schema/prompt helpers shared by Node tests and the existing HTML generator, plus TypeScript client/server adapters. Keep manual templates untouched; `/template-list` and `/outline` select their appropriate domain from the generation mode. The generator resolves one stored `HtmlTheme` once per deck and deterministically maps every outline role to a recipe before the existing Chrome extraction path runs.

**Tech Stack:** Next.js 16/React 19, TypeScript, JavaScript ESM/Node test runner, S3-compatible object storage, existing raw-CDP Chrome renderer, Tailwind CSS, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-14-html-theme-library-design.md`

## Global Constraints

- Manual `TemplateTheme`, `/template-engine`, and `?theme=` behaviour stay unchanged.
- HTML-theme storage uses only `html-themes/`, never `templates/`.
- HTML generation receives only `htmlTheme=<id>`; the server loads and validates the saved configuration.
- Theme fields permit no raw HTML/CSS; colours are six-digit hex and fonts come from `GOOGLE_FONT_OPTIONS`.
- Recipe selection is exact-role → `content` → first-recipe, cycling matching recipes by slide index.
- Generated HTML keeps the current extraction-safe contract: no CSS filter, blur, mask, pseudo-elements, or unrepresented effects.
- All authoring writes retain the existing development/explicit-production write guard.

---

## File structure

| File | Responsibility |
| --- | --- |
| `FE-codebase/lib/html-themes/schema.js` | Runtime validation, normalization, summaries, legacy ID mapping, recipe resolution, and pure index transforms. |
| `FE-codebase/lib/html-themes/schema.test.js` | Node regression tests for the pure domain contract. |
| `FE-codebase/lib/html-themes/seeds.js` | Four source-controlled starter theme records, including Corporate Tech Glass recipes. |
| `FE-codebase/lib/html-themes/client.ts` | Browser fetch/cache API for list/read/invalidate operations. |
| `FE-codebase/lib/html-themes/server/store.ts` | S3 read/write/index/seed/preview persistence implementation. |
| `FE-codebase/lib/html-themes/server/guard.ts` | Reusable guarded-write response for HTML-theme authoring routes. |
| `FE-codebase/app/api/html-themes/**/route.ts` | CRUD, seed, and preview route handlers. |
| `FE-codebase/lib/html-slides/design-system.js` | Token CSS/font helpers accepting a validated stored HTML theme. |
| `FE-codebase/lib/html-slides/theme-prompt.js` | Pure compiler turning theme + selected recipe into slide prompt contract. |
| `FE-codebase/lib/html-slides/theme-prompt.test.js` | Node tests for compiler and recipe selection. |
| `FE-codebase/lib/html-slides/deck-pipeline.js` | Resolve one stored theme once, select recipe per slide, and feed the compiler. |
| `FE-codebase/app/api/html-slides/generate/route.ts` | Reject invalid requested HTML theme IDs and pass the resolved ID. |
| `FE-codebase/lib/generation-mode.ts` | Legacy mapping and non-hard-coded HTML-theme query parsing. |
| `FE-codebase/components/html-theme/**` | Deterministic thumbnail, picker, recipe form, and rules editor UI. |
| `FE-codebase/app/html-theme-engine/**` | Route/layout for the HTML-theme editor. |
| `FE-codebase/components/template-list/template-list-page.tsx` | URL-backed Manual/HTML library switch. |
| `FE-codebase/components/outline/outline-page.tsx` | Mode-specific theme picker and selected HTML ID handoff. |
| `FE-codebase/components/dashboard/prompt-input.tsx` | Remove the obsolete HTML light/dark picker. |

## Task 1: Define and test the HTML-theme domain contract

**Files:**
- Create: `FE-codebase/lib/html-themes/schema.js`
- Create: `FE-codebase/lib/html-themes/schema.test.js`
- Create: `FE-codebase/lib/html-themes/seeds.js`
- Modify: `FE-codebase/lib/generation-mode.ts`

**Interfaces:**
- Produces `parseHtmlTheme(value)`, `htmlThemeSummary(theme)`, `resolveHtmlThemeId(value)`, `selectRecipe(theme, role, slideIndex)`, `deleteFromHtmlThemeIndex(index, id)`, `STARTER_HTML_THEMES`, and `DEFAULT_HTML_THEME_ID`.
- Consumes only ordinary JSON; later store/routes call `parseHtmlTheme` at every boundary.

- [ ] **Step 1: Write the failing domain tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_HTML_THEMES } from "./seeds.js";
import { parseHtmlTheme, resolveHtmlThemeId, selectRecipe } from "./schema.js";

test("maps legacy paper and midnight IDs to persistent starter IDs", () => {
  assert.equal(resolveHtmlThemeId("paper"), "paper-editorial");
  assert.equal(resolveHtmlThemeId("midnight"), "midnight-signal");
});

test("cycles matching role recipes by slide index", () => {
  const theme = parseHtmlTheme(STARTER_HTML_THEMES[0]);
  const matches = theme.recipes.filter((recipe) => recipe.roles.includes("content"));
  assert.equal(selectRecipe(theme, "content", 0).id, matches[0].id);
  assert.equal(selectRecipe(theme, "content", 1).id, matches[1 % matches.length].id);
});

test("rejects unsupported fonts and raw CSS-shaped values", () => {
  const invalid = structuredClone(STARTER_HTML_THEMES[0]);
  invalid.typography.headingFont = "<style>bad</style>";
  assert.throws(() => parseHtmlTheme(invalid), /headingFont/);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run from `FE-codebase`:

```powershell
node --test lib/html-themes/schema.test.js
```

Expected: FAIL because the schema/seeds modules do not exist.

- [ ] **Step 3: Implement the minimal pure model**

Create JavaScript ESM modules with immutable allowed-role/composition/effect
sets; require all eight `#RRGGBB` colours, valid recipe IDs, non-empty roles,
bounded string lists, and supported font names. Keep `resolveHtmlThemeId` as
the single legacy mapping seam. Seed `corporate-tech-glass`, `paper-editorial`,
`midnight-signal`, and `warm-studio`; Corporate Tech Glass has the five named
reference recipes and at least two `content`-compatible recipes.

- [ ] **Step 4: Run domain tests to verify GREEN**

Run:

```powershell
node --test lib/html-themes/schema.test.js
```

Expected: PASS, including legacy mapping, fallback/cycling, and invalid input.

- [ ] **Step 5: Generalize query parsing without weakening URL safety**

Replace the `HtmlThemeId` union in `generation-mode.ts` with an opaque string
returned through `resolveHtmlThemeId`; retain `htmlThemeFromParams` and
`storeHtmlTheme` APIs so caller changes remain small. Add a `defaultHtmlThemeId`
fallback only for URL parsing; the registry becomes authoritative in UI/server.

- [ ] **Step 6: Run type verification and commit**

Run:

```powershell
npx tsc --noEmit
git add lib/html-themes lib/generation-mode.ts
git commit -m "feat(html-themes): define validated theme recipes"
```

Expected: TypeScript exits 0 and the commit contains only the domain files.

## Task 2: Persist the registry and expose guarded CRUD/seed routes

**Files:**
- Create: `FE-codebase/lib/html-themes/server/store.ts`
- Create: `FE-codebase/lib/html-themes/server/guard.ts`
- Create: `FE-codebase/lib/html-themes/client.ts`
- Create: `FE-codebase/app/api/html-themes/route.ts`
- Create: `FE-codebase/app/api/html-themes/[themeId]/route.ts`
- Create: `FE-codebase/app/api/html-themes/seed/route.ts`
- Create: `FE-codebase/app/api/html-themes/[themeId]/preview/route.ts`
- Modify: `FE-codebase/lib/storage/s3.ts` only if a missing typed primitive is required

**Interfaces:**
- Consumes `HtmlTheme` JSON validated by Task 1 and S3 helpers from `storage/s3.ts`.
- Produces `listHtmlThemeSummaries()`, `readHtmlTheme(id)`, `createHtmlTheme(theme)`, `updateHtmlTheme(id, draft, expectedUpdatedAt)`, `deleteHtmlTheme(id)`, `seedHtmlThemes()`, and browser `loadHtmlThemeSummaries()`/`loadHtmlTheme(id)`.

- [ ] **Step 1: Write pure index/update tests before the S3 adapter**

Extend `schema.test.js`:

```js
import { deleteFromHtmlThemeIndex } from "./schema.js";

test("deleting the default chooses a remaining theme and refuses the final record", () => {
  assert.deepEqual(
    deleteFromHtmlThemeIndex({ schemaVersion: 1, defaultThemeId: "a", themes: ["a", "b"] }, "a"),
    { schemaVersion: 1, defaultThemeId: "b", themes: ["b"] },
  );
  assert.throws(
    () => deleteFromHtmlThemeIndex({ schemaVersion: 1, defaultThemeId: "a", themes: ["a"] }, "a"),
    /last remaining/i,
  );
});
```

- [ ] **Step 2: Run RED**

```powershell
node --test lib/html-themes/schema.test.js
```

Expected: FAIL because `deleteFromHtmlThemeIndex` does not yet exist.

- [ ] **Step 3: Implement the S3 store and client cache**

Use exactly `html-themes/index.json` and `html-themes/<id>/theme.json`.
Summaries include id/name/description/previewUrl/recipeCount/default flag but
never send full rules to card lists. Store writes validate before writing,
assign ISO `updatedAt`, compare `expectedUpdatedAt` before PATCH, and return
`409` on mismatch. Seed only writes a starter whose ID is absent. Preview route
may persist `preview.png` only after the saved-theme preview render succeeds.

- [ ] **Step 4: Implement routes and explicit failures**

GET list returns `{ themes, defaultThemeId }`; invalid POST/PATCH returns 400;
unknown read/update/delete returns 404; stale PATCH returns 409; deleting the
last record returns 400. Apply the production write guard to POST/PATCH/DELETE/
seed/preview only. The preview handler must leave prior `previewUrl` untouched
on LLM/Chrome failure.

- [ ] **Step 5: Verify storage-free tests and compile**

```powershell
node --test lib/html-themes/schema.test.js
npx tsc --noEmit
```

Expected: PASS and exit 0. Manually call `POST /api/html-themes/seed` against a
configured development server and confirm a second call returns the same four
IDs without overwriting their timestamps.

- [ ] **Step 6: Commit**

```powershell
git add lib/html-themes app/api/html-themes
git commit -m "feat(html-themes): add persistent registry and CRUD"
```

## Task 3: Compile themes and recipes into the HTML slide pipeline

**Files:**
- Create: `FE-codebase/lib/html-slides/theme-prompt.js`
- Create: `FE-codebase/lib/html-slides/theme-prompt.test.js`
- Modify: `FE-codebase/lib/html-slides/design-system.js`
- Modify: `FE-codebase/lib/html-slides/slide-prompt.js`
- Modify: `FE-codebase/lib/html-slides/deck-pipeline.js`
- Modify: `FE-codebase/app/api/html-slides/generate/route.ts`
- Modify: `FE-codebase/lib/html-slides/generate.js`

**Interfaces:**
- Consumes `HtmlTheme` + `HtmlThemeRecipe` and a slide role/index.
- Produces `compileThemePrompt(theme, recipe)`, `themeById(id)` as an async
  server resolver, and `selectRecipe`-driven per-slide prompt input.

- [ ] **Step 1: Write the failing prompt-contract tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_HTML_THEMES } from "../html-themes/seeds.js";
import { parseHtmlTheme } from "../html-themes/schema.js";
import { compileThemePrompt } from "./theme-prompt.js";

test("Corporate Tech Glass compiles its KPI recipe into explicit AI rules", () => {
  const theme = parseHtmlTheme(STARTER_HTML_THEMES[0]);
  const recipe = theme.recipes.find((entry) => entry.id === "content-kpi-rail");
  const prompt = compileThemePrompt(theme, recipe);
  assert.match(prompt, /#031024/i);
  assert.match(prompt, /Content \+ KPI/i);
  assert.match(prompt, /metric/i);
  assert.doesNotMatch(prompt, /backdrop-filter|mask-image|::before/i);
});
```

- [ ] **Step 2: Run RED**

```powershell
node --test lib/html-slides/theme-prompt.test.js
```

Expected: FAIL because the compiler module is absent.

- [ ] **Step 3: Implement token and recipe compiler**

Make `tokenCss`, `tokensForPrompt`, and `googleFontLink` consume the stored
theme shape. `compileThemePrompt` describes palette, typography scale, safe
surface/image rules, regions, and decorations in natural language. Translate
duotone to explicit overlay-layer wording; do not emit an unsupported filter.
Refactor `buildSlidePrompt` to append this contract and require real elements
for every decoration.

- [ ] **Step 4: Resolve a theme once per deck**

In `generateDeck`, asynchronously load and validate the selected persisted
theme before any model call. For each outline slide, call `selectRecipe(theme,
slide.role, index)` and pass it to `buildSlidePrompt`. Return the saved theme
name and recipe IDs in status/debug data only; never stream private authoring
rules to the client. The route returns 400 for an explicit invalid ID rather
than defaulting it. The CLI keeps `--theme <id>`.

- [ ] **Step 5: Run GREEN and regression checks**

```powershell
node --test lib/html-slides/theme-prompt.test.js lib/html-slides/dom-extract.test.js
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```powershell
git add lib/html-slides app/api/html-slides
git commit -m "feat(html-slides): generate from persisted theme recipes"
```

## Task 4: Build reusable HTML-theme browse and rule-editor UI

**Files:**
- Create: `FE-codebase/components/html-theme/html-theme-thumbnail.tsx`
- Create: `FE-codebase/components/html-theme/html-theme-card.tsx`
- Create: `FE-codebase/components/html-theme/html-theme-form.tsx`
- Create: `FE-codebase/components/html-theme/html-theme-engine-page.tsx`
- Create: `FE-codebase/app/html-theme-engine/page.tsx`
- Create: `FE-codebase/app/html-theme-engine/layout.tsx`
- Modify: `FE-codebase/components/template-list/template-list-page.tsx`

**Interfaces:**
- Consumes `HtmlThemeSummary` and full `HtmlTheme` from the Task 2 client.
- Produces `HtmlThemeThumbnail`, `HtmlThemeCard`, and an editor save payload
`{ theme, expectedUpdatedAt }` accepted by PATCH.

- [ ] **Step 1: Add a failing type-level/editor-form test seam**

Create `html-theme-form.test.js` around a pure exported
`validateThemeDraft(theme)` wrapper (delegating to Task 1 schema), asserting a
blank recipe name cannot be saved and a valid Corporate Tech draft can. Run it
with `node --test` and confirm RED before the component uses the wrapper.

- [ ] **Step 2: Implement deterministic thumbnails and cards**

Render a CSS-only 16:9 preview from the active palette/effect/first recipe;
when `previewUrl` exists, prefer its generated image. Do not mount Konva or
call AI from library cards. Include recipe count/default badge and rename/delete
controls matching manual card affordances.

- [ ] **Step 3: Implement the rules form**

Build grouped controlled controls for every schema field. Fonts are select
controls built from `GOOGLE_FONT_OPTIONS`, colours validate on blur, list
controls add/remove bounded `dos`/`donts`, and recipe controls edit roles,
composition, regions, decorations, and instructions. Disable Save until the
draft validates. Give unsaved changes a visible state and confirm discard on
navigate/back.

- [ ] **Step 4: Implement create/load/save/preview editor flow**

Existing IDs load via GET; a new route starts from a cloned starter-safe blank
theme with one cover/content recipe. Save POSTs creation then PATCHes later
edits with `expectedUpdatedAt`. Handle 409 by retaining the draft and showing
reload guidance. Generate AI preview only after a successful save; refresh the
theme/card cache when its PNG changes.

- [ ] **Step 5: Convert `/template-list` to a URL-backed two-tab library**

Read `kind=manual|html`, retain manual as default, and load only the active
registry. Manual tab preserves the existing cards and `Theme baru` link; HTML
tab changes copy/CTA to `HTML theme baru` and opens the new editor. Empty HTML
tab offers the guarded idempotent starter-seed action.

- [ ] **Step 6: Run UI compile/build and commit**

```powershell
node --test components/html-theme/html-theme-form.test.js
npx tsc --noEmit
npm run build
git add components/html-theme app/html-theme-engine components/template-list
git commit -m "feat(html-themes): add library and rules editor"
```

Expected: test pass, typecheck/build exit 0.

## Task 5: Connect the picker to the mode-specific generation flow

**Files:**
- Create: `FE-codebase/components/html-theme/html-theme-picker.tsx`
- Modify: `FE-codebase/components/outline/outline-page.tsx`
- Modify: `FE-codebase/components/dashboard/prompt-input.tsx`
- Modify: `FE-codebase/components/editor-react-client.tsx` only for typed ID handoff if required

**Interfaces:**
- Consumes `modeFromParams`, `HtmlThemeSummary[]`, and registry
`defaultThemeId`.
- Produces a valid selected `htmlTheme` ID passed to `generateDeckFromHtml`.

- [ ] **Step 1: Write the failing picker state tests**

Export pure `resolveOutlineHtmlTheme(requestedId, registry)` from the picker
module and test:

```js
assert.equal(resolveOutlineHtmlTheme("removed", { defaultThemeId: "corporate-tech-glass", themes: [] }), null);
assert.equal(resolveOutlineHtmlTheme("removed", registry), "corporate-tech-glass");
assert.equal(resolveOutlineHtmlTheme("warm-studio", registry), "warm-studio");
```

Run `node --test components/html-theme/html-theme-picker.test.js`; expect RED.

- [ ] **Step 2: Implement HTML picker and test GREEN**

Render only HTML cards in HTML mode, set the registry default after load, show
an explicit unavailable state when no registry value exists, and link to
`/template-list?kind=html`. Keep this pure helper independently tested.

- [ ] **Step 3: Branch the outline sidebar cleanly**

Do not call `useTemplateThemes` for HTML mode. Manual mode retains current
theme IDs/thumbnails/text. HTML mode replaces the heading, more-themes link,
cards, helper copy, and Generate disabled state. `handleGenerate` must set the
local selected HTML ID into `HTML_THEME_PARAM`, not forward a stale homepage
parameter.

- [ ] **Step 4: Remove the homepage's obsolete theme choice**

Delete `HTML_THEMES`, `loadStoredHtmlTheme`, and `storeHtmlTheme` controls from
the dashboard while retaining the engine toggle and `mode=html` URL parameter.
Preserve old stored values only through Task 1's legacy query mapping.

- [ ] **Step 5: Verify mode behaviour and commit**

```powershell
node --test components/html-theme/html-theme-picker.test.js
npx tsc --noEmit
npm run build
git add components/html-theme components/outline components/dashboard components/editor-react-client.tsx lib/generation-mode.ts
git commit -m "feat(outline): select HTML themes by generation mode"
```

Manually confirm Template mode never renders HTML cards, and HTML mode never
loads/manual-selects `TemplateTheme` records.

## Task 6: Seed, preview, end-to-end smoke verification, and documentation

**Files:**
- Modify: `FE-codebase/HANDOFF.md`
- Modify: `FE-codebase/README.md` only if it documents homepage generation controls
- Modify: `docs/superpowers/specs/2026-09-14-html-theme-library-design.md` only if verification reveals a decision mismatch

**Interfaces:**
- Consumes configured development S3/LLM/Chrome environment and the completed
  public UI/API contracts.
- Produces persisted starter records, a generated Corporate Tech Glass preview,
  and verification evidence.

- [ ] **Step 1: Seed and inspect the persistent registry**

Start the FE server with configured `.env.local`, call `POST /api/html-themes/seed`,
then GET the registry. Assert exactly the four expected starter IDs exist and
`defaultThemeId === "corporate-tech-glass"`. Call seed again and assert existing
theme `updatedAt` values are unchanged.

- [ ] **Step 2: Generate one saved theme preview**

Call the preview route for `corporate-tech-glass`; assert a successful response
contains a non-empty `previewUrl`, reload the HTML library, and visually verify
the card uses it. Repeat with an intentionally unavailable LLM provider and
assert the previous preview URL remains unchanged.

- [ ] **Step 3: Run HTML generation through the real selection flow**

Open `/outline?...&mode=html`, choose Corporate Tech Glass, approve a 4–6-slide
outline, generate, and verify the request carries its ID. Inspect the completed
deck: at least one content/KPI-style slide uses theme tokens/recipe instructions;
root elements can be selected, moved, and text edited; export a PPTX.

- [ ] **Step 4: Regression checks**

```powershell
node --test lib/html-themes/schema.test.js lib/html-slides/theme-prompt.test.js lib/html-slides/dom-extract.test.js components/html-theme/html-theme-form.test.js components/html-theme/html-theme-picker.test.js
npx tsc --noEmit
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Record operational handoff and commit**

Document the HTML-theme S3 prefix, seed endpoint, authoring-write environment
guard, legacy query mapping, and Chrome/LLM preview dependency in `HANDOFF.md`.

```powershell
git add HANDOFF.md README.md docs/superpowers/specs
git commit -m "docs(html-themes): record library operations"
```

## Plan self-review

- Spec coverage: Tasks 1–2 cover schema/storage/CRUD/default safety; Task 3
  covers prompt and generation; Task 4 covers list/editor/preview; Task 5
  covers homepage/outline mode separation; Task 6 covers seeded themes and
  end-to-end editable-output verification.
- Placeholder scan: no deferred implementation markers; each task specifies
  concrete files, symbols, expected tests, and commands.
- Interface consistency: `parseHtmlTheme` is the shared boundary validator;
  `selectRecipe` is the only recipe chooser; `htmlThemeFromParams` maps legacy
  IDs, while registry loaders determine currently valid/default IDs.
