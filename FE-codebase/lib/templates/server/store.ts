// Server-side template store. Node-only — imported by the template engine's
// API routes and by scripts/build-templates.mjs' TypeScript twin.
//
// Layout sources live one-file-per-layout under
//   public/templates/<theme>/layouts/<id>.json
// and are merged into the theme's template.json, which stays the single file
// the renderer and the generator load. Keeping the source split means a saved
// template produces a reviewable diff instead of a one-line churn in a 500KB
// bundle; keeping the merged bundle means nothing downstream had to change.

import { promises as fs } from "node:fs";
import path from "node:path";

export type StoredLayout = Record<string, unknown> & { id: string };

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const LAYOUT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

export function templatesRoot(): string {
  return path.join(process.cwd(), "public", "templates");
}

/** Rejects anything that could escape the templates directory. Ids come from
 *  the browser, so this is a boundary check, not a formatting nicety. */
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

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function listThemeIds(): Promise<string[]> {
  const entries = await fs.readdir(templatesRoot(), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && THEME_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function writeThemeIndex(): Promise<string[]> {
  const themes = await listThemeIds();
  await writeJson(path.join(templatesRoot(), "index.json"), { themes });
  return themes;
}

export type SaveLayoutInput = {
  themeId: string;
  layout: StoredLayout;
};

/** Writes the layout source file, then rebuilds the theme bundle. */
export async function saveLayout({
  themeId,
  layout,
}: SaveLayoutInput): Promise<{ layoutId: string; layoutCount: number }> {
  assertSafeThemeId(themeId);
  const layoutId = assertSafeLayoutId(layout.id);

  const themeDir = path.join(templatesRoot(), themeId);
  await writeJson(path.join(themeDir, "layouts", `${layoutId}.json`), layout);
  const layoutCount = await rebuildThemeBundle(themeId);
  return { layoutId, layoutCount };
}

export async function deleteLayout(
  themeId: string,
  layoutId: string,
): Promise<number> {
  assertSafeThemeId(themeId);
  assertSafeLayoutId(layoutId);
  const sourcePath = path.join(
    templatesRoot(),
    themeId,
    "layouts",
    `${layoutId}.json`,
  );
  await fs.rm(sourcePath, { force: true });
  return rebuildThemeBundle(themeId, { drop: [layoutId] });
}

/** Removes a whole theme folder — layouts, static assets and all.
 *
 *  Irreversible on disk, so the caller is expected to have confirmed it. The
 *  last theme is refused: the editor's blank-deck path and the generator both
 *  assume at least one theme exists. */
export async function deleteTheme(themeId: string): Promise<string[]> {
  assertSafeThemeId(themeId);
  const remaining = (await listThemeIds()).filter((id) => id !== themeId);
  if (remaining.length === 0) {
    throw new Error("Cannot delete the last remaining theme.");
  }
  await fs.rm(path.join(templatesRoot(), themeId), {
    recursive: true,
    force: true,
  });
  return writeThemeIndex();
}

/** Merges layouts/*.json over the theme's existing template.json.
 *
 *  The four shipped themes have their layouts inline with no per-file source,
 *  so the merge is additive-by-id rather than a wholesale replace: inline
 *  layouts survive until someone re-saves them from the engine, at which point
 *  the file version wins. */
export async function rebuildThemeBundle(
  themeId: string,
  options: { drop?: string[] } = {},
): Promise<number> {
  assertSafeThemeId(themeId);
  const themeDir = path.join(templatesRoot(), themeId);
  const bundlePath = path.join(themeDir, "template.json");

  const bundle =
    (await readJson<Record<string, unknown>>(bundlePath)) ?? ({} as Record<string, unknown>);
  const meta = await readJson<Record<string, unknown>>(
    path.join(themeDir, "theme.json"),
  );

  const inline = Array.isArray(bundle.layouts)
    ? (bundle.layouts as Record<string, unknown>[]).filter(
        (layout) => layout && typeof layout === "object",
      )
    : [];

  let sourceFiles: string[] = [];
  try {
    sourceFiles = (await fs.readdir(path.join(themeDir, "layouts"))).filter(
      (file) => file.endsWith(".json"),
    );
  } catch {
    sourceFiles = [];
  }

  const authored = new Map<string, Record<string, unknown>>();
  for (const file of sourceFiles.sort()) {
    const layout = await readJson<Record<string, unknown>>(
      path.join(themeDir, "layouts", file),
    );
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

  await writeJson(bundlePath, {
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
  const metaPath = path.join(templatesRoot(), themeId, "theme.json");
  const current = (await readJson<Record<string, unknown>>(metaPath)) ?? {
    id: themeId,
  };
  const next = { ...current, ...patch, id: themeId };
  await writeJson(metaPath, next);
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
  const themeDir = path.join(templatesRoot(), themeId);

  try {
    await fs.access(themeDir);
    throw new Error(`Theme "${themeId}" already exists`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }

  await fs.mkdir(path.join(themeDir, "layouts"), { recursive: true });
  await fs.mkdir(path.join(themeDir, "static"), { recursive: true });
  await writeJson(path.join(themeDir, "theme.json"), {
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
  await writeJson(path.join(themeDir, "template.json"), {
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
