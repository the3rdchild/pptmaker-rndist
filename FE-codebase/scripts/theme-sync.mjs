// Pull a theme's authored JSON out of the bucket, edit it locally, push it back.
//
//   node scripts/theme-sync.mjs pull <theme>
//   node scripts/theme-sync.mjs push <theme> [--dry-run]
//
// Slot labelling is a bulk edit — naming 178 elements and giving 108 of them a
// role and fill condition, as the cassual theme took — and that is a text edit
// across a dozen files, not something to do a field at a time through the UI.
// While the layouts lived in the repo an editor could just open them. Now they
// live in object storage, so this pulls them down to
// FE-codebase/.theme-work/<theme>/ and puts them back.
//
// Pull reads the bucket directly. Push goes through the running dev server's
// /api/template-engine/layouts, because that endpoint already merges the
// layout sources into template.json — reimplementing that merge here would be
// a second copy of the rule that decides which version of a layout wins.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const here = path.dirname(fileURLToPath(import.meta.url));
const workRoot = path.join(here, "..", ".theme-work");

const [, , command, themeId, ...rest] = process.argv;
const dryRun = rest.includes("--dry-run");
const devServer = process.env.DEV_SERVER_URL ?? "http://localhost:3000";

if (!["pull", "push"].includes(command) || !themeId) {
  console.error("usage: node scripts/theme-sync.mjs <pull|push> <theme> [--dry-run]");
  process.exit(1);
}

async function loadEnv() {
  const raw = await fs.readFile(path.join(here, "..", ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
await loadEnv();

const bucket = process.env.CDN_BUCKET_NAME;
const s3 = new S3Client({
  endpoint: process.env.CDN_ENDPOINT,
  region: process.env.CDN_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.CDN_ACCESS_KEY_ID,
    secretAccessKey: process.env.CDN_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const themeDir = path.join(workRoot, themeId);

async function pull() {
  const prefix = `templates/${themeId}/`;
  const keys = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      // Only the authored sources. template.json is generated on push, and the
      // static images are not something to hand-edit.
      if (!object.Key.endsWith(".json")) continue;
      if (object.Key.endsWith("/template.json")) continue;
      keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  if (keys.length === 0) {
    console.error(`No theme "${themeId}" in the bucket.`);
    process.exit(1);
  }

  for (const key of keys) {
    const relative = key.slice(prefix.length);
    const target = path.join(themeDir, relative);
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await result.Body.transformToString();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, "utf8");
    console.log(`  ${relative}`);
  }
  console.log(`\npulled ${keys.length} files -> ${path.relative(process.cwd(), themeDir)}`);
}

async function push() {
  const layoutsDir = path.join(themeDir, "layouts");
  let files = [];
  try {
    files = (await fs.readdir(layoutsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`Nothing pulled yet — run: node scripts/theme-sync.mjs pull ${themeId}`);
    process.exit(1);
  }

  // theme.json first: the bundle rebuild copies name/description off it, so
  // pushing it after the layouts would leave the bundle a step behind.
  const metaPath = path.join(themeDir, "theme.json");
  try {
    const patch = JSON.parse(await fs.readFile(metaPath, "utf8"));
    if (!dryRun) {
      const res = await fetch(`${devServer}/api/template-engine/themes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId, patch }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    }
    console.log("  theme.json");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`theme.json failed: ${error.message}`);
      process.exit(1);
    }
  }

  for (const file of files.sort()) {
    const layout = JSON.parse(await fs.readFile(path.join(layoutsDir, file), "utf8"));
    if (dryRun) {
      console.log(`  would push ${file} (${layout.id})`);
      continue;
    }
    const res = await fetch(`${devServer}/api/template-engine/layouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId, layout }),
    });
    if (!res.ok) {
      console.error(`\n${file} failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    console.log(`  ${file} -> ${(await res.json()).layoutId}`);
  }

  console.log(
    `\n${dryRun ? "[dry run] " : ""}pushed ${files.length} layouts. ` +
      "template.json rebuilt by the server.",
  );
}

if (command === "pull") {
  console.log(`pulling ${themeId} from ${bucket}`);
  await pull();
} else {
  console.log(`pushing ${themeId} via ${devServer}`);
  await push();
}
