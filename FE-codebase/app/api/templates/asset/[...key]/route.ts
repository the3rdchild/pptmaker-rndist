// Streams one theme or element image from the bucket, same-origin.
//
// Exists only because the bucket has no CORS policy yet — see
// lib/storage/asset-proxy.ts for why that breaks canvas export. Once CORS is
// configured, set TEMPLATE_ASSETS_PROXY=false and the browser goes back to
// loading these straight from the CDN; this route then serves nobody.

import { NextResponse } from "next/server";

import { contentTypeFor, getObject } from "@/lib/storage/s3";

export const runtime = "nodejs";

/** Only the two prefixes this app owns, and only asset extensions served to
 *  the browser — images plus the font extensions uploaded fonts are stored
 *  with. The first path character may be an underscore so the global font
 *  library (templates/_fonts/) resolves; that name can never collide with a
 *  theme id (THEME_ID_PATTERN requires an alphanumeric first char). Keeps the
 *  route from becoming a general-purpose bucket reader. */
const KEY_PATTERN =
  /^(templates|elements)\/[a-z0-9_][a-z0-9_\-./]{0,200}\.(png|jpe?g|gif|webp|bmp|svg|woff2?|ttf|otf)$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const key = (await params).key.join("/");

  if (!KEY_PATTERN.test(key) || key.includes("..")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await getObject(key);
  if (!bytes) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentTypeFor(key),
      // Theme art is content-addressed or replaced wholesale, never edited in
      // place, so it can be cached hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
