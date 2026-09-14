import { deletePrefix, objectExists, putObject, readJson, writeJson } from "@/lib/storage/s3";
import {
  assertSafeHtmlThemeId,
  deleteFromHtmlThemeIndex,
  htmlThemeSummary,
  parseHtmlTheme,
} from "@/lib/html-themes/schema.js";
import { DEFAULT_HTML_THEME_ID, STARTER_HTML_THEMES } from "@/lib/html-themes/seeds.js";
import type { HtmlTheme, HtmlThemeRegistry, HtmlThemeSummary } from "@/lib/html-themes/types";

export const HTML_THEMES_PREFIX = "html-themes";
const indexKey = `${HTML_THEMES_PREFIX}/index.json`;
const themeKey = (id: string) => `${HTML_THEMES_PREFIX}/${id}/theme.json`;

type StoredIndex = { schemaVersion: 1; defaultThemeId: string; themes: string[] };

function parseIndex(value: unknown): StoredIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.themes) || typeof record.defaultThemeId !== "string") return null;
  try {
    const themes = record.themes.map(assertSafeHtmlThemeId);
    if (new Set(themes).size !== themes.length || !themes.includes(record.defaultThemeId)) return null;
    return { schemaVersion: 1, defaultThemeId: assertSafeHtmlThemeId(record.defaultThemeId), themes };
  } catch {
    return null;
  }
}

async function readIndex(): Promise<StoredIndex | null> {
  return parseIndex(await readJson<unknown>(indexKey));
}

async function writeIndex(index: StoredIndex): Promise<void> {
  await writeJson(indexKey, index);
}

function asTheme(value: unknown): HtmlTheme | null {
  try {
    return parseHtmlTheme(value) as HtmlTheme;
  } catch {
    return null;
  }
}

export async function readHtmlTheme(themeId: string): Promise<HtmlTheme | null> {
  let id: string;
  try { id = assertSafeHtmlThemeId(themeId); } catch { return null; }
  return asTheme(await readJson<unknown>(themeKey(id)));
}

export async function listHtmlThemeRegistry(): Promise<HtmlThemeRegistry> {
  const index = await readIndex();
  if (!index) return { themes: [], defaultThemeId: null };
  const entries = await Promise.all(index.themes.map((id) => readHtmlTheme(id)));
  const themes: HtmlThemeSummary[] = [];
  for (const theme of entries) {
    if (theme) themes.push(htmlThemeSummary(theme, { isDefault: theme.id === index.defaultThemeId }) as HtmlThemeSummary);
  }
  const defaultThemeId = themes.some((theme) => theme.id === index.defaultThemeId) ? index.defaultThemeId : null;
  return { themes, defaultThemeId };
}

export async function createHtmlTheme(draft: unknown): Promise<HtmlTheme> {
  const parsed = parseHtmlTheme(draft) as HtmlTheme;
  if (await objectExists(themeKey(parsed.id))) throw new Error(`Theme "${parsed.id}" already exists`);
  const next = { ...parsed, previewUrl: null, updatedAt: new Date().toISOString() };
  const index = await readIndex();
  const nextIndex: StoredIndex = index
    ? { ...index, themes: [...index.themes, next.id] }
    : { schemaVersion: 1, defaultThemeId: next.id, themes: [next.id] };
  await writeJson(themeKey(next.id), next);
  await writeIndex(nextIndex);
  return next;
}

export async function updateHtmlTheme(themeId: string, draft: unknown, expectedUpdatedAt: unknown): Promise<HtmlTheme> {
  const id = assertSafeHtmlThemeId(themeId);
  const current = await readHtmlTheme(id);
  if (!current) throw new Error("HTML_THEME_NOT_FOUND");
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt !== current.updatedAt) throw new Error("HTML_THEME_CONFLICT");
  const parsed = parseHtmlTheme(draft) as HtmlTheme;
  if (parsed.id !== id) throw new Error("Theme id cannot be changed");
  const next = { ...parsed, updatedAt: new Date().toISOString() };
  await writeJson(themeKey(id), next);
  return next;
}

export async function deleteHtmlTheme(themeId: string): Promise<HtmlThemeRegistry> {
  const id = assertSafeHtmlThemeId(themeId);
  const index = await readIndex();
  if (!index) throw new Error("HTML_THEME_NOT_FOUND");
  const next = deleteFromHtmlThemeIndex(index, id) as StoredIndex;
  await writeIndex(next);
  await deletePrefix(`${HTML_THEMES_PREFIX}/${id}/`);
  return listHtmlThemeRegistry();
}

export async function seedHtmlThemes(): Promise<HtmlThemeRegistry> {
  const index = await readIndex();
  const existing = new Set(index?.themes ?? []);
  const ids = [...(index?.themes ?? [])];
  for (const starter of STARTER_HTML_THEMES) {
    const theme = parseHtmlTheme(starter) as HtmlTheme;
    if (existing.has(theme.id) || await objectExists(themeKey(theme.id))) {
      if (!existing.has(theme.id)) ids.push(theme.id);
      continue;
    }
    await writeJson(themeKey(theme.id), theme);
    ids.push(theme.id);
  }
  const defaultThemeId = ids.includes(index?.defaultThemeId ?? "")
    ? index!.defaultThemeId
    : ids.includes(DEFAULT_HTML_THEME_ID) ? DEFAULT_HTML_THEME_ID : ids[0];
  if (!defaultThemeId) throw new Error("No starter HTML themes are configured");
  await writeIndex({ schemaVersion: 1, defaultThemeId, themes: ids });
  return listHtmlThemeRegistry();
}

export async function saveHtmlThemePreview(themeId: string, png: Buffer): Promise<HtmlTheme> {
  const id = assertSafeHtmlThemeId(themeId);
  const current = await readHtmlTheme(id);
  if (!current) throw new Error("HTML_THEME_NOT_FOUND");
  const previewUrl = await putObject(`${HTML_THEMES_PREFIX}/${id}/preview.png`, png, "image/png");
  const next = { ...current, previewUrl, updatedAt: new Date().toISOString() };
  await writeJson(themeKey(id), next);
  return next;
}
