// POST /api/ai/visual-review — one generated slide past an AI vision provider.
// mode "verify": {image, topic, language, slots, fills, provider?} → {issues}
// mode "repair": {language, slots, fills, issues, provider?} → {fills} (corrected)
// `provider` selects the provider id (resolved in lib/ai-providers.ts); absent
// = server default (vision default for verify, text default for repair).

import { NextResponse } from "next/server";

import { repairSlotFills, reviewSlideVisual } from "@/lib/ai-visual-review";

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
			const issues = await reviewSlideVisual({
				image: body.image,
				topic: typeof body.topic === "string" ? body.topic : "",
				language: typeof body.language === "string" ? body.language : "",
				slots: Array.isArray(body.slots) ? body.slots : [],
				fills: Array.isArray(body.fills) ? body.fills : [],
				photos: Array.isArray(body.photos) ? body.photos : undefined,
				providerId: typeof body.provider === "string" ? body.provider : null,
			});
			return NextResponse.json({ issues });
		}
		if (body.mode === "repair") {
			const fills = await repairSlotFills({
				language: typeof body.language === "string" ? body.language : "",
				slots: Array.isArray(body.slots) ? body.slots : [],
				fills: Array.isArray(body.fills) ? body.fills : [],
				issues: Array.isArray(body.issues) ? body.issues : [],
				providerId: typeof body.provider === "string" ? body.provider : null,
			});
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
