import { NextResponse } from "next/server";
import { htmlThemeWritesBlocked } from "@/lib/html-themes/server/guard";
import { seedHtmlThemes } from "@/lib/html-themes/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const blocked = htmlThemeWritesBlocked("seeded");
  if (blocked) return blocked;
  try {
    return NextResponse.json(await seedHtmlThemes());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not seed HTML themes" }, { status: 500 });
  }
}
