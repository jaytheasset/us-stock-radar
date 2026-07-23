import "server-only";

import type { Plan } from "@/lib/subscriptionPolicy";
import {
  formatLimit,
  getPlanDisplayName,
  getPlanLimits,
  getPlanUpgradeTarget,
} from "@/lib/subscriptionPolicy";

const TICKER_PATTERN = /^[A-Z0-9.-]{1,12}$/;

export class AlertTickerValidationError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AlertTickerValidationError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeAlertTicker(value: unknown) {
  if (typeof value !== "string") {
    throw new AlertTickerValidationError("INVALID_TICKER", "Select a valid ticker.");
  }

  const ticker = value.trim().toUpperCase();
  if (!TICKER_PATTERN.test(ticker)) {
    throw new AlertTickerValidationError("INVALID_TICKER", "Select a valid ticker.");
  }

  return ticker;
}

export function assertAlertTickerLimit(plan: Plan, currentUsage: number) {
  const limit = getPlanLimits(plan).alertTickerLimit;
  if (limit === null || currentUsage < limit) return;

  const planName = getPlanDisplayName(plan);
  const upgradeTarget = getPlanUpgradeTarget(plan);
  const upgradeText = upgradeTarget
    ? ` Upgrade to ${getPlanDisplayName(upgradeTarget)} to add more tickers.`
    : "";

  throw new AlertTickerValidationError(
    "ALERT_TICKER_LIMIT_EXCEEDED",
    `${planName} includes ${formatLimit(limit)} alert-enabled tickers.${upgradeText}`,
    {
      limit,
      usage: currentUsage,
    },
  );
}
