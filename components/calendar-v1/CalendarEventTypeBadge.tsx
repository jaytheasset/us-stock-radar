import {
  Badge,
  type BadgeSize,
  type BadgeTone,
} from "@/components/ui/Badge";
import {
  eventTypeLabels,
  type CalendarEventType,
} from "@/lib/calendar-v1/model";
import styles from "./CalendarEventTypeBadge.module.css";

export const calendarEventBadgeTones = {
  earnings: "earnings",
  dividend: "neutral",
  split: "transaction",
  ipo: "product",
} as const satisfies Record<CalendarEventType, BadgeTone>;

export function getCalendarEventBadgeTone(eventType: CalendarEventType) {
  return calendarEventBadgeTones[eventType];
}

export function CalendarEventTypeBadge({
  eventType,
  size = "micro",
}: {
  eventType: CalendarEventType;
  size?: BadgeSize;
}) {
  return (
    <Badge
      className={eventType === "dividend" ? styles.dividend : undefined}
      data-calendar-event-type={eventType}
      size={size}
      tone={getCalendarEventBadgeTone(eventType)}
    >
      {eventTypeLabels[eventType]}
    </Badge>
  );
}
