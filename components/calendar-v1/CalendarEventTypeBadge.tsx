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
  cpi: "earnings",
  ppi: "earnings",
  pce: "earnings",
  "employment-situation": "earnings",
  jolts: "neutral",
  "gdp-advance": "earnings",
  "retail-sales": "neutral",
  "fomc-decision": "legal",
  "fomc-minutes": "legal",
  "fed-chair-testimony": "legal",
  "treasury-borrowing-estimate": "transaction",
  "treasury-refunding": "transaction",
  "treasury-auction-10y": "transaction",
  "treasury-auction-30y": "transaction",
  "sec-open-meeting": "legal",
  "sec-rule-milestone": "legal",
  "trade-policy-action": "transaction",
  "fda-advisory-committee": "legal",
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
