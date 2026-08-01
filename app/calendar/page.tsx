import type { Metadata } from "next";
import {
  StockRadarCalendarV1,
  type CalendarPreviewState,
} from "@/components/calendar-v1/StockRadarCalendarV1";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import {
  getCalendarMarketDate,
  getPresetDateRange,
} from "@/lib/calendar-v1/dateUtils";
import type { CalendarEvent } from "@/lib/calendar-v1/model";
import { getNormalizedCalendarEvents } from "@/lib/calendar-v1/repository";
import { parseCalendarEventRouteSelection } from "@/lib/calendar-v1/presentation";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar | Stock Radar",
  description:
    "Explore upcoming Company, Macro, and Policy events across the U.S. market.",
};

type CalendarPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [params, viewerPlan, userId] = await Promise.all([
    searchParams,
    getCurrentViewerPlan(),
    getOptionalCurrentUserId(),
  ]);
  const initialWatchlistTickers = userId
    ? (await getWatchlistViewModel(userId)).items.map((item) => item.ticker)
    : [];
  const requestedState = firstParam(params.state);
  const requestedSelection = parseCalendarEventRouteSelection(
    firstParam(params.event),
    firstParam(params.date),
  );
  const previewState: CalendarPreviewState =
    requestedState === "loading" || requestedState === "error" || requestedState === "empty"
      ? requestedState
      : "default";
  const today = getCalendarMarketDate();
  const requestedDate = requestedSelection?.eventDate ?? today;
  const initialRange = getPresetDateRange("this-week", requestedDate);
  let initialEvents: CalendarEvent[] = [];
  let initialLoadError = false;

  if (previewState === "default") {
    try {
      initialEvents = await getNormalizedCalendarEvents(initialRange);
    } catch {
      initialLoadError = true;
    }
  }

  const selectedEvent = requestedSelection
    ? initialEvents.find(
        (event) =>
          event.id === requestedSelection.eventId &&
          event.eventDate === requestedSelection.eventDate,
      ) ?? null
    : null;

  return (
    <StockRadarAppShell activeNavigationItem="calendar" themeMode="user-selectable">
      <StockRadarCalendarV1
        initialEvents={initialEvents}
        initialLoadError={initialLoadError}
        initialRange={initialRange}
        initialWatchlistTickers={initialWatchlistTickers}
        initialSelectedDate={selectedEvent?.eventDate ?? requestedDate}
        initialSelectedEventId={selectedEvent?.id ?? null}
        previewState={previewState}
        today={today}
        viewerPlan={viewerPlan}
        viewerAuthenticated={Boolean(userId)}
      />
    </StockRadarAppShell>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
