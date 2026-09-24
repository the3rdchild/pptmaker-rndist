export function sanitizeAnalyticsError(
  error: unknown,
  fallback = "Unknown error",
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 240) || fallback;
}

export function bucketFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) {
    return "unknown";
  }
  if (bytes === 0) return "0";
  if (bytes < 100 * 1024) return "<100KB";
  if (bytes < 1024 * 1024) return "100KB-1MB";
  if (bytes < 5 * 1024 * 1024) return "1MB-5MB";
  if (bytes < 20 * 1024 * 1024) return "5MB-20MB";
  if (bytes < 100 * 1024 * 1024) return "20MB-100MB";
  return "100MB+";
}

