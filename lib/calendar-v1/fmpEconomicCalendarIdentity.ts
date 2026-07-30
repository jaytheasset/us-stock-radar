import type { FmpEconomicCalendarEventType } from "./fmpEconomicCalendarTypes.ts";

const MONTHS = new Map<string, number>(
  [
    ["jan", 1],
    ["feb", 2],
    ["mar", 3],
    ["apr", 4],
    ["may", 5],
    ["jun", 6],
    ["jul", 7],
    ["aug", 8],
    ["sep", 9],
    ["oct", 10],
    ["nov", 11],
    ["dec", 12],
  ] as const,
);

export type FmpReferencePeriod = {
  display: string;
  identity: string;
};

export function extractFmpReferencePeriod(
  eventName: string,
  eventDate: string,
): FmpReferencePeriod | null {
  const [eventYear, eventMonth] = eventDate.split("-").map(Number);
  const monthMatch = eventName.match(/\(([A-Z][a-z]{2})(?:\/\d{2})?\)\s*$/);
  if (monthMatch) {
    const month = MONTHS.get(monthMatch[1].toLowerCase());
    if (!month) return null;
    const year = month > eventMonth ? eventYear - 1 : eventYear;
    return {
      display: `${monthName(month)} ${year}`,
      identity: `${year}-${String(month).padStart(2, "0")}`,
    };
  }

  const quarterMatch = eventName.match(/\(Q([1-4])\)\s*$/i);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const eventQuarter = Math.floor((eventMonth - 1) / 3) + 1;
    const year = quarter > eventQuarter ? eventYear - 1 : eventYear;
    return {
      display: `Q${quarter} ${year}`,
      identity: `${year}-q${quarter}`,
    };
  }
  return null;
}

export function buildFmpEconomicCalendarIdentity(input: {
  eventDate: string;
  eventType: FmpEconomicCalendarEventType;
  referencePeriod: FmpReferencePeriod | null;
}) {
  if (input.referencePeriod) {
    return `fmp:${categoryFor(input.eventType)}:${input.eventType}:${input.referencePeriod.identity}`;
  }

  const [year, month] = input.eventDate.split("-").map(Number);
  if (input.eventType === "treasury-refunding") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `fmp:policy:${input.eventType}:${year}:q${quarter}`;
  }
  return `fmp:policy:${input.eventType}:${year}-${String(month).padStart(2, "0")}`;
}

function categoryFor(eventType: FmpEconomicCalendarEventType) {
  return eventType.startsWith("fomc-") ||
    eventType.startsWith("treasury-")
    ? "policy"
    : "macro";
}

function monthName(month: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, month - 1, 1)));
}
