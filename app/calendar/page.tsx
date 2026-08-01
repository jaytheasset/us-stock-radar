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
  const previewState: CalendarPreviewState =
    requestedState === "loading" || requestedState === "error" || requestedState === "empty"
      ? requestedState
      : "default";
  const today = getCalendarMarketDate();
  const initialRange = getPresetDateRange("this-week", today);
  let initialEvents: CalendarEvent[] = [];
  let initialLoadError = false;

  if (previewState === "default") {
    try {
      initialEvents = await getNormalizedCalendarEvents(initialRange);
    } catch {
      initialLoadError = true;
    }
  }

  return (
    <StockRadarAppShell activeNavigationItem="calendar" themeMode="user-selectable">
      <StockRadarCalendarV1
        initialEvents={initialEvents}
        initialLoadError={initialLoadError}
        initialRange={initialRange}
        initialWatchlistTickers={initialWatchlistTickers}
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
