import type { DashboardV2EventType } from "@/lib/mock/dashboardV2Data";
import { Badge, type BadgeSize, type BadgeTone } from "@/components/ui/Badge";

const eventLabels: Record<DashboardV2EventType, string> = {
  dilution: "DILUTION",
  earnings: "EARN",
  govt: "GOVT",
  insider: "INSIDER",
  legal: "LEGAL",
  listing: "LISTING",
  ma: "M&A",
  product: "PRODUCT",
};

const eventTones: Record<DashboardV2EventType, BadgeTone> = {
  dilution: "neutral",
  earnings: "earnings",
  govt: "neutral",
  insider: "insider",
  legal: "legal",
  listing: "transaction",
  ma: "transaction",
  product: "product",
};

type EventBadgeProps = {
  size?: BadgeSize;
  type: DashboardV2EventType;
};

export function EventBadge({ size = "small", type }: EventBadgeProps) {
  return (
    <Badge className="dashboard-v2-event-badge" size={size} tone={eventTones[type]}>
      {eventLabels[type]}
    </Badge>
  );
}
