import { Badge, type BadgeSize } from "@/components/ui/Badge";
import { getDashboardV2ShortEventLabel } from "@/lib/dashboardV2Events";
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
      {getDashboardV2ShortEventLabel(event)}
    </Badge>
  );
}

export function getEventAccessibleLabel(event: DashboardV2Event) {
  return event.label;
}
