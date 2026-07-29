import type { CalendarEvent, CalendarViewMode } from "./model.ts";

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
