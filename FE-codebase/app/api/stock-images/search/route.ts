import { NextResponse, type NextRequest } from "next/server";
import {
  availableStockImageProviders,
  searchStockImagesWithFallback,
  type StockImageProviderId,
} from "@/lib/stock-image-providers";

// Stock-photo search for the editor's "Fill with stock photo" picker. Runs
// server-side so API keys never reach the browser. Prefers the requested
// provider (or the first configured one) but falls through every other
// configured provider on failure — see searchStockImagesWithFallback — so a
// single provider being rate-limited (Unsplash's demo key caps at 50
// req/hour) doesn't take stock search out when another key is configured.
// Surfaces a 503 when none are configured so the client can show "no
// provider" gracefully.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim();
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 },
    );
  }

  if (availableStockImageProviders().length === 0) {
    return NextResponse.json(
      { error: "no stock image provider configured" },
      { status: 503 },
    );
  }

  const requested = searchParams.get("provider") as StockImageProviderId | null;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  // Pixabay rejects per_page < 3; clamp the floor there so the endpoint is
  // robust on its own, not just because the UI always sends 24.
  const perPage = Math.min(
    48,
    Math.max(3, Number(searchParams.get("per_page") ?? 24) || 24),
  );

  try {
    const data = await searchStockImagesWithFallback(requested, query, { page, perPage });
    return NextResponse.json({ page, ...data });
  } catch (err) {
    console.error("stock image search failed on every configured provider", err);
    return NextResponse.json(
      { error: "stock image search failed" },
      { status: 502 },
    );
  }
}
