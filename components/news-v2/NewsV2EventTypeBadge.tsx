import { Badge, type BadgeSize, type BadgeTone } from "@/components/ui/Badge";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";

const eventTypeTones: Record<string, BadgeTone> = {
  earnings: "earnings",
  dilution: "legal",
  risk: "legal",
  deal: "transaction",
  clinical: "product",
  regulatory: "product",
  market: "earnings",
  general: "neutral",
};

type NewsV2EventTypeBadgeProps = {
  className?: string;
  eventType: string;
  eventTypeCode?: string;
  size?: BadgeSize;
};

export function NewsV2EventTypeBadge({
  className,
  eventType,
  eventTypeCode,
  size = "small",
}: NewsV2EventTypeBadgeProps) {
  const badgeDefinition = getEventTypeBadge(eventTypeCode || eventType);

  return (
    <Badge
      aria-label={eventType}
      className={className}
      data-event-emphasis={
        badgeDefinition.tone === "dilution" ? "dilution" : undefined
      }
      size={size}
      title={eventType}
      tone={eventTypeTones[badgeDefinition.tone] || "neutral"}
    >
      {eventType}
    </Badge>
  );
}
