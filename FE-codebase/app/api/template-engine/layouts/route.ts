// Template engine save endpoint.
//
// Writes layout sources into public/templates/<theme>/layouts/ and rebuilds
// the theme bundle. This edits files inside the repo working tree, so it is
// refused outside development — a deployed instance has a read-only bundle
// and templates are authored locally and committed.

import { NextResponse } from "next/server";

import {
  deleteLayout,
  saveLayout,
  writeThemeIndex,
  type StoredLayout,
} from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function devOnlyGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "The template engine only writes templates in development." },
      { status: 403 },
    );
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST(request: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;

  let body: { themeId?: unknown; layout?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  const layout = body.layout;
  if (!themeId) {
    return NextResponse.json({ error: "themeId is required" }, { status: 400 });
  }
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return NextResponse.json({ error: "layout must be an object" }, { status: 400 });
  }
  if (typeof (layout as StoredLayout).id !== "string") {
    return NextResponse.json({ error: "layout.id is required" }, { status: 400 });
  }

  try {
    const result = await saveLayout({ themeId, layout: layout as StoredLayout });
    await writeThemeIndex();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;

  const url = new URL(request.url);
  const themeId = url.searchParams.get("themeId") ?? "";
  const layoutId = url.searchParams.get("layoutId") ?? "";
  if (!themeId || !layoutId) {
    return NextResponse.json(
      { error: "themeId and layoutId are required" },
      { status: 400 },
    );
  }

  try {
    const layoutCount = await deleteLayout(themeId, layoutId);
    return NextResponse.json({ ok: true, layoutCount });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
