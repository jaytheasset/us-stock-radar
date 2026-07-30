import type {
  CalendarCategory,
  CalendarDateRange,
  CalendarEvent,
  CalendarFilters,
  CalendarRangePreset,
} from "./model.ts";
import { eventTypeCategories } from "./model.ts";
import {
  getCalendarEventIdentity,
  getCalendarEventSearchText,
  isCalendarEventWatchlistMatch,
} from "./presentation.ts";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const CALENDAR_MARKET_TIME_ZONE = "America/New_York";

export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new RangeError(`Invalid date-only value: ${value}`);

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day, 12);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    throw new RangeError(`Invalid date-only value: ${value}`);
  }

  return date;
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatEnglishDatePickerValue(value: string): string {
  return parseDateOnly(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function getCalendarMarketDate(date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Invalid market date instant");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CALENDAR_MARKET_TIME_ZONE,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  const value = `${values.year}-${values.month}-${values.day}`;
  parseDateOnly(value);
  return value;
}

export function addDateOnlyDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setDate(date.getDate() + days);
  return formatDateOnly(date);
}

export function startOfLocalWeek(value: string): string {
  const date = parseDateOnly(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return formatDateOnly(date);
}

export function getPresetDateRange(
  preset: Exclude<CalendarRangePreset, "custom">,
  today: string,
): CalendarDateRange {
  if (preset === "today") return { from: today, to: today };
  const thisWeekStart = startOfLocalWeek(today);
  const from = preset === "next-week" ? addDateOnlyDays(thisWeekStart, 7) : thisWeekStart;
  return { from, to: addDateOnlyDays(from, 6) };
}

export function normalizeDateRange(range: CalendarDateRange): CalendarDateRange {
  parseDateOnly(range.from);
  parseDateOnly(range.to);
  return range.from <= range.to ? range : { from: range.to, to: range.from };
}

export function shiftDateRange(range: CalendarDateRange, direction: -1 | 1): CalendarDateRange {
  const normalized = normalizeDateRange(range);
  const days = daysBetween(normalized.from, normalized.to) + 1;
  return {
    from: addDateOnlyDays(normalized.from, days * direction),
    to: addDateOnlyDays(normalized.to, days * direction),
  };
}

export function enumerateDateRange(range: CalendarDateRange): string[] {
  const normalized = normalizeDateRange(range);
  const dates: string[] = [];
  let cursor = normalized.from;
  while (cursor <= normalized.to) {
    dates.push(cursor);
    cursor = addDateOnlyDays(cursor, 1);
  }
  return dates;
}

export function rangeContainsDate(range: CalendarDateRange, value: string): boolean {
  const normalized = normalizeDateRange(range);
  return value >= normalized.from && value <= normalized.to;
}

export function filterCalendarEvents(
  events: readonly CalendarEvent[],
  range: CalendarDateRange,
  filters: CalendarFilters,
  watchlistTickers: ReadonlySet<string> = new Set(),
): CalendarEvent[] {
  const normalizedRange = normalizeDateRange(range);
  const query = filters.query.trim().toLocaleLowerCase("en-US");

  return events
    .filter((event) => event.eventDate >= normalizedRange.from && event.eventDate <= normalizedRange.to)
    .filter((event) => filters.category === "all" || event.category === filters.category)
    .filter((event) => filters.eventType === "all" || event.eventType === filters.eventType)
    .filter(
      (event) =>
        !filters.watchlistOnly ||
        isCalendarEventWatchlistMatch(event, watchlistTickers),
    )
    .filter(
      (event) =>
        filters.marketSession === "all" || event.marketSession === filters.marketSession,
    )
    .filter((event) => filters.status === "all" || event.status === filters.status)
    .filter((event) => {
      if (!query) return true;
      return getCalendarEventSearchText(event).includes(query);
    })
    .sort(compareCalendarEvents);
}

export function groupCalendarEventsByDate(
  events: readonly CalendarEvent[],
  today: string,
): Array<{ date: string; events: CalendarEvent[] }> {
  const groups = new Map<string, CalendarEvent[]>();
  sortCalendarEventsByDateContext(events, today).forEach((event) => {
    const group = groups.get(event.eventDate) ?? [];
    group.push(event);
    groups.set(event.eventDate, group);
  });
  return Array.from(groups, ([date, groupedEvents]) => ({ date, events: groupedEvents }));
}

export function countActiveCalendarFilters(filters: CalendarFilters): number {
  return [
    filters.category !== "all",
    filters.eventType !== "all",
    filters.watchlistOnly,
    filters.marketSession !== "all",
    filters.status !== "all",
    Boolean(filters.query.trim()),
  ].filter(Boolean).length;
}

export function updateCalendarCategoryFilter(
  filters: CalendarFilters,
  category: CalendarCategory | "all",
): CalendarFilters {
  const eventType =
    filters.eventType === "all" ||
    category === "all" ||
    eventTypeCategories[filters.eventType] === category
      ? filters.eventType
      : "all";
  return { ...filters, category, eventType };
}

export function formatRangeLabel(range: CalendarDateRange): string {
  const normalized = normalizeDateRange(range);
  const from = parseDateOnly(normalized.from);
  const to = parseDateOnly(normalized.to);
  const sameYear = from.getFullYear() === to.getFullYear();
  if (normalized.from === normalized.to) {
    return from.toLocaleDateString("en-US", {
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  const fromLabel = from.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const toLabel = to.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${fromLabel} – ${toLabel}`;
}

export function daysBetween(from: string, to: string): number {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function sortCalendarEventsByDateContext(
  events: readonly CalendarEvent[],
  today: string,
): CalendarEvent[] {
  parseDateOnly(today);
  return [...events].sort((a, b) => {
    const dateOrder = a.eventDate.localeCompare(b.eventDate);
    if (dateOrder) return dateOrder;

    const statusOrder =
      getDateContextStatusRank(a, today) - getDateContextStatusRank(b, today);
    return statusOrder || compareCalendarEventTimeAndIdentity(a, b);
  });
}

function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  return (
    a.eventDate.localeCompare(b.eventDate) ||
    compareCalendarEventTimeAndIdentity(a, b)
  );
}

function compareCalendarEventTimeAndIdentity(
  a: CalendarEvent,
  b: CalendarEvent,
): number {
  return (
    (a.eventTime ?? "99:99").localeCompare(b.eventTime ?? "99:99") ||
    getCalendarEventIdentity(a).primaryLabel.localeCompare(
      getCalendarEventIdentity(b).primaryLabel,
    )
  );
}

function getDateContextStatusRank(
  event: CalendarEvent,
  today: string,
): number {
  if (event.status === "postponed") return 3;
  if (event.status === "cancelled") return 4;

  if (event.eventDate < today) {
    if (event.status === "completed") return 0;
    return event.status === "confirmed" ? 1 : 2;
  }

  if (event.status === "confirmed") return 0;
  if (event.status === "estimated") return 1;
  return 2;
}
