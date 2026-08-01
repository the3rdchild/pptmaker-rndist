// Server-side store for the custom element library.
//
//   elements/index.json          the manifest (categories + items)
//   elements/<category>/<file>   the uploaded asset
//
// Assets live in the storage bucket alongside the themes: they are collected
// once and reused across every deck and template, so they outlive any single
// deck, and a deployed instance has no writable repo to put them in.
//
// Everything here is public-read for now. The intended split once this leaves
// RnD is documented in docs/storage-staging-notes.md — template-engine
// elements stay public, per-user uploads from the editor become private.

import {
  deleteObjects,
  publicUrl,
  putObject,
  readJson,
  writeJson,
} from "@/lib/storage/s3";

export type ElementItem = {
  id: string;
  label: string;
  /** Absolute CDN URL, e.g. https://…/elements/abstract/blob-1.svg */
  src: string;
  width: number;
  height: number;
};

export type ElementCategory = {
  id: string;
  label: string;
  items: ElementItem[];
};

export type ElementLibrary = { categories: ElementCategory[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,60}$/;

/** Key prefix for everything this store owns. */
const ELEMENTS_PREFIX = "elements";

const MANIFEST_KEY = `${ELEMENTS_PREFIX}/index.json`;

/** Extensions the editor can actually render as an image element. */
const MIME_EXTENSIONS: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_BYTES = 2 * 1024 * 1024;

export function assertSafeId(value: string, what: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}

export async function readLibrary(): Promise<ElementLibrary> {
  const parsed = await readJson<{ categories?: unknown }>(MANIFEST_KEY);
  const categories = Array.isArray(parsed?.categories) ? parsed.categories : [];
  return { categories: categories as ElementCategory[] };
}

async function writeLibrary(library: ElementLibrary): Promise<void> {
  await writeJson(MANIFEST_KEY, library);
}

export type SaveElementInput = {
  categoryId: string;
  categoryLabel?: string;
  label: string;
  dataUrl: string;
  width?: number;
  height?: number;
};

/** Decodes a `data:<mime>;base64,<payload>` upload. Rejects anything that is
 *  not an image type the editor can render, so a stray file can't be stored
 *  under an arbitrary extension and served back as something else. */
function decodeDataUrl(dataUrl: string): { bytes: Buffer; extension: string } {
  // [\s\S] rather than the `s` flag — the build targets below ES2018.
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 data URL");

  const [, mime, payload] = match;
  const extension = MIME_EXTENSIONS[mime.toLowerCase()];
  if (!extension) {
    throw new Error(
      `Unsupported file type "${mime}". Use SVG, PNG, JPEG, WebP or GIF.`,
    );
  }

  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0) throw new Error("The file is empty");
  if (bytes.length > MAX_BYTES) {
    throw new Error(
      `File is ${(bytes.length / 1024 / 1024).toFixed(1)}MB — the limit is 2MB.`,
    );
  }
  return { bytes, extension };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Ensures the slug is unique inside its category so an upload never silently
 *  overwrites an element already in use by a saved template. */
function uniqueId(base: string, taken: Set<string>): string {
  const seed = base || "element";
  if (!taken.has(seed)) return seed;
  let n = 2;
  while (taken.has(`${seed}-${n}`)) n += 1;
  return `${seed}-${n}`;
}

export async function saveElement(
  input: SaveElementInput,
): Promise<{ category: ElementCategory; item: ElementItem }> {
  const categoryId = assertSafeId(slugify(input.categoryId), "category id");
  const label = input.label.trim() || "Untitled element";
  const { bytes, extension } = decodeDataUrl(input.dataUrl);

  const library = await readLibrary();
  let category = library.categories.find((entry) => entry.id === categoryId);
  if (!category) {
    category = {
      id: categoryId,
      label: (input.categoryLabel ?? input.categoryId).trim() || categoryId,
      items: [],
    };
    library.categories.push(category);
  }

  const id = uniqueId(
    slugify(label),
    new Set(category.items.map((item) => item.id)),
  );
  const filename = `${id}.${extension}`;

  const src = await putObject(
    `${ELEMENTS_PREFIX}/${categoryId}/${filename}`,
    bytes,
  );

  const item: ElementItem = {
    id,
    label,
    src,
    width: Math.max(1, Math.round(input.width ?? 200)),
    height: Math.max(1, Math.round(input.height ?? 200)),
  };
  category.items.push(item);
  await writeLibrary(library);

  return { category, item };
}

/** Recovers the object key from a stored item. Items written before the move
 *  to object storage hold a `/elements/…` path rather than a CDN URL, so both
 *  shapes have to resolve. */
function keyOf(item: ElementItem): string | null {
  const marker = `/${ELEMENTS_PREFIX}/`;
  const at = item.src.indexOf(marker);
  return at === -1 ? null : item.src.slice(at + 1);
}

export async function deleteElement(
  categoryId: string,
  itemId: string,
): Promise<ElementLibrary> {
  assertSafeId(categoryId, "category id");
  assertSafeId(itemId, "element id");

  const library = await readLibrary();
  const category = library.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);

  const item = category.items.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`Unknown element: ${itemId}`);

  const key = keyOf(item);
  if (key) await deleteObjects([key]);

  category.items = category.items.filter((entry) => entry.id !== itemId);
  // An emptied category would otherwise linger as a dead filter chip. There is
  // no folder to remove alongside it — S3 has no empty directories.
  if (category.items.length === 0) {
    library.categories = library.categories.filter(
      (entry) => entry.id !== categoryId,
    );
  }

  await writeLibrary(library);
  return library;
}

export async function renameCategory(
  categoryId: string,
  label: string,
): Promise<ElementLibrary> {
  assertSafeId(categoryId, "category id");
  const library = await readLibrary();
  const category = library.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new Error(`Unknown category: ${categoryId}`);
  category.label = label.trim() || category.label;
  await writeLibrary(library);
  return library;
}

export { publicUrl as elementPublicUrl };
