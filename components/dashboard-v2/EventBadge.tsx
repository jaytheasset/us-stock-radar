import type { DashboardV2EventType } from "@/lib/mock/dashboardV2Data";

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

export function EventBadge({ type }: { type: DashboardV2EventType }) {
  return (
    <span className={`dashboard-v2-event-badge dashboard-v2-event-badge-${type}`}>
      {eventLabels[type]}
    </span>
  );
}
