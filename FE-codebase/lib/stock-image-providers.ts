// Stock-photo search layer for the editor's "Fill with stock photo" action
// (ImageToolbar → StockPhotoEditor). Same preset/env-aware shape as
// ai-providers.ts: each provider is a preset keyed by an env var, and
// availability is computed from which keys are set, so the UI never offers a
// provider the server can't call. Keys are server-only (no NEXT_PUBLIC_
// prefix); the browser reaches them via /api/stock-images/*.
//
// Provider quirks (Pexels raw-key header, Unsplash Client-ID + mandatory
// download-location ping, Pixabay query-string key) are verified against the
// reference Bun proxies — see section E of the plan for the compliance notes,
// especially the Unsplash download-tracking requirement.

export type StockImageProviderId = "pexels" | "unsplash" | "pixabay";

export interface StockImageResult {
  id: string;
  provider: StockImageProviderId;
  /** Resolution used on the slide (not the thumbnail). */
  url: string;
  /** Small preview for the picker grid. */
  thumbnail: string;
  width: number;
  height: number;
  /** Photographer / uploader name — required attribution by provider terms. */
  credit: string;
  creditUrl?: string;
  /** Link back to the photo page on the provider. */
  sourceUrl: string;
  /** Unsplash only — MUST be pinged when the photo is actually used. */
  downloadLocation?: string;
}

export interface StockImageProviderPreset {
  id: StockImageProviderId;
  label: string;
  /** env var name holding the API key — used to detect availability. */
  envKey: string;
}

export const STOCK_IMAGE_PRESETS: StockImageProviderPreset[] = [
  { id: "pexels", label: "Pexels", envKey: "PEXELS_API_KEY" },
  { id: "unsplash", label: "Unsplash", envKey: "UNSPLASH_ACCESS_KEY" },
  { id: "pixabay", label: "Pixabay", envKey: "PIXABAY_API_KEY" },
];

export interface AvailableStockImageProvider {
  id: StockImageProviderId;
  label: string;
}

/** Providers whose API key is configured, for the StockPhotoEditor picker. */
export function availableStockImageProviders(): AvailableStockImageProvider[] {
  return STOCK_IMAGE_PRESETS.filter((p) => Boolean(process.env[p.envKey])).map(
    (p) => ({ id: p.id, label: p.label }),
  );
}

function forKey(id: StockImageProviderId): string | null {
  const preset = STOCK_IMAGE_PRESETS.find((p) => p.id === id) ?? null;
  if (!preset) return null;
  return process.env[preset.envKey] ?? null;
}

export interface StockImageSearchOptions {
  page?: number;
  perPage?: number;
}

export interface StockImageSearchResponse {
  results: StockImageResult[];
  total: number;
}

/** Searches a single provider and normalizes its response to StockImageResult.
 *  Throws on HTTP failure — the route handler maps that to a 502. */
export async function searchStockImages(
  providerId: StockImageProviderId,
  query: string,
  opts: StockImageSearchOptions,
): Promise<StockImageSearchResponse> {
  switch (providerId) {
    case "pexels":
      return searchPexels(query, opts);
    case "unsplash":
      return searchUnsplash(query, opts);
    case "pixabay":
      return searchPixabay(query, opts);
  }
}

type Rec = Record<string, unknown>;

async function searchPexels(
  query: string,
  opts: StockImageSearchOptions,
): Promise<StockImageSearchResponse> {
  const key = forKey("pexels");
  if (!key) throw new Error("Pexels API key not configured");
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 24;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query,
  )}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pexels API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Rec;
  const photos = (data.photos as Rec[] | undefined) ?? [];
  return {
    results: photos.map((p) => {
      const src = (p.src as Rec | undefined) ?? {};
      return {
        id: `pexels:${p.id}`,
        provider: "pexels" as const,
        url: String(src.large2x ?? src.original ?? ""),
        thumbnail: String(src.medium ?? ""),
        width: Number(p.width) || 0,
        height: Number(p.height) || 0,
        credit: String(p.photographer ?? ""),
        creditUrl: p.photographer_url ? String(p.photographer_url) : undefined,
        sourceUrl: String(p.url ?? ""),
      };
    }),
    total: Number(data.total_results) || photos.length,
  };
}

async function searchUnsplash(
  query: string,
  opts: StockImageSearchOptions,
): Promise<StockImageSearchResponse> {
  const key = forKey("unsplash");
  if (!key) throw new Error("Unsplash API key not configured");
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 24;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
    query,
  )}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${key}`,
      "Accept-Version": "v1",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Unsplash API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Rec;
  const items = (data.results as Rec[] | undefined) ?? [];
  return {
    results: items.map((p) => {
      const urls = (p.urls as Rec | undefined) ?? {};
      const user = (p.user as Rec | undefined) ?? {};
      const userLinks = (user.links as Rec | undefined) ?? {};
      const links = (p.links as Rec | undefined) ?? {};
      return {
        id: `unsplash:${p.id}`,
        provider: "unsplash" as const,
        url: String(urls.regular ?? ""),
        thumbnail: String(urls.small ?? ""),
        width: Number(p.width) || 0,
        height: Number(p.height) || 0,
        credit: String(user.name ?? ""),
        creditUrl: userLinks.html ? String(userLinks.html) : undefined,
        sourceUrl: String(links.html ?? ""),
        downloadLocation: links.download_location
          ? String(links.download_location)
          : undefined,
      };
    }),
    total: Number(data.total) || items.length,
  };
}

async function searchPixabay(
  query: string,
  opts: StockImageSearchOptions,
): Promise<StockImageSearchResponse> {
  const key = forKey("pixabay");
  if (!key) throw new Error("Pixabay API key not configured");
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 24;
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(
    key,
  )}&q=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pixabay API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Rec;
  const hits = (data.hits as Rec[] | undefined) ?? [];
  return {
    results: hits.map((p) => ({
      id: `pixabay:${p.id}`,
      provider: "pixabay" as const,
      url: String(p.largeImageURL ?? ""),
      thumbnail: String(p.webformatURL ?? p.previewURL ?? ""),
      width: Number(p.imageWidth) || 0,
      height: Number(p.imageHeight) || 0,
      credit: String(p.user ?? ""),
      sourceUrl: String(p.pageURL ?? ""),
    })),
    total: Number(data.totalHits) || hits.length,
  };
}
