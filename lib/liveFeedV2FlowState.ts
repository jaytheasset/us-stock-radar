import {
  liveFeedV2Filters,
  type LiveFeedV2Filter,
  type LiveFeedV2Page,
} from "./liveFeedV2Contract.ts";

export type LiveFeedV2ObservedAvailability =
  | LiveFeedV2Page["availability"]
  | "unknown";

export type LiveFeedV2FlowStatus =
  | "loading"
  | "unavailable"
  | "error"
  | "empty"
  | "ready"
  | "unknown";

export type LiveFeedV2FlowState = {
  availability: LiveFeedV2ObservedAvailability;
  filter: LiveFeedV2Filter;
  message: string | null;
  resultLabel: string;
  role: "alert" | "status" | null;
  rowCount: number;
  status: LiveFeedV2FlowStatus;
  title: string | null;
  totalCount: number | null;
};

export function resolveLiveFeedV2FlowState({
  availability,
  emptyMessage,
  filter,
  hasError,
  isLoading,
  rowCount,
  totalCount,
}: {
  availability: LiveFeedV2ObservedAvailability;
  emptyMessage?: string;
  filter: LiveFeedV2Filter;
  hasError: boolean;
  isLoading: boolean;
  rowCount: number;
  totalCount: number | null;
}): LiveFeedV2FlowState {
  const filterLabel =
    liveFeedV2Filters.find((candidate) => candidate.value === filter)?.label ??
    "Feed";
  const normalizedRowCount = Math.max(0, Math.trunc(rowCount));

  if (isLoading) {
    return createState({
      availability,
      filter,
      message: "Retrieving the latest events for this feed.",
      resultLabel: "Updating events",
      role: "status",
      rowCount: normalizedRowCount,
      status: "loading",
      title: "Updating events",
      totalCount,
    });
  }

  if (hasError) {
    return createState({
      availability,
      filter,
      message: "The current data source did not respond. Try again shortly.",
      resultLabel: `Request failed · ${formatEventCount(normalizedRowCount)}`,
      role: "alert",
      rowCount: normalizedRowCount,
      status: "error",
      title: "Events are temporarily unavailable",
      totalCount,
    });
  }

  if (availability === "unavailable") {
    return createState({
      availability,
      filter,
      message:
        emptyMessage ||
        `${filterLabel} activity is not available in Live Feed right now.`,
      resultLabel: `Unavailable · ${formatEventCount(normalizedRowCount)}`,
      role: "status",
      rowCount: normalizedRowCount,
      status: "unavailable",
      title: `${filterLabel} activity unavailable`,
      totalCount,
    });
  }

  if (availability === "available" && normalizedRowCount === 0) {
    return createState({
      availability,
      filter,
      message: emptyMessage || "Choose another feed filter.",
      resultLabel: formatResultCount(normalizedRowCount, totalCount),
      role: "status",
      rowCount: normalizedRowCount,
      status: "empty",
      title: "No matching events",
      totalCount,
    });
  }

  if (availability === "available") {
    return createState({
      availability,
      filter,
      message: null,
      resultLabel: formatResultCount(normalizedRowCount, totalCount),
      role: null,
      rowCount: normalizedRowCount,
      status: "ready",
      title: null,
      totalCount,
    });
  }

  return createState({
    availability,
    filter,
    message: "The selected feed has not returned a confirmed status.",
    resultLabel: `Status unknown · ${formatEventCount(normalizedRowCount)}`,
    role: "status",
    rowCount: normalizedRowCount,
    status: "unknown",
    title: "Feed status not confirmed",
    totalCount,
  });
}

function createState(state: LiveFeedV2FlowState) {
  return state;
}

function formatResultCount(loaded: number, total: number | null) {
  return total === null
    ? formatEventCount(loaded)
    : `${loaded} of ${total} events`;
}

function formatEventCount(count: number) {
  return `${count} ${count === 1 ? "event" : "events"}`;
}
