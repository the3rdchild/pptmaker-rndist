// S3-compatible object storage for templates and elements.
//
// This is the FE's own client rather than a call into the `api` service: every
// write path that needs it (the template engine routes, the element library)
// already runs inside a Next.js route handler, so proxying would only add a
// hop and send each upload over the wire twice.
//
// Two provider quirks are baked in here so callers never have to think about
// them:
//
//   * forcePathStyle — the bucket name may contain dots, and the virtual-host
//     URL form (bucket.region.provider.com) then fails TLS validation against
//     the provider's wildcard cert. Path style keeps the bucket in the path.
//   * S3_USE_OBJECT_ACL — DigitalOcean Spaces and AWS S3 store objects private
//     unless the PUT carries a public-read ACL. Cloudflare R2 and MinIO reject
//     the ACL parameter outright, hence the flag rather than always sending it.

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.CDN_ENDPOINT ?? "";
const bucket = process.env.CDN_BUCKET_NAME ?? "";
const publicBase = (process.env.CDN_PUBLIC_URL ?? "").replace(/\/+$/, "");
const useObjectAcl = process.env.S3_USE_OBJECT_ACL === "true";

let client: S3Client | null = null;

/** Every store calls this before touching the bucket so a missing .env
 *  surfaces as one clear message instead of an SDK credentials stack trace. */
export function assertStorageConfigured(): void {
  const missing = [
    ["CDN_ENDPOINT", endpoint],
    ["CDN_BUCKET_NAME", bucket],
    ["CDN_PUBLIC_URL", publicBase],
    ["CDN_ACCESS_KEY_ID", process.env.CDN_ACCESS_KEY_ID],
    ["CDN_SECRET_ACCESS_KEY", process.env.CDN_SECRET_ACCESS_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Object storage is not configured — missing ${missing.join(", ")}. ` +
        "Templates and elements live in the bucket, so nothing can be read " +
        "or saved until these are set in .env.local.",
    );
  }
}

function s3(): S3Client {
  assertStorageConfigured();
  if (!client) {
    client = new S3Client({
      endpoint,
      region: process.env.CDN_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.CDN_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.CDN_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: true,
    });
  }
  return client;
}

/** The browser-facing URL for a key. Stored inside layout and element JSON, so
 *  it has to stay stable — changing CDN_PUBLIC_URL invalidates saved decks. */
export function publicUrl(key: string): string {
  return `${publicBase}/${key.replace(/^\/+/, "")}`;
}

const CONTENT_TYPES: Record<string, string> = {
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function contentTypeFor(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export async function putObject(
  key: string,
  body: Buffer | string,
  contentType = contentTypeFor(key),
): Promise<string> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(useObjectAcl && { ACL: "public-read" }),
    }),
  );
  return publicUrl(key);
}

/** Returns null when the key is absent — callers treat "no object" and
 *  "unreadable object" the same way, the same as the old fs.readFile catch. */
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const result = await s3().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(key: string): Promise<T | null> {
  const bytes = await getObject(key);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await putObject(
    key,
    `${JSON.stringify(value, null, 2)}\n`,
    "application/json",
  );
}

/** All keys under a prefix, paging through the 1000-key response limit. */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

/** The immediate "folder" names under a prefix. S3 has no directories, so this
 *  reads the common prefixes the provider derives from the "/" delimiter. */
export async function listFolders(prefix: string): Promise<string[]> {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const folders: string[] = [];
  let token: string | undefined;

  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalized,
        Delimiter: "/",
        ContinuationToken: token,
      }),
    );
    for (const entry of page.CommonPrefixes ?? []) {
      const name = entry.Prefix?.slice(normalized.length).replace(/\/$/, "");
      if (name) folders.push(name);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  return folders;
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}

/** Deletes a whole "folder" — the equivalent of the old fs.rm({recursive}). */
export async function deletePrefix(prefix: string): Promise<void> {
  await deleteObjects(await listKeys(prefix));
}
