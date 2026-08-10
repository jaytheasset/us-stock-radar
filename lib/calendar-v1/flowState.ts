import type { CalendarDateRange } from "./model.ts";
import { formatEventCount } from "./presentation.ts";

export type CalendarFlowStatus =
  | "loading"
  | "ready"
  | "source-empty"
  | "filter-empty"
  | "unavailable"
  | "unknown";

export type CalendarFlowState = {
  actionLabel: string | null;
  activeFilterCount: number;
  message: string | null;
  rangeFrom: string;
  rangeTo: string;
  resultLabel: string;
  role: "alert" | "status" | null;
  sourceCount: number;
  status: CalendarFlowStatus;
  title: string | null;
  visibleCount: number;
};

export function resolveCalendarFlowState({
  activeFilterCount,
  loadState,
  range,
  sourceCount,
  visibleCount,
}: {
  activeFilterCount: number;
  loadState: "ready" | "loading" | "error";
  range: CalendarDateRange;
  sourceCount: number;
  visibleCount: number;
}): CalendarFlowState {
  const normalizedSourceCount = normalizeCount(sourceCount);
  const normalizedVisibleCount = normalizeCount(visibleCount);
  const normalizedActiveFilterCount = normalizeCount(activeFilterCount);
  const countsAreValid = [sourceCount, visibleCount, activeFilterCount].every(
    (count) => Number.isInteger(count) && count >= 0,
  );
  const base = {
    activeFilterCount: normalizedActiveFilterCount,
    rangeFrom: range.from,
    rangeTo: range.to,
    sourceCount: normalizedSourceCount,
    visibleCount: normalizedVisibleCount,
  };

  if (loadState === "loading") {
    return {
      ...base,
      actionLabel: null,
      message: "Preparing the selected event range.",
      resultLabel: "Loading events",
      role: "status",
      status: "loading",
      title: "Loading calendar events",
    };
  }

  if (loadState === "error") {
    return {
      ...base,
      actionLabel: "Retry",
      message: "Try the selected range again. No saved data was changed.",
      resultLabel: "Events unavailable",
      role: "alert",
      status: "unavailable",
      title: "Calendar events could not be loaded",
    };
  }

  if (!countsAreValid) {
    return unknownState(base);
  }

  if (normalizedSourceCount === 0 && normalizedVisibleCount === 0) {
    return {
      ...base,
      actionLabel: "Reload range",
      message: "Move to another period to continue exploring events.",
      resultLabel: "0 events",
      role: "status",
      status: "source-empty",
      title: "No events in this range",
    };
  }

  if (
    normalizedSourceCount > 0 &&
    normalizedVisibleCount === 0 &&
    normalizedActiveFilterCount > 0
  ) {
    return {
      ...base,
      actionLabel: "Reset filters",
      message: "Clear the filters or search to see the full calendar.",
      resultLabel: "0 events",
      role: "status",
      status: "filter-empty",
      title: "No events match these filters",
    };
  }

  if (
    normalizedSourceCount > 0 &&
    normalizedVisibleCount > 0 &&
    normalizedVisibleCount <= normalizedSourceCount
  ) {
    return {
      ...base,
      actionLabel: null,
      message: null,
      resultLabel: formatEventCount(normalizedVisibleCount),
      role: null,
      status: "ready",
      title: null,
    };
  }

  return unknownState(base);
}

function unknownState(
  base: Pick<
    CalendarFlowState,
    | "activeFilterCount"
    | "rangeFrom"
    | "rangeTo"
    | "sourceCount"
    | "visibleCount"
  >,
): CalendarFlowState {
  return {
    ...base,
    actionLabel: "Retry",
    message: "The selected range did not return a confirmed calendar state.",
    resultLabel: "State not confirmed",
    role: "status",
    status: "unknown",
    title: "Calendar state not confirmed",
  };
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
