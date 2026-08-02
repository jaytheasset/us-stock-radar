import { NextRequest, NextResponse } from "next/server";
import {
  PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS,
  PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS,
} from "@/lib/premiumMarketMoving";
import { loadPremiumMarketMovingEvents } from "@/lib/premiumMarketMoving.server";
import { consumePremiumMarketMovingReadLimit } from "@/lib/premiumMarketMovingRateLimit.server";

export const dynamic = "force-dynamic";

const publicCacheHeaders = {
  "Cache-Control": `public, max-age=0, s-maxage=${PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS}, stale-while-revalidate=${PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS}`,
  "X-Content-Type-Options": "nosniff",
} as const;
const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) {
    return NextResponse.json(
      { error: "Query parameters are not supported." },
      { headers: privateNoStoreHeaders, status: 400 },
    );
  }

  const rate = consumePremiumMarketMovingReadLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      {
        headers: {
          ...privateNoStoreHeaders,
          "Retry-After": String(rate.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }

  try {
    return NextResponse.json(await loadPremiumMarketMovingEvents(), {
      headers: publicCacheHeaders,
      status: 200,
    });
  } catch {
    return NextResponse.json(
      { error: "Market-moving filings are temporarily unavailable." },
      { headers: privateNoStoreHeaders, status: 503 },
    );
  }
}
