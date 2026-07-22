import { Badge, type BadgeSize } from "@/components/ui/Badge";
import type { DashboardV2Event } from "@/lib/dashboardV2Types";

type EventBadgeProps = {
  event: DashboardV2Event;
  size?: BadgeSize;
};

export function EventBadge({ event, size = "small" }: EventBadgeProps) {
  return (
    <Badge
      aria-label={event.label}
      className="dashboard-v2-event-badge"
      size={size}
      title={event.label}
      tone={event.tone}
    >
      {shortEventLabel(event)}
    </Badge>
  );
}

export function getEventAccessibleLabel(event: DashboardV2Event) {
  return event.label;
}

function shortEventLabel(event: DashboardV2Event) {
  const knownLabels: Record<string, string> = {
    dilution_risk: "DILUTION",
    earnings: "EARN",
    fda_clinical: "PRODUCT",
    insider_ownership: "INSIDER",
    ipo_listing: "LISTING",
    legal_risk: "LEGAL",
    listing_risk: "LISTING",
    product_update: "PRODUCT",
    strategic_transaction: "M&A",
  };
  return knownLabels[event.code] || event.label.toUpperCase().slice(0, 10);
}
