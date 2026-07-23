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

    const image = new window.Image();
    image.onload = () => done(image);
    image.onerror = () => done(null);
    image.src = src;
    if (image.complete) done(image);
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
