import type { CalendarEvent, CalendarViewMode } from "./model.ts";

export function formatEventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
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
