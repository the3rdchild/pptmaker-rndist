// Read endpoint for theme JSON held in object storage.
//
// Only the manifests come through here — index.json, and each theme's
// template.json / theme.json. Images stay on direct CDN URLs embedded in that
// JSON, so the 26MB of theme art never touches this process.
//
// The indirection exists because a browser `fetch()` across origins needs CORS
// headers on the bucket, and the credentials we hold are object-level only —
// they cannot set a bucket CORS policy. Reading server-side sidesteps that
// entirely. `<img src>` needs no CORS, which is why images can go direct.
//
// Note this is still required for canvas export: Konva tainting rules mean
// exporting a deck to PNG/PDF needs crossOrigin on the images themselves, so
// bucket CORS has to be enabled from the provider dashboard before export
// works against remote assets.

import { NextResponse } from "next/server";

import { proxyAssetUrls } from "@/lib/storage/asset-proxy";
import { getObject } from "@/lib/storage/s3";
import { TEMPLATES_PREFIX } from "@/lib/templates/server/store";

export const runtime = "nodejs";

/** Path segments the caller may ask for. Anything else — a traversal attempt,
 *  or a request for the bulk image assets — is refused rather than proxied. */
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,80}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  if (
    path.length === 0 ||
    path.length > 2 ||
    !path.every((segment) => SEGMENT_PATTERN.test(segment)) ||
    !path[path.length - 1].endsWith(".json")
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = await getObject(`${TEMPLATES_PREFIX}/${path.join("/")}`);
  if (!bytes) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(proxyAssetUrls(bytes.toString("utf8")), {
    headers: {
      "Content-Type": "application/json",
      // Short cache: the template engine has to see a layout it just saved,
      // but a deck opening 30 slides should not re-fetch the bundle 30 times.
      "Cache-Control": "public, max-age=0, s-maxage=60, must-revalidate",
    },
  });
}
