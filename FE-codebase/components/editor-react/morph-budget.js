// A shared pixel budget lets many small elements morph while bounding the
// total canvas memory for one transition. Keep large pairs on the slide fade.
export const MAX_MORPH_TOTAL_PIXELS = 1280 * 720 * 32;

export function canAddMorphTexture(usedPixels, width, height) {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0
    && usedPixels + width * height <= MAX_MORPH_TOTAL_PIXELS;
}
