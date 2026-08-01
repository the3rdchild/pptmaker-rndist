// Custom element library: list, upload, delete.
//
// GET is allowed everywhere. Writes go through the same guard as the template
// routes — the library is shared and public-read, so until per-user ownership
// exists (see docs/storage-staging-notes.md) anyone who can write here can
// change what every deck sees.

import { NextResponse } from "next/server";

import {
  deleteElement,
  readLibrary,
  renameCategory,
  saveElement,
} from "@/lib/elements/server/store";
import { proxyAssetUrls } from "@/lib/storage/asset-proxy";
import { templateWritesBlocked } from "@/lib/templates/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writesBlocked(): NextResponse | null {
  return templateWritesBlocked("uploaded");
}

function fail(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unknown error" },
    { status },
  );
}

export async function GET() {
  try {
    const library = JSON.stringify(await readLibrary());
    return new NextResponse(proxyAssetUrls(library), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  const blocked = writesBlocked();
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  const label = typeof body.label === "string" ? body.label : "";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  if (!categoryId || !dataUrl) {
    return NextResponse.json(
      { error: "categoryId and dataUrl are required" },
      { status: 400 },
    );
  }

  try {
    const result = await saveElement({
      categoryId,
      categoryLabel:
        typeof body.categoryLabel === "string" ? body.categoryLabel : undefined,
      label,
      dataUrl,
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  const blocked = writesBlocked();
  if (blocked) return blocked;

  let body: { categoryId?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  const label = typeof body.label === "string" ? body.label : "";
  if (!categoryId || !label) {
    return NextResponse.json(
      { error: "categoryId and label are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ ok: true, ...(await renameCategory(categoryId, label)) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  const blocked = writesBlocked();
  if (blocked) return blocked;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get("categoryId") ?? "";
  const itemId = url.searchParams.get("itemId") ?? "";
  if (!categoryId || !itemId) {
    return NextResponse.json(
      { error: "categoryId and itemId are required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ ok: true, ...(await deleteElement(categoryId, itemId)) });
  } catch (error) {
    return fail(error);
  }
}
