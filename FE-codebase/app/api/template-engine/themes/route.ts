// Theme listing and creation for the template engine.

import { NextResponse } from "next/server";

import { createTheme, listThemeIds } from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ themes: await listThemeIds() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Themes can only be created in development." },
      { status: 403 },
    );
  }

  let body: { themeId?: unknown; name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!themeId || !name) {
    return NextResponse.json(
      { error: "themeId and name are required" },
      { status: 400 },
    );
  }

  try {
    await createTheme({
      themeId,
      name,
      description:
        typeof body.description === "string" ? body.description.trim() : "",
    });
    return NextResponse.json({ ok: true, themeId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
