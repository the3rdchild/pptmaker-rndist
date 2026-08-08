// POST /api/template-engine/auto-label-theme — proxies one theme's overview
// (metadata + every layout's summary + optional page images) to Kimi and
// returns authored theme-level metadata: description + AI guidance. The key
// stays server-side; applying the result is the caller's job (PATCH themes).

import { NextResponse } from "next/server";

import {
	callKimiAutoLabelTheme,
	type AutoLabelThemeRequest,
} from "@/lib/templates/auto-label-theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as AutoLabelThemeRequest | null;
	if (!body || !body.theme || typeof body.theme.id !== "string") {
		return NextResponse.json({ error: "theme is required" }, { status: 400 });
	}
	if (!Array.isArray(body.layouts)) {
		return NextResponse.json({ error: "layouts[] is required" }, { status: 400 });
	}
	try {
		const result = await callKimiAutoLabelTheme(body);
		return NextResponse.json(result);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Auto-label failed" },
			{ status: 502 },
		);
	}
}
