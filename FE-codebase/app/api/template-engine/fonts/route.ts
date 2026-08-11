// Template engine font upload endpoint.
//
// Stores one font file at templates/<theme>/static/fonts/ in object storage and
// registers it in the theme's bundle.fonts so ensureTemplateFontLoaded picks it
// up on the client. Mirrors the asset upload route's JSON + data: URL pattern
// (not multipart) — the request body is `{ themeId, family, data }` where
// `data` is a base64 data: URL of the font file.
//
// The family name is taken verbatim from the request (no parsing of the font's
// internal name table) so the uploader can match the exact string a deck's
// text already references — e.g. importing a .pptx that said "Pagkaki Full"
// needs the uploaded font registered under that exact family, not whatever
// name is baked into the .ttf.

import { NextResponse } from "next/server";

import { proxyAssetUrl } from "@/lib/storage/asset-proxy";
import { templateWritesBlocked } from "@/lib/templates/server/guard";
import {
  assetExtensionFor,
  registerThemeFont,
  saveThemeFont,
  unregisterThemeFont,
} from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Font files are usually well under 1MB; 8MB leaves headroom for big CJK
 *  variable fonts without letting a request push arbitrary data. */
const MAX_FONT_BYTES = 8 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i;
const FAMILY_NAME_MAX = 80;
/** Same four formats assetExtensionFor()'s font entries accept — used only to
 *  validate a client-supplied filename, never to widen what gets stored. */
const FONT_FILENAME_PATTERN = /\.(woff2|woff|ttf|otf)$/i;

export async function POST(request: Request) {
  const blocked = templateWritesBlocked("uploaded");
  if (blocked) return blocked;

  let body: { themeId?: unknown; family?: unknown; data?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  const family =
    typeof body.family === "string"
      ? body.family.trim().slice(0, FAMILY_NAME_MAX)
      : "";
  const data = typeof body.data === "string" ? body.data : "";
  if (!themeId) {
    return NextResponse.json({ error: "themeId is required" }, { status: 400 });
  }
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
  // has no font association registered, which is common outside a font-editor
  // install. Fall back to the uploaded filename's own extension in that case;
  // still whitelist-only (FONT_FILENAME_PATTERN), so this only recovers a
  // false negative, it never accepts a type the MIME path wouldn't otherwise.
  let extension = assetExtensionFor(match[1]);
  if (!extension) {
    const filename = typeof body.filename === "string" ? body.filename : "";
    const fromName = FONT_FILENAME_PATTERN.exec(filename)?.[1];
    extension = fromName ? fromName.toLowerCase() : null;
  }
  if (!extension) {
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
    const saved = await saveThemeFont({ themeId, bytes, extension });
    // template.json keeps the raw CDN URL (documented contract of
    // proxyAssetUrl/proxyAssetUrls — storage never changes so the proxy flag
    // can be flipped without a migration). Only the response the client acts
    // on immediately gets the proxy form: a reload picks up the proxied URL
    // via the template.json GET path, but the in-session Redux merge this
    // response feeds has no such rewrite step of its own, and the raw CDN
    // domain has no CORS policy — an unproxied font URL loads a @font-face
    // that the browser silently refuses to fetch cross-origin.
    await registerThemeFont(themeId, family, saved.url);
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

  let body: { themeId?: unknown; family?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  const family =
    typeof body.family === "string"
      ? body.family.trim().slice(0, FAMILY_NAME_MAX)
      : "";
  if (!themeId) {
    return NextResponse.json({ error: "themeId is required" }, { status: 400 });
  }
  if (!family) {
    return NextResponse.json({ error: "family is required" }, { status: 400 });
  }

  try {
    const result = await unregisterThemeFont(themeId, family);
    if (result.removedUrl === null) {
      return NextResponse.json(
        { error: `Font "${family}" is not registered in this theme` },
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
