// The model-facing view of the template library.
//
// `?theme=<id>` returns one theme's full layout manifest; with no query it
// returns the theme-choice summary — the small payload the generator uses to
// answer "which theme is this deck?" before it looks at any layout in detail.
//
// Exposed as a route so the manifest can be inspected while authoring
// templates: if a layout reads poorly here, it will read poorly to the model.

import { NextResponse } from "next/server";

import {
  buildThemeChoiceManifest,
  buildThemeManifest,
} from "@/lib/templates/manifest";
import { listThemeIds, readTheme } from "@/lib/templates/server/store";
import type { TemplateTheme } from "@/lib/templates/themes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const themeId = new URL(request.url).searchParams.get("theme");
  const ids = await listThemeIds();
  const themes = (await Promise.all(ids.map(readTheme))).filter(
    (theme): theme is TemplateTheme => Boolean(theme),
  );

  if (!themeId) {
    return NextResponse.json({ themes: buildThemeChoiceManifest(themes) });
  }

  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) {
    return NextResponse.json({ error: `Unknown theme: ${themeId}` }, { status: 404 });
  }

  return NextResponse.json(buildThemeManifest(theme));
}
