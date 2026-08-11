// Global font library endpoint — upload once, use in every theme and deck.
//
//   GET    /api/fonts           → { fonts: { family: proxiedUrl } }
//   POST   /api/fonts           { family, data, filename }  → register upload
//   DELETE /api/fonts           { family }                  → unregister
//
// The per-theme variant (/api/template-engine/fonts) stays for the theme
// bundles that already carry fonts; everything new lands here. Same JSON +
// data: URL pattern as that route, same response-layer URL proxying (raw CDN
// URLs in storage, proxied URLs in responses — the bucket has no CORS policy
// and @font-face fetches are always CORS-mode).

import { NextResponse } from "next/server";

import { proxyAssetUrl } from "@/lib/storage/asset-proxy";
import {
  listGlobalFonts,
  registerGlobalFont,
  saveGlobalFont,
  unregisterGlobalFont,
} from "@/lib/fonts/global-store";
import { templateWritesBlocked } from "@/lib/templates/server/guard";
import { assetExtensionFor } from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Font files are usually well under 1MB; 8MB leaves headroom for big CJK
 *  variable fonts without letting a request push arbitrary data. */
const MAX_FONT_BYTES = 8 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i;
const FAMILY_NAME_MAX = 80;
const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf"]);
/** Same four formats assetExtensionFor()'s font entries accept — used only to
 *  validate a client-supplied filename, never to widen what gets stored. */
const FONT_FILENAME_PATTERN = /\.(woff2|woff|ttf|otf)$/i;

export async function GET() {
  const fonts = await listGlobalFonts();
  const proxied = Object.fromEntries(
    Object.entries(fonts).map(([family, url]) => [family, proxyAssetUrl(url)]),
  );
  return NextResponse.json(
    { fonts: proxied },
    // The registry changes on every upload/delete; never let a cache serve
    // a stale one.
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const blocked = templateWritesBlocked("uploaded");
  if (blocked) return blocked;

  let body: { family?: unknown; data?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const family =
    typeof body.family === "string"
      ? body.family.trim().slice(0, FAMILY_NAME_MAX)
      : "";
  const data = typeof body.data === "string" ? body.data : "";
  if (!family) {
    return NextResponse.json(
      { error: "family is required (use the exact font name your deck uses)" },
      { status: 400 },
    );
  }

  const match = DATA_URL_PATTERN.exec(data);
  if (!match) {
    return NextResponse.json(
      { error: "data must be a base64 data: URL" },
      { status: 400 },
    );
  }

  // The browser's claimed MIME type isn't reliable for fonts — Windows in
  // particular reports application/octet-stream for .ttf/.otf whenever the OS
  // has no font association registered. Fall back to the uploaded filename's
  // own extension in that case; still whitelist-only, so this never accepts a
  // type the MIME path wouldn't otherwise.
  let extension = assetExtensionFor(match[1]);
  if (!extension || !FONT_EXTENSIONS.has(extension)) {
    const filename = typeof body.filename === "string" ? body.filename : "";
    const fromName = FONT_FILENAME_PATTERN.exec(filename)?.[1];
    extension = fromName ? fromName.toLowerCase() : null;
  }
  if (!extension || !FONT_EXTENSIONS.has(extension)) {
    return NextResponse.json(
      { error: `Unsupported font type: ${match[1]}` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty font file" }, { status: 400 });
  }
  if (bytes.length > MAX_FONT_BYTES) {
    return NextResponse.json(
      { error: `Font is larger than ${MAX_FONT_BYTES / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  try {
    const saved = await saveGlobalFont({ bytes, extension });
    await registerGlobalFont(family, saved.url);
    return NextResponse.json({
      ok: true,
      family,
      url: proxyAssetUrl(saved.url),
      reused: saved.reused,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const blocked = templateWritesBlocked("deleted");
  if (blocked) return blocked;

  let body: { family?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const family =
    typeof body.family === "string"
      ? body.family.trim().slice(0, FAMILY_NAME_MAX)
      : "";
  if (!family) {
    return NextResponse.json({ error: "family is required" }, { status: 400 });
  }

  try {
    const result = await unregisterGlobalFont(family);
    if (result.removedUrl === null) {
      return NextResponse.json(
        { error: `Font "${family}" is not in the global library` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      family,
      removedUrl: proxyAssetUrl(result.removedUrl),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 },
    );
  }
}
