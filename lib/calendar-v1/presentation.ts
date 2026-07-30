import {
  eventStatusLabels,
  eventTypeLabels,
  impactLevelLabels,
  type CalendarEvent,
  type CalendarViewMode,
  type MacroMetric,
} from "./model.ts";

export type CalendarEventIdentity = {
  primaryLabel: string;
  secondaryLabel: string;
  primaryTicker: string | null;
  relevantTickers: readonly string[];
};

export function formatEventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export function selectUpcomingCalendarEvents(
  events: readonly CalendarEvent[],
  selectedDate: string,
  limit = 5,
) {
  const selectedDateEventCount = events.filter(
    (event) => event.eventDate === selectedDate,
  ).length;
  if (selectedDateEventCount >= 3) return null;

  return events
    .map((event, stableIndex) => ({ event, stableIndex }))
    .filter(({ event }) => event.eventDate > selectedDate)
    .sort(
      (left, right) =>
        left.event.eventDate.localeCompare(right.event.eventDate) ||
        left.stableIndex - right.stableIndex,
    )
    .slice(0, Math.max(0, limit))
    .map(({ event }) => event);
}

export function selectCalendarPreviewEvent(
  events: readonly CalendarEvent[],
  selectedDate: string,
  viewMode: CalendarViewMode,
  selectedEventId: string | null,
) {
  const selectedDateEvents =
    viewMode === "calendar"
      ? events.filter((event) => event.eventDate === selectedDate)
      : [];
  const candidates =
    selectedDateEvents.length > 0 ? selectedDateEvents : events;

  return (
    candidates.find((event) => event.id === selectedEventId) ??
    candidates[0] ??
    null
  );
}

export function getCalendarEventIdentity(
  event: CalendarEvent,
): CalendarEventIdentity {
  if (event.category === "company") {
    return {
      primaryLabel: event.ticker ?? "TBA",
      secondaryLabel: event.companyName,
      primaryTicker: event.ticker,
      relevantTickers: event.ticker ? [event.ticker] : [],
    };
  }

  if (event.category === "macro") {
    return {
      primaryLabel: eventTypeLabels[event.eventType],
      secondaryLabel: event.sourceAgency,
      primaryTicker: null,
      relevantTickers: [],
    };
  }

  return {
    primaryLabel:
      event.primaryTicker ?? eventTypeLabels[event.eventType],
    secondaryLabel: event.sourceAgency,
    primaryTicker: event.primaryTicker,
    relevantTickers: event.relatedTickers,
  };
}

export function getCalendarCompactIdentity(event: CalendarEvent) {
  if (event.category === "company") return event.ticker ?? "TBA";
  return event.sourceAgency;
}

export function isCalendarEventWatchlistMatch(
  event: CalendarEvent,
  watchlistTickers: ReadonlySet<string>,
) {
  if (event.category === "company") return event.isWatchlisted;
  if (event.category === "macro") return false;
  return event.relatedTickers.some((ticker) => watchlistTickers.has(ticker));
}

export function getCalendarEventSearchText(event: CalendarEvent) {
  const identity = getCalendarEventIdentity(event);
  const detailSearch =
    event.category === "policy"
      ? [
          event.policySubcategory,
          event.eventType === "trade-policy-action"
            ? event.details.affectedIndustries.join(" ")
            : "",
        ].join(" ")
      : "";

  return [
    event.title,
    eventTypeLabels[event.eventType],
    event.sourceAgency,
    event.sourceName,
    event.affectedSectors.join(" "),
    event.relatedTickers.join(" "),
    identity.primaryLabel,
    identity.secondaryLabel,
    detailSearch,
  ]
    .join(" ")
    .toLocaleLowerCase("en-US");
}

export function formatCalendarEventTime(event: CalendarEvent) {
  if (event.timeStatus === "all-day") return "All day";
  if (event.timeStatus === "time-not-announced" || !event.eventTime) {
    return "Time Not Announced";
  }
  return `${formatClockTime(event.eventTime)} ET`;
}

export function getCalendarEventMeta(event: CalendarEvent) {
  return {
    impact: impactLevelLabels[event.impactLevel],
    status: eventStatusLabels[event.status],
    time: formatCalendarEventTime(event),
  };
}

export function getCalendarEventContext(event: CalendarEvent) {
  if (event.category === "company") return event.sourceAgency;
  if (event.category === "macro") {
    const metric = event.details.metrics[0];
    if (!metric) {
      return [event.sourceAgency, event.details.referencePeriod]
        .filter(Boolean)
        .join(" · ");
    }
    const actual = metric.released
      ? formatMacroMetricValue(metric.actual, metric.unit)
      : "Not released";
    return `${event.sourceAgency} · Actual ${actual} · Consensus ${formatMacroMetricValue(
      metric.consensus,
      metric.unit,
    )} · Previous ${formatMacroMetricValue(metric.previous, metric.unit)}`;
  }

  let stage: string | null = event.policySubcategory;
  let industries: readonly string[] = event.affectedSectors;
  if (
    event.eventType === "sec-open-meeting" ||
    event.eventType === "sec-rule-milestone"
  ) {
    stage = event.details.milestone;
  } else if (event.eventType === "trade-policy-action") {
    stage = event.details.actionDateKind;
    industries = event.details.affectedIndustries;
  } else if (
    event.eventType === "treasury-borrowing-estimate" ||
    event.eventType === "treasury-refunding" ||
    event.eventType === "treasury-auction-10y" ||
    event.eventType === "treasury-auction-30y"
  ) {
    stage = [event.details.kind, event.details.maturity].filter(Boolean).join(" ");
  } else if (event.eventType === "fda-advisory-committee") {
    stage = event.details.committee;
  }
  return [
    event.sourceAgency,
    stage?.replaceAll("-", " "),
    industries.join(", "),
    event.relatedTickers.join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatMacroMetricValue(
  value: number | null,
  unit: MacroMetric["unit"],
) {
  if (value === null) return "Not announced";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "thousands") return `${value.toLocaleString("en-US")}K`;
  if (unit === "billions-usd") return `$${value.toFixed(1)}B`;
  return value.toLocaleString("en-US");
}

function formatClockTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
