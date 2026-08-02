import "server-only";

import {
  buildPremiumMarketMovingEventQuery,
  buildPremiumMarketMovingTickerQuery,
  PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS,
  selectPremiumMarketMovingEvents,
  type PremiumMarketMovingResponse,
} from "@/lib/premiumMarketMoving";
import { supabaseSelect } from "@/lib/supabase";

type UnknownRow = Record<string, unknown>;

let cachedResponse: {
  expiresAt: number;
  value: PremiumMarketMovingResponse;
} | null = null;
let pendingResponse: Promise<PremiumMarketMovingResponse> | null = null;

export async function loadPremiumMarketMovingEvents(): Promise<PremiumMarketMovingResponse> {
  const now = Date.now();
  if (cachedResponse && cachedResponse.expiresAt > now) {
    return cachedResponse.value;
  }
  if (pendingResponse) return pendingResponse;

  pendingResponse = buildPremiumMarketMovingResponse()
    .then((value) => {
      cachedResponse = {
        expiresAt:
          Date.now() + PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS * 1_000,
        value,
      };
      return value;
    })
    .finally(() => {
      pendingResponse = null;
    });

  return pendingResponse;
}

async function buildPremiumMarketMovingResponse(): Promise<PremiumMarketMovingResponse> {
  const eventsResult = await supabaseSelect(
    "events",
    buildPremiumMarketMovingEventQuery(),
  );
  if (!eventsResult.ok || !Array.isArray(eventsResult.data)) {
    throw new Error("Premium market-moving filings are unavailable");
  }

  const eventRows = eventsResult.data.filter(isRecord);
  const eventIds = eventRows
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
  const tickerResult = eventIds.length
    ? await supabaseSelect(
        "event_tickers",
        buildPremiumMarketMovingTickerQuery(eventIds),
      )
    : { data: [], ok: true };

  if (!tickerResult.ok || !Array.isArray(tickerResult.data)) {
    throw new Error("Premium filing tickers are unavailable");
  }

  return {
    events: selectPremiumMarketMovingEvents(
      eventRows,
      tickerResult.data.filter(isRecord),
    ),
    refreshedAt: new Date().toISOString(),
  };
}

function isRecord(value: unknown): value is UnknownRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
