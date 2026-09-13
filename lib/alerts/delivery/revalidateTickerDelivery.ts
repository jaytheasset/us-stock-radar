import "server-only";
import { supabaseSelect } from "../../supabase.ts";
import { normalizeAlertEvent } from "./normalizeAlertEvent.ts";
import { createAlertTickerMatcher, parseAlertTickerMatch, survivingAlertTickerBindings } from "./tickerSubscriptionMatch.ts";
import type { QueuedAlertDeliveryRow } from "./types.ts";

// Called after owning a channel and immediately before its irreversible send/visibility step.
// This is a fresh read boundary, not a transaction with Human decisions or the provider.
export async function revalidateTickerDelivery(row: QueuedAlertDeliveryRow): Promise<{
  ok: boolean; savedTickers?: string[]; error?: string;
}> {
  if (row.alert_lane !== "watchlist" || row.ticker_match == null) return { ok: true, savedTickers: undefined };
  const provenance = parseAlertTickerMatch(row.ticker_match);
  const blocked = { ok: false, savedTickers: [] as string[], error: "TICKER_SUBSCRIPTION_MATCH_INVALIDATED" };
  if (!provenance || !row.alert_event_id) return blocked;
  try {
    const [normalized, subscriptions] = await Promise.all([
      normalizeAlertEvent(row.alert_event_id),
      supabaseSelect("user_alert_tickers", { select: "id,ticker", user_id: `eq.${row.user_id}`,
        enabled: "eq.true", id: `in.(${[...new Set(provenance.bindings.map((b) => b.subscriptionId))].join(",")})`, limit: "1000" }),
    ]);
    if (!normalized.ok || !subscriptions.ok || !Array.isArray(subscriptions.data)) return blocked;
    const rows = (subscriptions.data as Array<{ id: string; ticker: string }>);
    const current = await createAlertTickerMatcher()(normalized.event, rows);
    const surviving = survivingAlertTickerBindings(provenance, current.provenance);
    return surviving.length
      ? { ok: true, savedTickers: [...new Set(surviving.map((b) => b.savedTicker))] }
      : blocked;
  } catch {
    return { ...blocked, error: "TICKER_SUBSCRIPTION_REVALIDATION_UNAVAILABLE" };
  }
}
