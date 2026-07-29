// Template engine asset endpoint.
//
// Stores one image into public/templates/<theme>/static/imported/ and hands
// back its pack-absolute URL. Used by the .pptx import: a deck's media has to
// land on disk as files, because the alternative — leaving it inlined as
// `data:` URLs — bakes megabytes of base64 into the layout JSON that gets
// committed (see template-v2-export's warning for exactly that case).
//
// Like the layout endpoint this writes inside the repo working tree, so it is
// refused outside development.

import { NextResponse } from "next/server";

import { assetExtensionFor, saveThemeAsset } from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous enough for a full-bleed photo, small enough that a malformed
 *  request can't write an arbitrarily large file into the repo. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "The template engine only writes templates in development." },
      { status: 403 },
    );
  }

  let body: { themeId?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  const data = typeof body.data === "string" ? body.data : "";
  if (!themeId) {
    return NextResponse.json({ error: "themeId is required" }, { status: 400 });
  }

  const match = DATA_URL_PATTERN.exec(data);
  if (!match) {
    return NextResponse.json(
      { error: "data must be a base64 data: URL" },
      { status: 400 },
    );
  }

  const extension = assetExtensionFor(match[1]);
  if (!extension) {
    return NextResponse.json(
      { error: `Unsupported image type: ${match[1]}` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty asset" }, { status: 400 });
  }
  if (bytes.length > MAX_ASSET_BYTES) {
    return NextResponse.json(
      { error: `Asset is larger than ${MAX_ASSET_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  try {
    const result = await saveThemeAsset({ themeId, bytes, extension });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
