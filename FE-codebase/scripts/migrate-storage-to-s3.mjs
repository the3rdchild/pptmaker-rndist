// One-off migration: public/templates and public/elements -> object storage.
//
//   node scripts/migrate-storage-to-s3.mjs [--dry-run]
//
// Uploads every theme and element that used to ship in the repo, rewriting the
// pack-absolute asset paths stored inside the JSON (`/templates/<theme>/…`,
// `/elements/<category>/…`) into absolute CDN URLs as it goes — the runtime
// resolver passes absolute URLs straight through, so once rewritten nothing
// downstream has to know where an asset lives.
//
// Safe to re-run: every object is written by key, so a second pass overwrites
// rather than duplicates. Kept in the repo after the fact as the record of how
// the bucket was populated.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const dryRun = process.argv.includes("--dry-run");

// Next.js loads .env.local for us at runtime; a bare node script has to do it.
async function loadEnv() {
  const raw = await fs.readFile(path.join(here, "..", ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
await loadEnv();

const bucket = process.env.CDN_BUCKET_NAME;
const publicBase = (process.env.CDN_PUBLIC_URL ?? "").replace(/\/+$/, "");
const useObjectAcl = process.env.S3_USE_OBJECT_ACL === "true";

if (!bucket || !publicBase) {
  console.error("CDN_BUCKET_NAME and CDN_PUBLIC_URL must be set in .env.local");
  process.exit(1);
}

const s3 = new S3Client({
  endpoint: process.env.CDN_ENDPOINT,
  region: process.env.CDN_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.CDN_ACCESS_KEY_ID,
    secretAccessKey: process.env.CDN_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const CONTENT_TYPES = {
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

let uploaded = 0;
let bytes = 0;

async function put(key, body, contentType) {
  bytes += body.length;
  uploaded += 1;
  if (dryRun) {
    console.log(`  would upload ${key} (${body.length} bytes)`);
    return;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(useObjectAcl && { ACL: "public-read" }),
    }),
  );
}

/** Turns the pack-absolute paths stored in template/element JSON into absolute
 *  CDN URLs. Only leading-slash forms are touched, so an already-absolute
 *  https:// asset or a data: URL is left alone. */
function rewriteAssetPaths(text) {
  return text
    .replaceAll('"/templates/', `"${publicBase}/templates/`)
    .replaceAll('"/elements/', `"${publicBase}/elements/`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function migrate(folder) {
  const root = path.join(publicDir, folder);
  try {
    await fs.access(root);
  } catch {
    console.log(`${folder}/ — nothing to migrate`);
    return;
  }

  const files = await walk(root);
  console.log(`\n${folder}/ — ${files.length} files`);

  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const key = `${folder}/${relative}`;
    const extension = path.extname(file).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";

    if (extension === ".json") {
      const text = rewriteAssetPaths(await fs.readFile(file, "utf8"));
      await put(key, Buffer.from(text, "utf8"), contentType);
    } else {
      await put(key, await fs.readFile(file), contentType);
    }
  }
}

await migrate("templates");
await migrate("elements");

// Rewrite the theme index from what is actually on disk, so a theme that was
// never committed (and so never made it into the old index.json) still lands.
const templatesRoot = path.join(publicDir, "templates");
try {
  const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  const themes = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  await put(
    "templates/index.json",
    Buffer.from(`${JSON.stringify({ themes }, null, 2)}\n`, "utf8"),
    "application/json",
  );
  console.log(`\nthemes indexed: ${themes.join(", ")}`);
} catch {
  console.log("\nno templates directory — index not written");
}

console.log(
  `\n${dryRun ? "[dry run] " : ""}${uploaded} objects, ` +
    `${(bytes / 1024 / 1024).toFixed(1)}MB`,
);
