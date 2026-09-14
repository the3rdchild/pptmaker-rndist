import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { generateDeck } from "@/lib/html-slides/deck-pipeline.js";
import { htmlThemeWritesBlocked } from "@/lib/html-themes/server/guard";
import { readHtmlTheme, saveHtmlThemePreview } from "@/lib/html-themes/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ themeId: string }> }) {
  const blocked = htmlThemeWritesBlocked("previewed");
  if (blocked) return blocked;
  const themeId = (await params).themeId;
  const theme = await readHtmlTheme(themeId);
  if (!theme) return NextResponse.json({ error: "HTML theme not found" }, { status: 404 });
  const outDir = await mkdtemp(join(tmpdir(), "html-theme-preview-"));
  try {
    await generateDeck({
      topic: "# Theme Preview\n\n## A Clear Direction\nA concise cover used only to preview this HTML theme.",
      slideCount: 1,
      theme,
      outDir,
    });
    const saved = await saveHtmlThemePreview(themeId, await readFile(join(outDir, "slide-1.png")));
    return NextResponse.json({ theme: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not generate HTML theme preview" }, { status: 500 });
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}
