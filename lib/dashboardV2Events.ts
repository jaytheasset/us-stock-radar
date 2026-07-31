import type { DashboardV2Event } from "./dashboardV2Types.ts";

const shortEventLabels: Record<string, string> = {
  capital_return: "BUYBACK",
  dilution_risk: "DILUTION",
  dividends: "DIVIDEND",
  earnings: "EARN",
  fda_clinical: "FDA/TRIAL",
  financial_risk: "FIN RISK",
  insider_ownership: "INSIDER",
  ipo_listing: "IPO/LIST",
  leadership_governance: "LEAD/GOV",
  legal_risk: "LEGAL",
  listing_risk: "LIST RISK",
  operating_update: "OPS",
  other: "OTHER",
  product_update: "PRODUCT",
  sales_performance: "SALES",
  shareholder_vote: "VOTE",
  strategic_transaction: "M&A",
};

export function normalizeDashboardV2EventScore(value: unknown) {
  const score =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : 0;
}

export function includesDashboardV2EventDeliveryLevel(value: unknown) {
  const deliveryLevel =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return deliveryLevel === "feed" || deliveryLevel === "alert";
}

export function sortDashboardV2Events(
  events: readonly DashboardV2Event[],
): DashboardV2Event[] {
  return [...events].sort((left, right) => {
    const scoreDifference =
      normalizeDashboardV2EventScore(right.score) -
      normalizeDashboardV2EventScore(left.score);
    if (scoreDifference) return scoreDifference;

    const timestampDifference =
      eventTimestampValue(right.timestamp) -
      eventTimestampValue(left.timestamp);
    if (timestampDifference) return timestampDifference;

    return left.id.localeCompare(right.id);
  });
}

export function selectDashboardV2EventTypeBadges(
  events: readonly DashboardV2Event[],
  limit: number,
) {
  const representatives: DashboardV2Event[] = [];
  const seenEventTypes = new Set<string>();

  for (const event of sortDashboardV2Events(events)) {
    const eventType = event.code.trim().toLowerCase();
    if (!eventType || seenEventTypes.has(eventType)) continue;
    seenEventTypes.add(eventType);
    representatives.push(event);
  }

  const visibleLimit = Math.max(0, Math.floor(limit));
  return {
    hidden: representatives.slice(visibleLimit),
    representatives,
    visible: representatives.slice(0, visibleLimit),
  };
}

export function getDashboardV2ShortEventLabel(event: DashboardV2Event) {
  return (
    shortEventLabels[event.code.trim().toLowerCase()] ||
    event.label.toUpperCase().slice(0, 10)
  );
}

function eventTimestampValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
