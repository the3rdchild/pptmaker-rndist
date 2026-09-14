const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Converts extractor evidence into a compact retry instruction. This is kept
 * separate from Chrome/LLM code so the acceptance rule remains testable.
 */
export function assessSlideLayout({ elements = [], warnings = [] } = {}) {
  const issues = [];
  const clipped = warnings.filter((warning) => /clipped|overflows the slide/i.test(String(warning)));
  if (clipped.length) issues.push(...clipped.map(String));

  for (const element of elements) {
    if (element?.type !== "text") continue;
    const x = element.position?.x;
    const y = element.position?.y;
    const width = element.size?.width;
    const height = element.size?.height;
    if (![x, y, width, height].every(isFiniteNumber)) continue;
    if (x < -2 || y < -2 || x + width > STAGE_WIDTH + 2 || y + height > STAGE_HEIGHT + 2) {
      const label = element.runs?.[0]?.text?.slice(0, 48) || "Text";
      issues.push(`Text \"${label}\" is outside the ${STAGE_WIDTH}x${STAGE_HEIGHT} canvas.`);
    }
  }

  return {
    ok: issues.length === 0,
    feedback: issues.join(" "),
  };
}
