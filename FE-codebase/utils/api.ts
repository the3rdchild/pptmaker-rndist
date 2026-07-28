import { extractApiErrorMessage } from "@/utils/apiErrorMessages";

function isAbsoluteHttpUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export async function getApiErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  try {
    const errorData: unknown = await response.clone().json();
    return extractApiErrorMessage(errorData, fallbackMessage, response.status);
  } catch {
    try {
      const text = await response.text();
      return extractApiErrorMessage(text, fallbackMessage, response.status);
    } catch {
      return fallbackMessage;
    }
  }
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function getFastAPIUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://127.0.0.1:8081";
}

export function getApiUrl(path: string): string {
  if (isAbsoluteHttpUrl(path)) return path;
  return withLeadingSlash(path);
}

export function buildAbsoluteApiRequestUrl(
  path: string,
  baseForRelative: string = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://127.0.0.1:8081"
): string {
  const resolved = getApiUrl(path);
  if (isAbsoluteHttpUrl(resolved)) return resolved;
  return new URL(resolved, baseForRelative).toString();
}

/** Theme a bare `static/...` asset path belongs to when no theme is supplied.
 *  Every shipped pack already stores its images pack-absolute
 *  (`/templates/<theme>/static/...`), so this only catches hand-authored or
 *  legacy relative paths. Templates saved by the template engine are written
 *  pack-absolute for the same reason — a bare path is ambiguous the moment
 *  more than one theme exists. */
const FALLBACK_TEMPLATE_THEME = "general";

function toTemplatePath(rawPath: string, theme: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.startsWith("static/")) {
    return `/templates/${theme}/${normalized}`;
  }
  if (normalized.startsWith("/static/")) {
    return normalized;
  }
  if (normalized.startsWith("/_next/static/")) {
    return normalized;
  }
  return normalized;
}

export function resolveBackendAssetUrl(
  path?: string,
  theme: string = FALLBACK_TEMPLATE_THEME
): string {
  if (!path) return "";
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  return toTemplatePath(trimmed, theme);
}

/** Inverse of {@link resolveBackendAssetUrl}: turns a resolved URL back into
 *  the pack-absolute form stored in template.json. Shared assets under
 *  `/static/...` and remote URLs are left alone. */
export function toStoredTemplateAssetUrl(path: string, theme: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("static/")) return `/templates/${theme}/${trimmed}`;
  return trimmed.replace(/\\/g, "/");
}

export type BackendAssetLike = {
  file_url?: string | null;
  path?: string | null;
  url?: string | null;
};

export function getBackendAssetSource(
  asset: BackendAssetLike | string | null | undefined
): string {
  if (typeof asset === "string") return asset;
  if (!asset) return "";
  return (asset.file_url || asset.path || asset.url || "").trim();
}

export function resolveBackendAssetSource(
  asset: BackendAssetLike | string | null | undefined,
  theme?: string
): string {
  return resolveBackendAssetUrl(getBackendAssetSource(asset), theme);
}

export const normalizeBackendAssetUrls = <T,>(input: T, theme?: string): T => {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeBackendAssetUrls(item, theme)) as T;
  }
  if (input && typeof input === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      normalized[key] =
        typeof value === "string"
          ? resolveBackendAssetUrl(value, theme)
          : normalizeBackendAssetUrls(value, theme);
    }
    return normalized as T;
  }
  return input;
};
