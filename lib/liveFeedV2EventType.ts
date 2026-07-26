import { getEventTypeBadge } from "./eventTypeRegistry.ts";
import type { LiveFeedV2Kind } from "./liveFeedV2Contract.ts";

export type LiveFeedV2EventTone =
  | "earnings"
  | "legal"
  | "insider"
  | "transaction"
  | "product"
  | "neutral";

export type LiveFeedV2EventPresentation = {
  emphasis?: "dilution";
  label: string;
  tone: LiveFeedV2EventTone;
};

const filingEventPresentations: Record<string, LiveFeedV2EventPresentation> = {
  capital_return: { label: "Capital Return", tone: "transaction" },
  dilution: { emphasis: "dilution", label: "Dilution", tone: "legal" },
  dilution_risk: { emphasis: "dilution", label: "Dilution", tone: "legal" },
  dividend: { label: "Dividend", tone: "earnings" },
  dividends: { label: "Dividend", tone: "earnings" },
  earnings: { label: "Earnings", tone: "earnings" },
  fda: { label: "FDA / Clinical", tone: "product" },
  fda_clinical: { label: "FDA / Clinical", tone: "product" },
  governance: { label: "Governance", tone: "product" },
  insider: { label: "Insider", tone: "insider" },
  insider_ownership: { label: "Insider", tone: "insider" },
  legal: { label: "Legal", tone: "legal" },
  legal_risk: { label: "Legal", tone: "legal" },
  leadership_governance: { label: "Governance", tone: "product" },
  listing: { label: "Listing", tone: "neutral" },
  listing_risk: { label: "Listing", tone: "neutral" },
  m_a: { label: "M&A", tone: "transaction" },
  ma: { label: "M&A", tone: "transaction" },
  offering: { label: "Offering", tone: "transaction" },
  operating: { label: "Operating Update", tone: "product" },
  operating_update: { label: "Operating Update", tone: "product" },
  strategic_transaction: { label: "M&A", tone: "transaction" },
};

const eventTypeTones: Record<string, LiveFeedV2EventTone> = {
  clinical: "product",
  deal: "transaction",
  dilution: "legal",
  earnings: "earnings",
  general: "neutral",
  market: "earnings",
  regulatory: "product",
  risk: "legal",
};

export function getLiveFeedV2EventPresentation(
  eventType: string | null | undefined,
  feedType: LiveFeedV2Kind,
): LiveFeedV2EventPresentation {
  if (feedType === "market") {
    return { label: "Market", tone: "neutral" };
  }

  const code = normalizeEventTypeCode(eventType);
  if (!code || code === "event" || code === "news" || code === "filing") {
    return { label: "Other", tone: "neutral" };
  }

  if (feedType === "filings") {
    return filingEventPresentations[code] || { label: "Other", tone: "neutral" };
  }

  const eventTypeBadge = getEventTypeBadge(code);
  const presentation = {
    label: eventTypeBadge.label,
    tone: eventTypeTones[eventTypeBadge.tone] || "neutral",
  } as const;

  if (eventTypeBadge.tone === "dilution") {
    return { ...presentation, emphasis: "dilution" };
  }

  return {
    ...presentation,
  };
}

function normalizeEventTypeCode(value: string | null | undefined) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
