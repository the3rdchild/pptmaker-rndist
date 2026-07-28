// Theme listing and creation for the template engine.

import { NextResponse } from "next/server";

import {
  createTheme,
  deleteTheme,
  listThemeIds,
  updateThemeMeta,
} from "@/lib/templates/server/store";

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

export async function PATCH(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Themes can only be edited in development." },
      { status: 403 },
    );
  }

  let body: { themeId?: unknown; patch?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  const patch =
    body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
      ? (body.patch as Record<string, unknown>)
      : null;
  if (!themeId || !patch) {
    return NextResponse.json(
      { error: "themeId and patch are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ ok: true, theme: await updateThemeMeta(themeId, patch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Themes can only be deleted in development." },
      { status: 403 },
    );
  }

  const themeId = new URL(request.url).searchParams.get("themeId") ?? "";
  if (!themeId) {
    return NextResponse.json({ error: "themeId is required" }, { status: 400 });
  }

  try {
    const themes = await deleteTheme(themeId);
    return NextResponse.json({ ok: true, themes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
