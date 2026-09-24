// Shared colour-conversion primitives, pulled out of the files that each
// carried a byte-identical copy. Only exact duplicates live here: the other
// hex/rgb/hsl/hsv variants in the codebase differ in behaviour (rounding,
// validation, hue units, fallbacks) and were deliberately left where they are.

export function rgbToHex([r, g, b]: [number, number, number] | number[]): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

export function contrastRatio(left: number, right: number) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function withHash(value: string | null | undefined) {
  if (!value) return undefined;
  return value.startsWith("#") || value.startsWith("rgb") ? value : `#${value}`;
}
