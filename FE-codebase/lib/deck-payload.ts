import type { PresentationData } from "@/store/presentationGeneration";

export type GenerationLog = Record<string, unknown>;

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readGenerationLog(payload: Record<string, unknown> | null): GenerationLog | null {
  const value = payload?.generationLog;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as GenerationLog
    : null;
}

export function readGenerationMetrics(log: GenerationLog | null): {
  costUsd: number | null;
  durationMs: number | null;
} | null {
  if (!log) return null;
  const costUsd = nonNegativeNumber(log.costUsd);
  const durationSeconds = nonNegativeNumber(log.durationSeconds);
  const durationMs = nonNegativeNumber(log.durationMs)
    ?? (durationSeconds === null ? null : durationSeconds * 1000);
  return costUsd === null && durationMs === null ? null : { costUsd, durationMs };
}

export function buildDeckSaveBody(
  data: PresentationData,
  deckThemeId: string | null,
  generationLog: GenerationLog | null,
) {
  const title = data.title ?? "Untitled";
  return {
    title,
    payload: {
      title,
      slides: data.slides,
      ...(data.fonts ? { fonts: data.fonts } : {}),
      ...(deckThemeId ? { deckThemeId } : {}),
      ...(generationLog ? { generationLog } : {}),
    },
  };
}
