# Template & element storage — notes for staging/production

Templates and elements moved out of the repo's `public/` folder into
S3-compatible object storage on 2026-07-31. This is what the RnD phase left
deliberately open, and what has to be decided before this ships further.

## What changed

The app used to write into `public/templates` and `public/elements` at runtime
with `fs.writeFile`. That only works on a dev checkout — writes vanish on a
container redeploy, are invisible to a second replica, and fail outright on a
read-only filesystem. Everything now lives in the bucket:

```
templates/index.json                       theme list
templates/<theme>/theme.json               authored metadata
templates/<theme>/layouts/<id>.json        one file per layout
templates/<theme>/template.json            merged bundle the renderer loads
templates/<theme>/static/<folder>/<file>   theme images
elements/index.json                        element manifest
elements/<category>/<file>                 element assets
```

Nothing ships in the repo any more. The six themes that used to
(`business`, `cassual-2`, `general`, `modern`, `standard`, `swift`) were
uploaded by `FE-codebase/scripts/migrate-storage-to-s3.mjs`, which also
rewrote the pack-absolute asset paths inside the JSON into absolute CDN URLs.

## Open decisions — please do not ship as-is

### 1. Everything is public-read

Every object is uploaded with a `public-read` ACL, including per-user uploads
from the editor. Anyone who knows or guesses a URL can fetch any asset.

The intended split, which was scoped out of RnD:

| Source | Intended visibility |
|---|---|
| Elements imported via `/template-engine` | public — they are shared stock art |
| Per-user uploads from `editor-react` | private, served via presigned URLs |

That needs per-user ownership on element records, which does not exist yet —
`elements/index.json` is a single shared manifest with no owner field.

### 2. The write routes have no authentication

`/api/template-engine/*` and `POST|PATCH|DELETE /api/elements` are gated only
by `lib/templates/server/guard.ts`, which refuses writes in production unless
`TEMPLATE_ENGINE_WRITES=true`. That is a deployment flag, not auth. Anyone who
can reach the instance with the flag on can create, edit and delete any theme.

Put a real auth check in `templateWritesBlocked()` before enabling it anywhere
public.

### 3. `index.json` is a read-modify-write manifest

Both `templates/index.json` and `elements/index.json` are read, mutated and
written back with no locking. This is safe today only because exactly one
person has access to `/template-engine`. The moment a second author exists,
two concurrent saves will silently drop one of them.

Fix by moving the manifest into Postgres (rows, not a blob) or by deriving the
theme list from an S3 `ListObjectsV2` prefix scan instead of a stored file.

### 4. Uploads are proxied through the app

`saveThemeAsset` and `saveElement` receive the bytes in the request body and
forward them to S3. Fine for a single author; at real upload volume, switch to
presigned `PUT` so the browser uploads directly and the server only mints URLs.

## Provider gotchas already hit

Both of these cost real debugging time — they are recorded so nobody repeats it.

### The bucket name contains dots

`testcdndo.staging-pp.com` has dots, so the virtual-host URL form
`bucket.sgp1.digitaloceanspaces.com` fails TLS validation: DigitalOcean's
wildcard cert is `*.sgp1.digitaloceanspaces.com`, and a wildcard matches only
one label. Result is `ERR_TLS_CERT_ALTNAME_INVALID` from both the SDK and the
browser.

Both `CDN_ENDPOINT` and `CDN_PUBLIC_URL` must therefore use the path-style
form, and the S3 client sets `forcePathStyle: true`:

```
CDN_ENDPOINT=https://sgp1.digitaloceanspaces.com
CDN_PUBLIC_URL=https://sgp1.digitaloceanspaces.com/testcdndo.staging-pp.com
```

A bucket name without dots would allow the shorter virtual-host form. Worth
considering when the real production bucket is created.

### `S3_USE_OBJECT_ACL` must be `true` on DO Spaces

Spaces stores objects private by default. Verified directly: a `PUT` carrying
`ACL: public-read` reads back `200`, the same `PUT` without it reads back
`403`. Leaving the flag unset uploads every asset successfully and then serves
none of them. (Leave it unset for Cloudflare R2 and MinIO, which reject the
parameter.)

### Bucket CORS is still not set — and assets are proxied because of it

The credentials in use are object-level only. Probed one operation at a time:

| Operation | Result |
|---|---|
| `PutObject` / `GetObject` / `ListObjectsV2` | OK |
| `GetBucketLocation` | OK |
| `ListBuckets` | 403 |
| `GetBucketAcl` / `GetBucketPolicy` | 403 |
| `GetBucketCors` / `PutBucketCors` | 403 |

`ListBuckets` failing is the tell: a legacy account-wide Spaces key would list
every Space. This is a scoped per-bucket key at Read+Write, and bucket
configuration needs Full Access. So CORS cannot be set from application code —
either regenerate the key with Full Access, or set it from the DO dashboard:

```
AllowedOrigins: <the FE origin>
AllowedMethods: GET, HEAD
AllowedHeaders: *
MaxAgeSeconds: 3600
```

Until then, two workarounds are in place:

- Theme JSON is read through `/api/templates/[...path]` server-side rather than
  fetched from the CDN by the browser, so no CORS header is needed.
- **Images are proxied same-origin** through `/api/templates/asset/[...key]`.
  This is what `TEMPLATE_ASSETS_PROXY` controls (see
  `lib/storage/asset-proxy.ts`), and it exists specifically to keep canvas
  export working. Measured, on the `standard` theme:

  | Image source | `crossOrigin` | Result |
  |---|---|---|
  | direct CDN | unset | loads, canvas tainted, `toDataURL()` throws `SecurityError` |
  | direct CDN | `anonymous` | request refused, image never loads |
  | proxied | either | loads, exports fine — 65/65 live canvases exportable |

**Turn the proxy off once CORS is configured.** Set
`TEMPLATE_ASSETS_PROXY=false`; images then load direct from the CDN again and
the app stops carrying that bandwidth. No data migration is involved — what is
stored has always been the absolute CDN URL, and only the copy served to the
browser is rewritten.

## Credentials

The staging key currently in `FE-codebase/.env.local` was shared over chat.
Rotate it, and issue a separate key for production.
