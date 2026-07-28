#!/usr/bin/env node
// Rebuilds every theme bundle from its sources.
//
//   public/templates/<theme>/theme.json      hand-authored theme metadata
//   public/templates/<theme>/layouts/*.json  one file per layout (template engine)
//        ->  public/templates/<theme>/template.json   the bundle everything loads
//        ->  public/templates/index.json              the theme list
//
// The template engine already rebuilds the bundle on every save, so this is
// for the cases it can't cover: a layout file edited by hand, a theme folder
// copied in from elsewhere, or a fresh checkout that needs index.json.
//
// Usage: node scripts/build-templates.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.join(here, "..", "public", "templates");
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/;

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listThemeIds() {
  const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && THEME_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function rebuildTheme(themeId) {
  const themeDir = path.join(templatesRoot, themeId);
  const bundlePath = path.join(themeDir, "template.json");
  const bundle = (await readJson(bundlePath)) ?? {};
  const meta = await readJson(path.join(themeDir, "theme.json"));

  const inline = Array.isArray(bundle.layouts)
    ? bundle.layouts.filter((layout) => layout && typeof layout === "object")
    : [];

  let files = [];
  try {
    files = (await fs.readdir(path.join(themeDir, "layouts")))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch {
    files = [];
  }

  const authored = new Map();
  for (const file of files) {
    const layout = await readJson(path.join(themeDir, "layouts", file));
    if (layout && typeof layout.id === "string") authored.set(layout.id, layout);
  }

  // Authored files win over the inline copy of the same id; inline layouts with
  // no file source are preserved so the shipped themes survive a rebuild.
  const merged = [];
  const seen = new Set();
  for (const layout of inline) {
    if (typeof layout.id !== "string") continue;
    merged.push(authored.get(layout.id) ?? layout);
    seen.add(layout.id);
  }
  for (const [id, layout] of authored) {
    if (!seen.has(id)) merged.push(layout);
  }

  await writeJson(bundlePath, {
    ...bundle,
    id: bundle.id ?? themeId,
    name: meta?.name ?? bundle.name ?? themeId,
    description: meta?.description ?? bundle.description ?? "",
    layouts: merged,
  });

  return { themeId, layouts: merged.length, fromFiles: authored.size };
}

const themes = await listThemeIds();
for (const themeId of themes) {
  const result = await rebuildTheme(themeId);
  console.log(
    `${result.themeId}: ${result.layouts} layouts (${result.fromFiles} from layouts/*.json)`,
  );
}
await writeJson(path.join(templatesRoot, "index.json"), { themes });
console.log(`index.json: ${themes.join(", ")}`);
