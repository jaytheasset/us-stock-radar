import type { NewsV2FilterState } from "./newsV2.ts";

export type NewsV2FlowStatus =
  | "loading"
  | "ready"
  | "source-empty"
  | "filter-empty"
  | "unavailable";

export type NewsV2FlowState = {
  hasActiveCriteria: boolean;
  message: string | null;
  resultLabel: string;
  role: "alert" | "status" | null;
  status: NewsV2FlowStatus;
  title: string | null;
  totalCount: number;
  visibleCount: number;
};

export function resolveNewsV2FlowState({
  filters,
  hasError,
  isLoading,
  itemCount,
  query,
  totalCount,
}: {
  filters: NewsV2FilterState;
  hasError: boolean;
  isLoading: boolean;
  itemCount: number;
  query: string;
  totalCount: number;
}): NewsV2FlowState {
  const visibleCount = normalizeCount(itemCount);
  const normalizedTotalCount = Math.max(visibleCount, normalizeCount(totalCount));
  const hasActiveCriteria =
    query.trim().length > 0 ||
    Object.values(filters).some((values) => values.length > 0);
  const resultCount = `${visibleCount} of ${normalizedTotalCount} stories`;

  if (isLoading) {
    return {
      hasActiveCriteria,
      message: "Updating the selected News view.",
      resultLabel: `Updating · ${resultCount}`,
      role: "status",
      status: "loading",
      title: "Loading news",
      totalCount: normalizedTotalCount,
      visibleCount,
    };
  }

  if (visibleCount > 0) {
    return {
      hasActiveCriteria,
      message: null,
      resultLabel: resultCount,
      role: null,
      status: "ready",
      title: null,
      totalCount: normalizedTotalCount,
      visibleCount,
    };
  }

  if (hasError) {
    return {
      hasActiveCriteria,
      message: "News data is currently unavailable.",
      resultLabel: "Unavailable · 0 stories",
      role: "alert",
      status: "unavailable",
      title: "News unavailable",
      totalCount: normalizedTotalCount,
      visibleCount,
    };
  }

  if (hasActiveCriteria) {
    return {
      hasActiveCriteria,
      message: "Try another search or remove one of the active filters.",
      resultLabel: resultCount,
      role: "status",
      status: "filter-empty",
      title: "No matching news",
      totalCount: normalizedTotalCount,
      visibleCount,
    };
  }

  return {
    hasActiveCriteria,
    message: "The current News source returned no stories.",
    resultLabel: resultCount,
    role: "status",
    status: "source-empty",
    title: "No news available",
    totalCount: normalizedTotalCount,
    visibleCount,
  };
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
