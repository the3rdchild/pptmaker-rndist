import { NextResponse, type NextRequest } from "next/server";

// Unsplash API Guidelines require apps to ping `links.download_location` each
// time a photo is actually used (not just previewed in the grid). The browser
// can't call it directly — the access key is server-only — so the editor fires
// this route after applying an Unsplash photo. Fire-and-forget: the result
// doesn't affect the caller and we always return ok once the request is sent.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { downloadLocation?: unknown }
    | null;
  const downloadLocation = body?.downloadLocation;
  if (typeof downloadLocation !== "string" || !downloadLocation.startsWith("http")) {
    return NextResponse.json(
      { error: "downloadLocation is required" },
      { status: 400 },
    );
  }
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return NextResponse.json({ ok: false });

  await fetch(downloadLocation, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
