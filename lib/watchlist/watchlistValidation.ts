import "server-only";

import type { Plan } from "@/lib/subscriptionPolicy";
import { formatLimit, getPlanDisplayName, getPlanLimits, getPlanUpgradeTarget } from "@/lib/subscriptionPolicy";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export class WatchlistValidationError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WatchlistValidationError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeTicker(value: unknown) {
  if (typeof value !== "string") {
    throw new WatchlistValidationError("INVALID_TICKER", "Ticker must be a string.");
  }

  const ticker = value.trim().toUpperCase();
  if (!ticker) {
    throw new WatchlistValidationError("INVALID_TICKER", "Ticker is required.");
  }

  if (/\s/.test(ticker)) {
    throw new WatchlistValidationError("INVALID_TICKER", "Ticker cannot contain spaces.");
  }

  if (!TICKER_PATTERN.test(ticker)) {
    throw new WatchlistValidationError(
      "INVALID_TICKER",
      "Ticker must be 1-12 characters and use only A-Z, 0-9, dot, or hyphen.",
    );
  }

  return ticker;
}

export function assertWatchlistLimit(plan: Plan, currentUsage: number) {
  const limit = getPlanLimits(plan).watchlistLimit;
  if (limit === null || currentUsage < limit) return;

  const planName = getPlanDisplayName(plan);
  const upgradeTarget = getPlanUpgradeTarget(plan);
  const upgradeText = upgradeTarget ? ` Upgrade to ${getPlanDisplayName(upgradeTarget)} to add more tickers.` : "";

  throw new WatchlistValidationError(
    "WATCHLIST_LIMIT_EXCEEDED",
    `${planName} includes ${formatLimit(limit)} watchlist tickers.${upgradeText}`,
    {
      limit,
      usage: currentUsage,
    },
  );
}
