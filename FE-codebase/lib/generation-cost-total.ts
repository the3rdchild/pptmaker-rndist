/** Browser-side sum of the outline, slide, review and image subtotals. */
export class GenerationCostTotal {
  private total = 0;
  private unknown = false;

  add(cost: unknown) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      this.unknown = true;
      return;
    }
    this.total += cost;
  }

  usd(): number | null {
    return this.unknown ? null : Number(this.total.toFixed(8));
  }
}

/** Sum only active generation phases; editing time between pages is excluded. */
export class GenerationDurationTotal {
  private total = 0;

  constructor(initialMs: unknown = 0) {
    this.add(initialMs);
  }

  add(durationMs: unknown) {
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
      this.total += durationMs;
    }
  }

  ms(): number {
    return Math.round(this.total);
  }
}

export function formatGenerationDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
