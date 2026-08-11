// Client side of the global font library (see app/api/fonts/route.ts).
//
// The registry is a tiny { family: url } map, cached for the page lifetime
// and updated in place by the upload/delete helpers below — so every editor
// surface (deck editor, template engine) sees every font ever uploaded,
// regardless of which theme it came from.

let cache: Promise<Record<string, string>> | null = null;

export function getGlobalFonts(): Promise<Record<string, string>> {
  if (!cache) {
    cache = fetch("/api/fonts")
      .then(async (res) => {
        if (!res.ok) return {};
        const body = await res.json().catch(() => null);
        const fonts = body?.fonts;
        return fonts && typeof fonts === "object" && !Array.isArray(fonts)
          ? (fonts as Record<string, string>)
          : {};
      })
      .catch(() => ({}));
  }
  return cache;
}

/** Uploads one font file (as a base64 data: URL) into the global library and
 *  returns its proxied URL. Throws with the server's message on failure. */
export async function uploadGlobalFont(
  family: string,
  dataUrl: string,
  filename: string,
): Promise<{ family: string; url: string }> {
  const res = await fetch("/api/fonts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // filename lets the server recover the extension when the browser's
    // claimed MIME type is a generic application/octet-stream — common on
    // Windows for .ttf/.otf when the OS has no font association.
    body: JSON.stringify({ family, data: dataUrl, filename }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    url?: string;
    error?: string;
  } | null;
  if (!res.ok || !body?.ok || !body.url) {
    throw new Error(body?.error || `Upload failed (${res.status})`);
  }
  const current = await getGlobalFonts();
  cache = Promise.resolve({ ...current, [family]: body.url });
  return { family, url: body.url };
}

/** Removes one family from the global library. Throws on failure. */
export async function deleteGlobalFont(family: string): Promise<void> {
  const res = await fetch("/api/fonts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ family }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `Delete failed (${res.status})`);
  }
  const current = await getGlobalFonts();
  const next = { ...current };
  delete next[family];
  cache = Promise.resolve(next);
}
