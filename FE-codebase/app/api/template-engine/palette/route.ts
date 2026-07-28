// Previews what a theme's palette becomes at a given hue.
//
//   /api/template-engine/palette?theme=modern&hue=280[&harmony=triadic]
//
// Same code path the generator will use, exposed so a template author can see
// how their palette survives rotation before committing it — and so the
// contrast guarantee is checkable rather than assumed.

import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  brandColorCount,
  contrastRatio,
  recommendHarmony,
  rotatePalette,
  toPaletteSpec,
  type HarmonyRule,
} from "@/lib/templates/palette-engine";
import { templatesRoot } from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const themeId = url.searchParams.get("theme") ?? "";
  const hueParam = url.searchParams.get("hue");
  const harmony = url.searchParams.get("harmony") as HarmonyRule | null;

  if (!themeId) {
    return NextResponse.json({ error: "theme is required" }, { status: 400 });
  }

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(
      await fs.readFile(path.join(templatesRoot(), themeId, "theme.json"), "utf8"),
    );
  } catch {
    return NextResponse.json({ error: `Unknown theme: ${themeId}` }, { status: 404 });
  }

  const spec = toPaletteSpec(meta.palette);
  const hues =
    hueParam != null
      ? [Number(hueParam)]
      : [0, 45, 90, 135, 180, 225, 270, 315];

  const variants = hues
    .filter((hue) => Number.isFinite(hue))
    .map((hue) => {
      const palette = rotatePalette(spec, {
        hue,
        harmony: harmony ?? undefined,
      });
      const background = palette.background ?? "#FFFFFF";
      return {
        hue,
        palette,
        contrast: {
          text: palette.text
            ? Number(contrastRatio(palette.text, background).toFixed(2))
            : null,
          muted: palette.muted
            ? Number(contrastRatio(palette.muted, background).toFixed(2))
            : null,
        },
      };
    });

  return NextResponse.json({
    theme: themeId,
    authored: spec,
    brand_colors: brandColorCount(spec),
    harmony: harmony ?? spec.harmony ?? recommendHarmony(brandColorCount(spec)),
    recommended_harmony: recommendHarmony(brandColorCount(spec)),
    variants,
  });
}
