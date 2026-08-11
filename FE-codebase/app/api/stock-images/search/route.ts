import { NextResponse, type NextRequest } from "next/server";
import {
  availableStockImageProviders,
  searchStockImages,
  type StockImageProviderId,
} from "@/lib/stock-image-providers";

// Stock-photo search for the editor's "Fill with stock photo" picker. Runs
// server-side so API keys never reach the browser. Falls back to the first
// configured provider when the caller doesn't specify one, and surfaces a 503
// when none are configured so the client can show "no provider" gracefully.

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

  const requested = searchParams.get("provider") as StockImageProviderId | null;
  const available = availableStockImageProviders();
  const provider =
    available.find((p) => p.id === requested)?.id ?? available[0]?.id;
  if (!provider) {
    return NextResponse.json(
      { error: "no stock image provider configured" },
      { status: 503 },
    );
  }

  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  // Pixabay rejects per_page < 3; clamp the floor there so the endpoint is
  // robust on its own, not just because the UI always sends 24.
  const perPage = Math.min(
    48,
    Math.max(3, Number(searchParams.get("per_page") ?? 24) || 24),
  );

  try {
    const data = await searchStockImages(provider, query, { page, perPage });
    return NextResponse.json({ provider, page, ...data });
  } catch (err) {
    console.error("stock image search failed", err);
    return NextResponse.json(
      { error: "stock image search failed" },
      { status: 502 },
    );
  }
}
