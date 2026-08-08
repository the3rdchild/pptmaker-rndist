// POST /api/ai/choose-theme — given a deck topic, picks the best-fitting
// theme via Kimi using the theme-choice manifest (when_to_use / avoid_when /
// keywords). Read-only: it changes nothing, so unlike the template-engine
// write routes it needs no authoring guard — same posture as visual-review.

import { NextResponse } from "next/server";

import { buildThemeChoiceManifest } from "@/lib/templates/manifest";
import { callKimiChooseTheme } from "@/lib/templates/choose-theme";
import { listThemeIds, readTheme } from "@/lib/templates/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as {
		topic?: unknown;
		language?: unknown;
	} | null;
	const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
	if (!topic) {
		return NextResponse.json({ error: "topic is required" }, { status: 400 });
	}

	try {
		const ids = await listThemeIds();
		const themes = (
			await Promise.all(ids.map((themeId) => readTheme(themeId)))
		).filter((theme): theme is NonNullable<typeof theme> => Boolean(theme));
		if (themes.length === 0) {
			return NextResponse.json({ theme_id: null, reason: null });
		}

		const result = await callKimiChooseTheme({
			topic,
			language: typeof body?.language === "string" ? body.language : undefined,
			themes: buildThemeChoiceManifest(themes),
		});
		return NextResponse.json(result);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Theme choice failed" },
			{ status: 502 },
		);
	}
}
