import { ASSET_PROXY_PREFIX } from "@/lib/storage/asset-proxy";

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Cross-origin bucket URLs get rewritten to the same-origin asset proxy
 * (templates/ and elements/ are the two prefixes it serves), so they render
 * WITHOUT tainting the canvas. External URLs we don't own pass through
 * untouched. */
function toSameOriginAssetUrl(src: string): string {
  if (typeof window === "undefined") return src;
  if (!/^https?:\/\//i.test(src)) return src;
  try {
    const url = new URL(src);
    if (url.origin === window.location.origin) return src;
    if (/^\/(templates|elements)\//.test(url.pathname)) {
      return `${ASSET_PROXY_PREFIX}${url.pathname}`;
    }
    return src;
  } catch {
    return src;
  }
}

export function loadKonvaImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    let settled = false;
    const done = (image: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(image);
    };

    const url = toSameOriginAssetUrl(src);
    const crossOrigin =
      /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin);

    // Cross-origin images get an anonymous attempt first — when the remote
    // allows CORS the canvas stays exportable; on refusal we fall back to a
    // plain load (renders but taints — the pre-existing behavior) rather
    // than dropping the image from the slide entirely.
    const attempt = (anonymous: boolean) => {
      const image = new window.Image();
      if (anonymous) image.crossOrigin = "anonymous";
      image.onload = () => done(image);
      image.onerror = () => {
        if (anonymous) attempt(false);
        else done(null);
      };
      image.src = url;
      if (image.complete) done(image);
    };
    attempt(crossOrigin);
  });
  imageCache.set(src, promise);
  return promise;
}

/** Every image/icon/formula element funnels through loadKonvaImage above, so
 * this is the one place a caller (e.g. PDF export, capturing a Stage right
 * after mounting it) can wait for "everything that's currently loading has
 * settled" without threading a readiness callback through every element
 * type individually. */
export function pendingKonvaImageLoads(): Promise<HTMLImageElement | null>[] {
  return Array.from(imageCache.values());
}
