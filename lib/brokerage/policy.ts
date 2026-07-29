import type { Plan } from "@/lib/subscriptionPolicy";
import type { BrokerageProofCandidate } from "./types";

export const BROKERAGE_TERMS_VERSION = "snaptrade-end-user-terms-v1";
export const BROKERAGE_PUBLIC_CONSENT_VERSION =
  "snaptrade-public-proof-consent-v1";

export function canUseBrokerage(plan: Plan) {
  return plan === "pro" || plan === "advanced" || plan === "ultimate";
}

export function createSnapTradeUserId(userId: string) {
  return `stockradar_${userId.replace(/-/g, "")}`;
}

export function normalizeProofCandidate(
  candidate: BrokerageProofCandidate,
): BrokerageProofCandidate {
  const ticker = candidate.ticker.toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
    throw new Error("BROKERAGE_INVALID_TICKER");
  }
  return {
    ...candidate,
    brokerName: candidate.brokerName.trim().slice(0, 80),
    ticker,
  };
}
