import { NextResponse } from "next/server";
import { availableProviders } from "@/lib/ai-providers";

// Returns the AI providers the frontend can offer in its selectors. This runs
// server-side so it can read the API key env vars; the browser cannot (they
// have no NEXT_PUBLIC_ prefix by design — keys never reach the client). The
// homepage generate UI fetches this on mount to build its per-section
// dropdowns (generate, verify, repair), so only providers the server can
// actually call appear.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    text: availableProviders({ vision: false }),
    vision: availableProviders({ vision: true }),
  });
}
