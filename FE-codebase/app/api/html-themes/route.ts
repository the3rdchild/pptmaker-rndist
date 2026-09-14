import { NextResponse } from "next/server";
import { htmlThemeWritesBlocked } from "@/lib/html-themes/server/guard";
import { createHtmlTheme, listHtmlThemeRegistry } from "@/lib/html-themes/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listHtmlThemeRegistry());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load HTML themes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const blocked = htmlThemeWritesBlocked("created");
  if (blocked) return blocked;
  const body = await request.json().catch(() => null) as { theme?: unknown } | null;
  if (!body?.theme) return NextResponse.json({ error: "theme is required" }, { status: 400 });
  try {
    return NextResponse.json({ theme: await createHtmlTheme(body.theme) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create HTML theme" }, { status: 400 });
  }
}
