// K-means color quantization over an image's pixels (PRD #43/#46 — "extract
// color from image"). Downsamples first so clustering stays fast regardless
// of source resolution. Deterministic (no Math.random) so re-extracting the
// same image gives the same palette.

const SAMPLE_SIZE = 48;
const MAX_ITERATIONS = 12;
const MIN_ALPHA = 32;

type Rgb = [number, number, number];

function rgbToHex([r, g, b]: Rgb): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
}

async function loadPixels(src: string): Promise<Uint8ClampedArray> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

function kMeans(points: Rgb[], k: number): { centroid: Rgb; count: number }[] {
  const centroids: Rgb[] = Array.from(
    { length: k },
    (_, i) => points[Math.floor((i / k) * points.length)],
  );
  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;
    for (let p = 0; p < points.length; p++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dr = points[p][0] - centroids[c][0];
        const dg = points[p][1] - centroids[c][1];
        const db = points[p][2] - centroids[c][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (assignments[p] !== best) {
        assignments[p] = best;
        changed = true;
      }
    }
    if (!changed && iter > 0) break;

    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < points.length; p++) {
      const c = assignments[p];
      sums[c][0] += points[p][0];
      sums[c][1] += points[p][1];
      sums[c][2] += points[p][2];
      sums[c][3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] === 0) continue;
      centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }

  const counts = new Array(centroids.length).fill(0);
  for (const a of assignments) counts[a] += 1;
  return centroids.map((centroid, i) => ({ centroid, count: counts[i] }));
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// 0 (black) .. 1 (white) — used to skip/guard near-white or near-black colors.
export function hexLightness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

// Blends a color toward white — amount 0 = unchanged, 1 = pure white. Used to
// turn a photo's raw dominant color into a soft background wash instead of a
// full-saturation slab that would fight with existing text/decoration colors.
export function tintTowardWhite(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => channel + (255 - channel) * amount;
  return rgbToHex([mix(r), mix(g), mix(b)]);
}

// Picks the most saturated color from a dominant-color list — a photo's
// near-white/near-black pixels (background, shadow) are usually the most
// "common" cluster but the least useful as an accent color.
export function pickVividColor(colors: string[]): string | null {
  let best: string | null = null;
  let bestSaturation = -1;
  for (const hex of colors) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2 / 255;
    if (lightness > 0.92 || lightness < 0.08) continue;
    const denom = 255 - Math.abs(max + min - 255);
    const saturation = denom === 0 ? 0 : (max - min) / denom;
    if (saturation > bestSaturation) {
      bestSaturation = saturation;
      best = hex;
    }
  }
  return best;
}

// Returns up to `count` dominant hex colors, most-common first. Skips
// near-transparent pixels so a PNG icon's padding doesn't dominate.
export async function extractDominantColors(src: string, count = 5): Promise<string[]> {
  const pixels = await loadPixels(src);
  const points: Rgb[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    points.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (points.length === 0) return [];

  const clusters = kMeans(points, Math.min(count, points.length));
  return clusters
    .sort((a, b) => b.count - a.count)
    .map((cluster) => rgbToHex(cluster.centroid));
}
