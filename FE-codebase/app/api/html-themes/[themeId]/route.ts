import { NextResponse } from "next/server";
import { htmlThemeWritesBlocked } from "@/lib/html-themes/server/guard";
import { deleteHtmlTheme, readHtmlTheme, updateHtmlTheme } from "@/lib/html-themes/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ themeId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const theme = await readHtmlTheme((await params).themeId);
  return theme ? NextResponse.json({ theme }) : NextResponse.json({ error: "HTML theme not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const blocked = htmlThemeWritesBlocked("edited");
  if (blocked) return blocked;
  const body = await request.json().catch(() => null) as { theme?: unknown; expectedUpdatedAt?: unknown } | null;
  if (!body?.theme) return NextResponse.json({ error: "theme is required" }, { status: 400 });
  try {
    return NextResponse.json({ theme: await updateHtmlTheme((await params).themeId, body.theme, body.expectedUpdatedAt) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update HTML theme";
    const status = message === "HTML_THEME_NOT_FOUND" ? 404 : message === "HTML_THEME_CONFLICT" ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const blocked = htmlThemeWritesBlocked("deleted");
  if (blocked) return blocked;
  try {
    return NextResponse.json(await deleteHtmlTheme((await params).themeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete HTML theme";
    return NextResponse.json({ error: message }, { status: message === "HTML_THEME_NOT_FOUND" ? 404 : 400 });
  }
}
