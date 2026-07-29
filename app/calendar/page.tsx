import type { Metadata } from "next";
import {
  StockRadarCalendarV1,
  type CalendarPreviewState,
} from "@/components/calendar-v1/StockRadarCalendarV1";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { formatDateOnly } from "@/lib/calendar-v1/dateUtils";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calendar | Stock Radar",
  description: "Explore upcoming earnings, dividend, stock split, and IPO events.",
};

type CalendarPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const [params, viewerPlan] = await Promise.all([
    searchParams,
    getCurrentViewerPlan(),
  ]);
  const requestedState = firstParam(params.state);
  const previewState: CalendarPreviewState =
    requestedState === "loading" || requestedState === "error" || requestedState === "empty"
      ? requestedState
      : "default";

  return (
    <StockRadarAppShell activeNavigationItem="calendar" themeMode="user-selectable">
      <StockRadarCalendarV1
        previewState={previewState}
        today={formatDateOnly(new Date())}
        viewerPlan={viewerPlan}
      />
    </StockRadarAppShell>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
