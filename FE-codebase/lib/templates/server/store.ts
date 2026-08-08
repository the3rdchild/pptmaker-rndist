// Server-side template store. Node-only — imported by the template engine's
// API routes.
//
// Themes live in the object storage bucket, not in the repo:
//   templates/index.json                       the theme list
//   templates/<theme>/theme.json               hand-authored metadata
//   templates/<theme>/layouts/<id>.json        one file per layout
//   templates/<theme>/template.json            the merged bundle everything loads
//   templates/<theme>/static/<folder>/<file>   theme assets
//
// Keeping the layout sources split still costs nothing and keeps a re-save
// from rewriting a 500KB bundle wholesale; keeping the merged bundle means the
// renderer and the generator did not have to change.

import { createHash } from "node:crypto";

import {
  deleteObjects,
  deletePrefix,
  listFolders,
  listKeys,
  objectExists,
  publicUrl,
  putObject,
  readJson,
  writeJson,
} from "@/lib/storage/s3";
import type { TemplateTheme } from "@/lib/templates/themes";

export type StoredLayout = Record<string, unknown> & { id: string };

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const LAYOUT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

/** Key prefix for everything this store owns. */
export const TEMPLATES_PREFIX = "templates";

export function themeKey(themeId: string, ...parts: string[]): string {
  return [TEMPLATES_PREFIX, themeId, ...parts].join("/");
}

/** Rejects anything that could escape the templates prefix. Ids come from the
 *  browser, so this is a boundary check, not a formatting nicety. */
export function assertSafeThemeId(themeId: string): string {
  if (!THEME_ID_PATTERN.test(themeId)) {
    throw new Error(`Invalid theme id: ${JSON.stringify(themeId)}`);
  }
  return themeId;
}

export function assertSafeLayoutId(layoutId: string): string {
  if (!LAYOUT_ID_PATTERN.test(layoutId)) {
    throw new Error(`Invalid layout id: ${JSON.stringify(layoutId)}`);
  }
  return layoutId;
}

export async function listThemeIds(): Promise<string[]> {
  const folders = await listFolders(TEMPLATES_PREFIX);
  return folders.filter((name) => THEME_ID_PATTERN.test(name)).sort();
}

/** Reads one theme's merged bundle + hand-authored metadata into the
 *  TemplateTheme shape the manifest builders consume. Shared by the manifest
 *  route and the theme-choice step so both describe themes identically. */
export async function readTheme(themeId: string): Promise<TemplateTheme | null> {
  const bundle = await readJson<Record<string, unknown>>(
    themeKey(themeId, "template.json"),
  );
  if (!bundle) return null;

  const meta =
    (await readJson<Record<string, unknown>>(themeKey(themeId, "theme.json"))) ??
    {};

  return {
    id: themeId,
    name: (meta.name as string) ?? (bundle.name as string) ?? themeId,
    description:
      (meta.description as string) ?? (bundle.description as string) ?? "",
    thumbnail: (bundle.thumbnail as string | null) ?? null,
    fonts: (bundle.fonts as TemplateTheme["fonts"]) ?? null,
    ai: (meta.ai as TemplateTheme["ai"]) ?? null,
    palette: (meta.palette as TemplateTheme["palette"]) ?? null,
    layouts: Array.isArray(bundle.layouts) ? bundle.layouts : [],
    mergedComponents: [],
  };
}

/** Rewrites templates/index.json from what is actually in the bucket.
 *
 *  Safe as a plain read-modify-write because authoring happens in
 *  /template-engine, which exactly one person has access to — there is no
 *  second writer to race with. Revisit if that ever stops being true. */
export async function writeThemeIndex(): Promise<string[]> {
  const themes = await listThemeIds();
  await writeJson(`${TEMPLATES_PREFIX}/index.json`, { themes });
  return themes;
}

/** Extensions a theme asset may be written with. Imported decks bring their
 *  media along, so the file type is whitelisted rather than taken from
 *  whatever the caller claims. */
const ASSET_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export function assetExtensionFor(mimeType: string): string | null {
  return ASSET_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

/** Uploads one image under `<theme>/static/<folder>/` with a content-addressed
 *  name and returns its public URL.
 *
 *  Content addressing is what keeps an imported deck small: a Canva export
 *  references the same tile image from hundreds of shapes across every slide,
 *  and they all collapse onto one object here instead of one base64 copy per
 *  reference in the layout JSON. */
export async function saveThemeAsset({
  themeId,
  bytes,
  extension,
  folder = "imported",
}: {
  themeId: string;
  bytes: Buffer;
  extension: string;
  folder?: string;
}): Promise<{ url: string; bytes: number; reused: boolean }> {
  assertSafeThemeId(themeId);
  if (!Object.values(ASSET_EXTENSIONS).includes(extension)) {
    throw new Error(`Unsupported asset type: ${extension}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,48}$/.test(folder)) {
    throw new Error(`Invalid asset folder: ${JSON.stringify(folder)}`);
  }

  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const key = themeKey(themeId, "static", folder, `${digest}.${extension}`);

  // The HEAD costs a round trip but saves re-uploading a duplicate tile
  // hundreds of times over during a single deck import.
  if (await objectExists(key)) {
    return { url: publicUrl(key), bytes: bytes.length, reused: true };
  }

  const url = await putObject(key, bytes);
  return { url, bytes: bytes.length, reused: false };
}

export type SaveLayoutInput = {
  themeId: string;
  layout: StoredLayout;
};

/** Writes the layout source object, then rebuilds the theme bundle. */
export async function saveLayout({
  themeId,
  layout,
}: SaveLayoutInput): Promise<{ layoutId: string; layoutCount: number }> {
  assertSafeThemeId(themeId);
  const layoutId = assertSafeLayoutId(layout.id);

  await writeJson(themeKey(themeId, "layouts", `${layoutId}.json`), layout);
  const layoutCount = await rebuildThemeBundle(themeId);
  return { layoutId, layoutCount };
}

export async function deleteLayout(
  themeId: string,
  layoutId: string,
): Promise<number> {
  assertSafeThemeId(themeId);
  assertSafeLayoutId(layoutId);
  await deleteObjects([themeKey(themeId, "layouts", `${layoutId}.json`)]);
  return rebuildThemeBundle(themeId, { drop: [layoutId] });
}

/** Removes a whole theme — layouts, static assets and all.
 *
 *  Irreversible, so the caller is expected to have confirmed it. The last
 *  theme is refused: the editor's blank-deck path and the generator both
 *  assume at least one theme exists. */
export async function deleteTheme(themeId: string): Promise<string[]> {
  assertSafeThemeId(themeId);
  const remaining = (await listThemeIds()).filter((id) => id !== themeId);
  if (remaining.length === 0) {
    throw new Error("Cannot delete the last remaining theme.");
  }
  await deletePrefix(`${themeKey(themeId)}/`);
  return writeThemeIndex();
}

/** Merges layouts/*.json over the theme's existing template.json.
 *
 *  Themes migrated from the old repo folders have their layouts inline with no
 *  per-file source, so the merge is additive-by-id rather than a wholesale
 *  replace: inline layouts survive until someone re-saves them from the
 *  engine, at which point the file version wins. */
export async function rebuildThemeBundle(
  themeId: string,
  options: { drop?: string[] } = {},
): Promise<number> {
  assertSafeThemeId(themeId);
  const bundleKey = themeKey(themeId, "template.json");

  const bundle =
    (await readJson<Record<string, unknown>>(bundleKey)) ??
    ({} as Record<string, unknown>);
  const meta = await readJson<Record<string, unknown>>(
    themeKey(themeId, "theme.json"),
  );

  const inline = Array.isArray(bundle.layouts)
    ? (bundle.layouts as Record<string, unknown>[]).filter(
        (layout) => layout && typeof layout === "object",
      )
    : [];

  const sourceKeys = (
    await listKeys(`${themeKey(themeId, "layouts")}/`)
  ).filter((key) => key.endsWith(".json"));

  const authored = new Map<string, Record<string, unknown>>();
  for (const key of sourceKeys.sort()) {
    const layout = await readJson<Record<string, unknown>>(key);
    const id = typeof layout?.id === "string" ? layout.id : null;
    if (layout && id) authored.set(id, layout);
  }

  const dropped = new Set(options.drop ?? []);
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const layout of inline) {
    const id = typeof layout.id === "string" ? layout.id : null;
    if (!id || dropped.has(id)) continue;
    merged.push(authored.get(id) ?? layout);
    seen.add(id);
  }
  for (const [id, layout] of authored) {
    if (seen.has(id) || dropped.has(id)) continue;
    merged.push(layout);
  }

  await writeJson(bundleKey, {
    ...bundle,
    id: bundle.id ?? themeId,
    name: meta?.name ?? bundle.name ?? themeId,
    description: meta?.description ?? bundle.description ?? "",
    layouts: merged,
  });

  return merged.length;
}

/** Merges hand-authored theme metadata (palette, AI guidance) into theme.json
 *  and refreshes the bundle so name/description stay in step. */
export async function updateThemeMeta(
  themeId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertSafeThemeId(themeId);
  const metaKey = themeKey(themeId, "theme.json");
  const current = (await readJson<Record<string, unknown>>(metaKey)) ?? {
    id: themeId,
  };
  const next = { ...current, ...patch, id: themeId };
  await writeJson(metaKey, next);
  await rebuildThemeBundle(themeId);
  return next;
}

export type CreateThemeInput = {
  themeId: string;
  name: string;
  description: string;
};

export async function createTheme({
  themeId,
  name,
  description,
}: CreateThemeInput): Promise<void> {
  assertSafeThemeId(themeId);

  // A theme has no folder of its own to test for — theme.json is what makes it
  // exist, so that is the key the duplicate check looks at.
  if (await objectExists(themeKey(themeId, "theme.json"))) {
    throw new Error(`Theme "${themeId}" already exists`);
  }

  await writeJson(themeKey(themeId, "theme.json"), {
    id: themeId,
    name,
    description,
    ai: {
      when_to_use: "",
      avoid_when: "",
      tone: [],
      keywords: [],
    },
    palette: {},
  });
  await writeJson(themeKey(themeId, "template.json"), {
    id: themeId,
    name,
    description,
    thumbnail: null,
    merged_components: [],
    layouts: [],
    fonts: {},
  });
  await writeThemeIndex();
}
