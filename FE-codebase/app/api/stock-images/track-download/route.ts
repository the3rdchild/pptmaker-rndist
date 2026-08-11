import { NextResponse, type NextRequest } from "next/server";

// Unsplash API Guidelines require apps to ping `links.download_location` each
// time a photo is actually used (not just previewed in the grid). The browser
// can't call it directly — the access key is server-only — so the editor fires
// this route after applying an Unsplash photo. Fire-and-forget: the result
// doesn't affect the caller and we always return ok once the request is sent.
//
// SECURITY: the hostname is exact-matched to api.unsplash.com before we attach
// the access key. This route has no session check (same as the other stock-image
// routes), so without this guard anyone who can reach the app could POST an
// attacker-controlled URL and exfiltrate the key via the Authorization header,
// or use the server as an SSRF proxy (internal network, cloud metadata).

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { downloadLocation?: unknown }
    | null;
  const downloadLocation = body?.downloadLocation;
  if (typeof downloadLocation !== "string") {
    return NextResponse.json(
      { error: "downloadLocation is required" },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(downloadLocation);
  } catch {
    return NextResponse.json(
      { error: "downloadLocation must be a valid URL" },
      { status: 400 },
    );
  }
  // Exact match — a loose .includes/suffix check is bypassable via
  // api.unsplash.com.attacker.com.
  if (parsed.hostname !== "api.unsplash.com") {
    return NextResponse.json(
      { error: "downloadLocation must point to api.unsplash.com" },
      { status: 400 },
    );
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return NextResponse.json({ ok: false });

  await fetch(parsed, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}

