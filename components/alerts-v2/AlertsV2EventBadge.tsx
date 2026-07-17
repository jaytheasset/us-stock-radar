import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  getAlertsV2EventLabel,
  type AlertsV2EventType,
} from "@/lib/mock/alertsV2Data";

const eventTones: Record<AlertsV2EventType, BadgeTone> = {
  dilution: "legal",
  earnings: "earnings",
  filing: "neutral",
  insider: "insider",
  legal: "legal",
  listing: "transaction",
  macro: "product",
  volume: "neutral",
};

export function AlertsV2EventBadge({
  eventType,
  size = "small",
}: {
  eventType: AlertsV2EventType;
  size?: "micro" | "small" | "large";
}) {
  return (
    <Badge size={size} tone={eventTones[eventType]}>
      {getAlertsV2EventLabel(eventType)}
    </Badge>
  );
}
