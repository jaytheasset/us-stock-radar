import "server-only";

import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";
import { resolveTelegramMuteTicker } from "@/lib/telegram/telegramCallbackPolicy";
import { normalizeTelegramDestination } from "@/lib/telegram/telegramConnectPolicy";

type TelegramTickerRow = {
  ticker?: unknown;
  enabled?: unknown;
};

export type TelegramMuteResolution =
  | { ok: true; userId: string; ticker: string; alreadyMuted: boolean }
  | { ok: false; error: "CONNECTION_NOT_FOUND" | "ACTION_INVALID" | "READ_FAILED" | "WRITE_FAILED" };

export type TelegramConnectionOwnerResolution =
  | { ok: true; userId: string }
  | { ok: false; error: "CONNECTION_NOT_FOUND" | "READ_FAILED" };

export async function resolveTelegramConnectionOwner(
  destination: string,
): Promise<TelegramConnectionOwnerResolution> {
  const normalizedDestination = normalizeTelegramDestination(destination);
  if (!normalizedDestination) {
    return { ok: false, error: "CONNECTION_NOT_FOUND" };
  }
  const owner = await supabaseSelect("user_delivery_channels", {
    select: "user_id",
    channel: "eq.telegram",
    destination: `eq.${normalizedDestination}`,
    verified_at: "not.is.null",
    limit: "1",
  });
  if (!owner.ok) return { ok: false, error: "READ_FAILED" };

  const ownerRow = Array.isArray(owner.data)
    ? (owner.data[0] as { user_id?: unknown } | undefined)
    : undefined;
  const userId = stringValue(ownerRow?.user_id);
  return userId
    ? { ok: true, userId }
    : { ok: false, error: "CONNECTION_NOT_FOUND" };
}

export async function resolveTelegramMuteAction(input: {
  destination: string;
  token: string;
  tokenSecret: string;
  write: boolean;
}): Promise<TelegramMuteResolution> {
  const owner = await resolveTelegramConnectionOwner(input.destination);
  if (!owner.ok) return owner;
  const userId = owner.userId;

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
