import { NextResponse } from "next/server";
import { availableStockImageProviders } from "@/lib/stock-image-providers";

// Lists stock-image providers whose API key is configured, so StockPhotoEditor
// can render the provider picker without reading process.env from the browser.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ providers: availableStockImageProviders() });
}
