// POST /api/template-engine/auto-label — proxies one page's elements to Kimi
// and returns authored slot metadata. The key stays server-side; the panel
// sends only the compact element list.

import { NextResponse } from "next/server";

import {
	callKimiAutoLabel,
	type AutoLabelRequest,
} from "@/lib/templates/auto-label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as AutoLabelRequest | null;
	if (!body || !Array.isArray(body.elements) || body.elements.length === 0) {
		return NextResponse.json({ error: "elements[] is required" }, { status: 400 });
	}
	try {
		const result = await callKimiAutoLabel(body);
		return NextResponse.json(result);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Auto-label failed" },
			{ status: 502 },
		);
	}
}
