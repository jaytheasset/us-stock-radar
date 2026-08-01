import "server-only";

import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";
import { resolveTelegramMuteTicker } from "@/lib/telegram/telegramCallbackPolicy";

type TelegramTickerRow = {
  ticker?: unknown;
  enabled?: unknown;
};

export type TelegramMuteResolution =
  | { ok: true; userId: string; ticker: string; alreadyMuted: boolean }
  | { ok: false; error: "CONNECTION_NOT_FOUND" | "ACTION_INVALID" | "READ_FAILED" | "WRITE_FAILED" };

export async function resolveTelegramMuteAction(input: {
  destination: string;
  token: string;
  tokenSecret: string;
  write: boolean;
}): Promise<TelegramMuteResolution> {
  const owner = await supabaseSelect("user_delivery_channels", {
    select: "user_id",
    channel: "eq.telegram",
    destination: `eq.${input.destination}`,
    verified_at: "not.is.null",
    limit: "1",
  });
  if (!owner.ok) return { ok: false, error: "READ_FAILED" };

  const ownerRow = Array.isArray(owner.data)
    ? (owner.data[0] as { user_id?: unknown } | undefined)
    : undefined;
  const userId = stringValue(ownerRow?.user_id);
  if (!userId) return { ok: false, error: "CONNECTION_NOT_FOUND" };

  const tickersResult = await supabaseSelect("user_alert_tickers", {
    select: "ticker,enabled",
    user_id: `eq.${userId}`,
    limit: "1000",
  });
  if (!tickersResult.ok) return { ok: false, error: "READ_FAILED" };

  const tickerRows = Array.isArray(tickersResult.data)
    ? (tickersResult.data as TelegramTickerRow[])
    : [];
  const ticker = resolveTelegramMuteTicker(
    tickerRows.map((row) => normalizeTicker(row.ticker)).filter(Boolean),
    input.token,
    input.tokenSecret,
    userId,
  );
  const matched = tickerRows.find((row) => normalizeTicker(row.ticker) === ticker);
  if (!matched || !ticker) return { ok: false, error: "ACTION_INVALID" };

  const alreadyMuted = matched.enabled !== true;
  if (!input.write || alreadyMuted) return { ok: true, userId, ticker, alreadyMuted };

  const update = await supabaseUpdate(
    "user_alert_tickers",
    { user_id: `eq.${userId}`, ticker: `eq.${ticker}` },
    { enabled: false },
  );
  if (!update.ok || !Array.isArray(update.data) || update.data.length !== 1) {
    return { ok: false, error: "WRITE_FAILED" };
  }

  return { ok: true, userId, ticker, alreadyMuted: false };
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}
