// POST /api/ai/visual-review — one generated slide past Kimi vision.
// mode "verify": {image, topic, language, slots, fills} → {issues}
// mode "repair": {language, slots, fills, issues} → {fills} (corrected)

import { NextResponse } from "next/server";

import {
	repairSlotFills,
	reviewSlideVisual,
	type RepairInput,
	type VerifyInput,
} from "@/lib/ai-visual-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Rec | null;
	if (!body || typeof body !== "object") {
		return NextResponse.json({ error: "Invalid body" }, { status: 400 });
	}

	try {
		if (body.mode === "verify") {
			if (typeof body.image !== "string" || !body.image) {
				return NextResponse.json({ error: "image is required" }, { status: 400 });
			}
			const issues = await reviewSlideVisual(body as unknown as VerifyInput);
			return NextResponse.json({ issues });
		}
		if (body.mode === "repair") {
			const fills = await repairSlotFills(body as unknown as RepairInput);
			return NextResponse.json({ fills });
		}
		return NextResponse.json({ error: "mode must be verify|repair" }, { status: 400 });
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Visual review failed" },
			{ status: 502 },
		);
	}
}

type Rec = Record<string, unknown>;
