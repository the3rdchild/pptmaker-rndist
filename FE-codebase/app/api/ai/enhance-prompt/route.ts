// POST /api/ai/enhance-prompt — rewrites a terse deck prompt into a rich
// generation brief (audience, angle, structure, tone) so the generator has
// real material to work with. Read-only: same posture as choose-theme and
// visual-review.

import { NextResponse } from "next/server";

import { enhanceDeckPrompt } from "@/lib/ai-prompt-enhance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as {
		topic?: unknown;
		language?: unknown;
		provider?: unknown;
	} | null;
	const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
	if (!topic) {
		return NextResponse.json({ error: "topic is required" }, { status: 400 });
	}

	try {
		const enhanced = await enhanceDeckPrompt(
			topic,
			typeof body?.language === "string" ? body.language : undefined,
			typeof body?.provider === "string" ? body.provider : null,
		);
		return NextResponse.json({ enhanced });
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Prompt enhancement failed" },
			{ status: 502 },
		);
	}
}
