import type { HtmlTheme, HtmlThemeRegistry } from "@/lib/html-themes/types";

let registryPromise: Promise<HtmlThemeRegistry> | null = null;
const themePromises = new Map<string, Promise<HtmlTheme | null>>();

async function jsonOrThrow(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${response.status})`);
  return body;
}

export function invalidateHtmlThemeCache(id?: string) {
  registryPromise = null;
  if (id) themePromises.delete(id);
  else themePromises.clear();
}

export function loadHtmlThemeRegistry(): Promise<HtmlThemeRegistry> {
  if (!registryPromise) {
    registryPromise = fetch("/api/html-themes", { cache: "no-store" })
      .then(jsonOrThrow)
      .then((body) => ({ themes: Array.isArray(body.themes) ? body.themes : [], defaultThemeId: typeof body.defaultThemeId === "string" ? body.defaultThemeId : null }));
  }
  return registryPromise;
}

export function loadHtmlTheme(id: string): Promise<HtmlTheme | null> {
  const cached = themePromises.get(id);
  if (cached) return cached;
  const promise = fetch(`/api/html-themes/${encodeURIComponent(id)}`, { cache: "no-store" })
    .then(async (response) => response.status === 404 ? null : jsonOrThrow(response))
    .then((body) => body?.theme ?? null);
  themePromises.set(id, promise);
  return promise;
}

export async function saveHtmlTheme(theme: HtmlTheme, expectedUpdatedAt: string | null): Promise<HtmlTheme> {
  const creating = expectedUpdatedAt === null;
  const response = await fetch(creating ? "/api/html-themes" : `/api/html-themes/${encodeURIComponent(theme.id)}`, {
    method: creating ? "POST" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creating ? { theme } : { theme, expectedUpdatedAt }),
  });
  const body = await jsonOrThrow(response);
  invalidateHtmlThemeCache(theme.id);
  return body.theme as HtmlTheme;
}

export async function removeHtmlTheme(id: string): Promise<HtmlThemeRegistry> {
  const body = await jsonOrThrow(await fetch(`/api/html-themes/${encodeURIComponent(id)}`, { method: "DELETE" }));
  invalidateHtmlThemeCache(id);
  return body;
}
