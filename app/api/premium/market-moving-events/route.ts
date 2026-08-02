import { NextResponse } from "next/server";
import { loadPremiumMarketMovingEvents } from "@/lib/premiumMarketMoving.server";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    return NextResponse.json(await loadPremiumMarketMovingEvents(), {
      headers: noStoreHeaders,
      status: 200,
    });
  } catch {
    return NextResponse.json(
      { error: "Market-moving filings are temporarily unavailable." },
      { headers: noStoreHeaders, status: 503 },
    );
  }
}
