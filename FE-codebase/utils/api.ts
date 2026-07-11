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

const ACTIVE_TEMPLATE_PACK = "general";

function toTemplatePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.startsWith("static/")) {
    return `/templates/${ACTIVE_TEMPLATE_PACK}/${normalized}`;
  }
  if (normalized.startsWith("/static/")) {
    return normalized;
  }
  if (normalized.startsWith("/_next/static/")) {
    return normalized;
  }
  return normalized;
}

export function resolveBackendAssetUrl(path?: string): string {
  if (!path) return "";
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  return toTemplatePath(trimmed);
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
  asset: BackendAssetLike | string | null | undefined
): string {
  return resolveBackendAssetUrl(getBackendAssetSource(asset));
}

export const normalizeBackendAssetUrls = <T,>(input: T): T => {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeBackendAssetUrls(item)) as T;
  }
  if (input && typeof input === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      normalized[key] =
        typeof value === "string"
          ? resolveBackendAssetUrl(value)
          : normalizeBackendAssetUrls(value);
    }
    return normalized as T;
  }
  return input;
};
