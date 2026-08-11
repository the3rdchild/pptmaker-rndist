// Same-origin fallback for theme and element images.
//
// Assets live in the bucket and their absolute CDN URLs are what gets stored
// in the layout JSON. But the bucket has no CORS policy yet — the credentials
// we hold are object-level and cannot set one — and that breaks canvas export:
//
//   * loaded without crossOrigin, the image renders but taints the canvas, so
//     Konva's toDataURL() throws SecurityError
//   * loaded with crossOrigin="anonymous", the request is refused outright
//
// Verified both, in that order. So while TEMPLATE_ASSETS_PROXY is on, the JSON
// handed to the browser has its CDN URLs rewritten to a same-origin path that
// streams the same object. Same-origin means no tainting and no CORS.
//
// This rewrites on the way out only — what is stored stays an absolute CDN
// URL. Turning the flag off once the bucket has a CORS policy therefore needs
// no data migration: assets simply start loading direct from the CDN again.

export const ASSET_PROXY_PREFIX = "/api/templates/asset";

/** On by default: the bucket has no CORS policy today, so the safe state is
 *  the one where export works. Set to "false" once CORS is configured. */
export function assetProxyEnabled(): boolean {
  return process.env.TEMPLATE_ASSETS_PROXY !== "false";
}

/** Rewrites every absolute CDN URL in a JSON document to the proxy path.
 *
 *  Operates on the serialised text rather than walking the object tree: asset
 *  URLs turn up at many depths and under many key names across template.json,
 *  and a textual swap of one exact prefix cannot miss one or mangle a field it
 *  was not meant to touch. */
export function proxyAssetUrls(json: string): string {
  const base = (process.env.CDN_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base || !assetProxyEnabled()) return json;
  return json.replaceAll(`"${base}/`, `"${ASSET_PROXY_PREFIX}/`);
}

/** Single-URL counterpart to proxyAssetUrls, for routes that hand back one
 *  freshly-written URL directly in a response body rather than through a
 *  template.json read (which already goes through proxyAssetUrls). Without
 *  this, a client that uses the raw response URL immediately — e.g. merging
 *  it into live state right after an upload, instead of re-reading the theme
 *  — bypasses the rewrite entirely and gets a URL the browser cannot load
 *  cross-origin from an uncorsed bucket. */
export function proxyAssetUrl(url: string): string {
  const base = (process.env.CDN_PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (!base || !assetProxyEnabled() || !url.startsWith(`${base}/`)) return url;
  return `${ASSET_PROXY_PREFIX}/${url.slice(base.length + 1)}`;
}
