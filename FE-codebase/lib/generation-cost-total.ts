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
