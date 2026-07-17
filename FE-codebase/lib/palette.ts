// Deck color palette generator — rule-based, not random-random.
// Picks a base hue then derives the rest of the palette using real
// color-harmony schemes (complementary/triadic/tetradic/analogous/
// split-complementary), so generated decks stay visually coherent instead
// of clashing. Accent saturation is clamped to 30-50% per design direction
// (avoids neon/jarring swatches); backgrounds stay low-saturation and near
// the extremes of the lightness range so text stays legible on top.

export type HarmonyScheme =
	| "complementary"
	| "triadic"
	| "tetradic"
	| "analogous"
	| "split-complementary"
	| "monochromatic";

export type PaletteMode = "dark" | "light";

export interface DeckPalette {
	seed: string;
	scheme: HarmonyScheme;
	mode: PaletteMode;
	baseHue: number;
	background: string;
	surface: string;
	surfaceElevated: string;
	textPrimary: string;
	textSecondary: string;
	accent: string;
	accentSecondary: string;
	accentTertiary: string;
}

const SCHEMES: HarmonyScheme[] = [
	"complementary",
	"triadic",
	"tetradic",
	"analogous",
	"split-complementary",
	"monochromatic",
];

const ACCENT_SAT_MIN = 30;
const ACCENT_SAT_MAX = 50;

/** Deterministic string -> uint32 hash (djb2), used to seed the RNG. */
function hashSeed(seed: string): number {
	let hash = 5381;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 33) ^ seed.charCodeAt(i);
	}
	return hash >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic from a uint32 seed. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hslToHex(h: number, s: number, l: number): string {
	const hue = ((h % 360) + 360) % 360;
	const sat = Math.min(100, Math.max(0, s)) / 100;
	const light = Math.min(100, Math.max(0, l)) / 100;

	const c = (1 - Math.abs(2 * light - 1)) * sat;
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = light - c / 2;

	let r = 0, g = 0, b = 0;
	if (hue < 60) [r, g, b] = [c, x, 0];
	else if (hue < 120) [r, g, b] = [x, c, 0];
	else if (hue < 180) [r, g, b] = [0, c, x];
	else if (hue < 240) [r, g, b] = [0, x, c];
	else if (hue < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];

	const toByte = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
	return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
	const clean = hex.replace("#", "");
	const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
	const r = parseInt(full.slice(0, 2), 16) / 255;
	const g = parseInt(full.slice(2, 4), 16) / 255;
	const b = parseInt(full.slice(4, 6), 16) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const delta = max - min;

	if (delta === 0) return { h: 0, s: 0, l: l * 100 };

	const s = delta / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === r) h = ((g - b) / delta) % 6;
	else if (max === g) h = (b - r) / delta + 2;
	else h = (r - g) / delta + 4;
	h *= 60;
	if (h < 0) h += 360;

	return { h, s: s * 100, l: l * 100 };
}

export { hslToHex };

/** Hue offsets (from the base hue) for each accent slot, per scheme. */
function accentHueOffsets(scheme: HarmonyScheme): [number, number, number] {
	switch (scheme) {
		case "complementary":
			return [0, 180, 180];
		case "triadic":
			return [0, 120, 240];
		case "tetradic":
			return [0, 90, 180];
		case "analogous":
			return [0, 30, -30];
		case "split-complementary":
			return [0, 150, 210];
		case "monochromatic":
			return [0, 0, 0];
	}
}

export interface GeneratePaletteOptions {
	/** Deterministic seed (e.g. deck id) — same seed always yields the same palette. */
	seed?: string;
	/** Force a specific hue (0-360) instead of deriving one from the seed. */
	baseHue?: number;
	/** Force a specific harmony scheme instead of deriving one from the seed. */
	scheme?: HarmonyScheme;
	mode?: PaletteMode;
}

export function generateDeckPalette(options: GeneratePaletteOptions = {}): DeckPalette {
	const seed = options.seed ?? String(Math.random());
	const rng = mulberry32(hashSeed(seed));
	const mode: PaletteMode = options.mode ?? (rng() < 0.5 ? "dark" : "light");

	const baseHue = options.baseHue ?? Math.floor(rng() * 360);
	const scheme = options.scheme ?? SCHEMES[Math.floor(rng() * SCHEMES.length)];
	const [offA, offB, offC] = accentHueOffsets(scheme);

	// Accent saturation: within the 30-50% band, slightly jittered per swatch
	// so a monochromatic scheme doesn't produce three identical colors.
	const accentSat = () => ACCENT_SAT_MIN + rng() * (ACCENT_SAT_MAX - ACCENT_SAT_MIN);
	const accentLight = mode === "dark" ? 55 + rng() * 10 : 38 + rng() * 10;

	// For monochromatic, vary lightness instead of hue to keep swatches distinct.
	const monoStep = scheme === "monochromatic" ? 14 : 0;

	const accent = hslToHex(baseHue + offA, accentSat(), accentLight);
	const accentSecondary = hslToHex(baseHue + offB, accentSat(), accentLight - monoStep);
	const accentTertiary = hslToHex(baseHue + offC, accentSat(), accentLight + monoStep);

	// Background/surface: low saturation, tinted toward the base hue, sitting
	// near the dark or light end of the lightness range so text stays legible.
	const bgSat = 10 + rng() * 8;
	const background = hslToHex(baseHue, bgSat, mode === "dark" ? 6 + rng() * 4 : 96 + rng() * 2);
	const surface = hslToHex(baseHue, bgSat, mode === "dark" ? 11 + rng() * 4 : 92 + rng() * 2);
	const surfaceElevated = hslToHex(baseHue, bgSat, mode === "dark" ? 17 + rng() * 4 : 88 + rng() * 2);

	const textPrimary = hslToHex(baseHue, Math.min(bgSat, 8), mode === "dark" ? 96 : 12);
	const textSecondary = hslToHex(baseHue, Math.min(bgSat, 10), mode === "dark" ? 74 : 34);

	return {
		seed,
		scheme,
		mode,
		baseHue,
		background,
		surface,
		surfaceElevated,
		textPrimary,
		textSecondary,
		accent,
		accentSecondary,
		accentTertiary,
	};
}

/* --------------------------- Manual palette picker ------------------------- */
// Interactive palette generator for the color-palette panel: pick a base
// color, spread N hues around the wheel (evenly, or analogous at a custom
// angle), and generate a light→dark tone ramp at each hue — the same model
// as Chromora's hue+tone grid (see colorGenerator.js's _generateHues /
// _calculateShadesAndTones), reimplemented here in HSL against our own
// hslToHex/hexToHsl instead of Chromora's HSV pipeline.

export interface ManualPaletteOptions {
	baseHex: string;
	/** Hues in the wheel, including the base. 2=complementary, 3=triadic, 4=tetradic, 5-6=analogous-ish fan. */
	hueCount: number;
	/** Shades generated per hue (light→dark), including the base tone. */
	toneCount: number;
	/** When set, hues fan out ±angle from the base instead of spreading evenly around the full circle. */
	analogousAngle?: number;
}

export interface HueRow {
	hue: number;
	swatches: string[];
}

export function generateManualPalette(options: ManualPaletteOptions): HueRow[] {
	const { baseHex, hueCount, toneCount, analogousAngle } = options;
	const base = hexToHsl(baseHex);
	const count = Math.max(1, Math.round(hueCount));
	const tones = Math.max(1, Math.round(toneCount));

	const hues: number[] = [];
	for (let i = 0; i < count; i++) {
		if (analogousAngle) {
			const step = i % 2 === 0 ? -Math.ceil(i / 2) : Math.ceil(i / 2);
			hues.push(base.h + step * analogousAngle);
		} else {
			hues.push(base.h + (360 / count) * i);
		}
	}

	return hues.map((hue) => {
		const swatches: string[] = [];
		for (let t = 0; t < tones; t++) {
			// Spread lightness from dark to light, keeping the base tone's own
			// saturation/lightness as the middle-ish anchor when tones is odd.
			const l = tones === 1 ? base.l : 15 + (t / (tones - 1)) * 70;
			swatches.push(hslToHex(hue, base.s, l));
		}
		return { hue: ((hue % 360) + 360) % 360, swatches };
	});
}
