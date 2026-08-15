// Cross-origin bucket URLs get rewritten to the same-origin asset proxy, so
// they render WITHOUT tainting the canvas. Shared with the read paths that
// need the same resolution (template-engine-panel's Save to My elements) —
// external URLs we don't own pass through untouched.
import { toSameOriginAssetUrl } from "@/lib/storage/asset-proxy";

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

    // Load attempts, best to worst:
    //   1. same-origin proxy (bucket URLs only) — exportable, no CORS needed
    //   2. direct with crossOrigin="anonymous" — exportable when the remote
    //      allows CORS
    //   3. direct plain load — renders but taints (the pre-fix behavior),
    //      kept as the last step so an image never disappears from a slide
    const proxied = toSameOriginAssetUrl(src);
    const steps: { url: string; anonymous: boolean }[] = [];
    if (proxied !== src) steps.push({ url: proxied, anonymous: false });
    const isCrossOrigin =
      /^https?:\/\//i.test(src) && !src.startsWith(window.location.origin);
    if (isCrossOrigin) steps.push({ url: src, anonymous: true });
    steps.push({ url: src, anonymous: false });

    const attempt = (index: number) => {
      const step = steps[index];
      if (!step) {
        done(null);
        return;
      }
      const image = new window.Image();
      if (step.anonymous) image.crossOrigin = "anonymous";
      image.onload = () => done(image);
      image.onerror = () => attempt(index + 1);
      image.src = step.url;
      if (image.complete) done(image);
    };
    attempt(0);
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
