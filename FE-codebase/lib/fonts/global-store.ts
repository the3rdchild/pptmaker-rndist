// Global (theme-independent) font library.
//
// Registry: templates/fonts.json → { family: cdnUrl }
// Binaries:  templates/_fonts/<sha16>.<ext> — content-addressed, like theme
//            assets, so the same file uploaded under two names shares one
//            object.
//
// The "_fonts" folder can never collide with a theme: THEME_ID_PATTERN
// requires an alphanumeric first character, so listThemeIds never surfaces
// it. Registry values are raw CDN URLs (same contract as template.json —
// proxyAssetUrl rewrites them at the response layer, storage never changes).

import { createHash } from "node:crypto";

import {
  deleteObjects,
  keyFromPublicUrl,
  objectExists,
  publicUrl,
  putObject,
  readJson,
  writeJson,
} from "@/lib/storage/s3";
import { TEMPLATES_PREFIX } from "@/lib/templates/server/store";

const REGISTRY_KEY = `${TEMPLATES_PREFIX}/fonts.json`;
const BINARY_PREFIX = `${TEMPLATES_PREFIX}/_fonts`;

const FONT_EXTENSIONS = new Set(["woff2", "woff", "ttf", "otf"]);

export async function listGlobalFonts(): Promise<Record<string, string>> {
  const raw = await readJson<Record<string, unknown>>(REGISTRY_KEY);
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([family, url]) =>
        family.trim().length > 0 && typeof url === "string" && url.trim().length > 0,
    ),
  ) as Record<string, string>;
}

export async function saveGlobalFont({
  bytes,
  extension,
}: {
  bytes: Buffer;
  extension: string;
}): Promise<{ url: string; bytes: number; reused: boolean }> {
  if (!FONT_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported font type: ${extension}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const key = `${BINARY_PREFIX}/${digest}.${extension}`;
  if (await objectExists(key)) {
    return { url: publicUrl(key), bytes: bytes.length, reused: true };
  }
  const url = await putObject(key, bytes);
  return { url, bytes: bytes.length, reused: false };
}

export async function registerGlobalFont(
  family: string,
  url: string,
): Promise<void> {
  const fonts = await listGlobalFonts();
  fonts[family] = url;
  await writeJson(REGISTRY_KEY, fonts);
}

export async function unregisterGlobalFont(
  family: string,
): Promise<{ removedUrl: string | null }> {
  const fonts = await listGlobalFonts();
  const removedUrl = fonts[family] ?? null;
  if (removedUrl === null) return { removedUrl: null };

  delete fonts[family];
  await writeJson(REGISTRY_KEY, fonts);

  // Only delete the object when no other family still points at it — a
  // content-addressed binary is shared when one file is uploaded twice
  // under different names.
  if (!Object.values(fonts).includes(removedUrl)) {
    const key = keyFromPublicUrl(removedUrl);
    if (key) await deleteObjects([key]);
  }
  return { removedUrl };
}
