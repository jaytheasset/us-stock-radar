import {
  getStockOverviewEventsApiHref,
  type StockOverviewEvent,
} from "./stockOverview.ts";

export type StockEventsFilter = "all" | "news" | "filings";
export type StockEventsRequestState =
  | "idle"
  | "loading"
  | "received"
  | "failed";
export type StockEventsResponseStatus = "unknown" | "success" | "failure";
export type StockEventsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "unavailable";
export type StockEventsRenderState = StockEventsStatus | "filtered_empty";

export type StockEventsRequestSnapshot = {
  apiOk: boolean | null;
  httpStatus: number | null;
  requestState: StockEventsRequestState;
  responseStatus: StockEventsResponseStatus;
  sourceResultCount: number | null;
};

export type StockEventsObservation = StockEventsRequestSnapshot & {
  filter: StockEventsFilter;
  filteredResultCount: number;
  message: string | null;
  remainingResultCount: number;
  renderedResultCount: number;
  renderState: StockEventsRenderState;
  requestHref: string;
  resultLabel: string;
  role: "status" | null;
  status: StockEventsStatus;
  ticker: string;
  title: string | null;
  visibleEvents: StockOverviewEvent[];
};

export function getStockEventsRequestHref(ticker: unknown) {
  return getStockOverviewEventsApiHref(ticker);
}

export function resolveStockEventsRequestSnapshot({
  httpStatus = null,
  payload,
  requestState,
}: {
  httpStatus?: number | null;
  payload?: unknown;
  requestState: StockEventsRequestState;
}): StockEventsRequestSnapshot {
  if (requestState !== "received") {
    return {
      apiOk: null,
      httpStatus: null,
      requestState,
      responseStatus: requestState === "failed" ? "failure" : "unknown",
      sourceResultCount: null,
    };
  }

  const safeStatus = safeHttpStatus(httpStatus);
  const response = asRecord(payload);
  const apiOk = typeof response?.ok === "boolean" ? response.ok : null;
  const rows = Array.isArray(response?.data) ? response.data : null;
  const succeeded =
    safeStatus !== null &&
    safeStatus >= 200 &&
    safeStatus < 300 &&
    apiOk === true &&
    rows !== null;

  return {
    apiOk,
    httpStatus: safeStatus,
    requestState,
    responseStatus: succeeded ? "success" : "failure",
    sourceResultCount: succeeded ? rows.length : null,
  };
}

export function resolveStockEventsObservation({
  events,
  filter,
  request,
  ticker,
  visibleEventCount,
}: {
  events: readonly StockOverviewEvent[];
  filter: StockEventsFilter;
  request: StockEventsRequestSnapshot;
  ticker: string;
  visibleEventCount: number;
}): StockEventsObservation {
  const requestHref = getStockEventsRequestHref(ticker) ?? "";
  const status = resolveStatus(request, events.length, Boolean(requestHref));
  const filteredEvents =
    status === "ready"
      ? events.filter((event) => {
          if (filter === "all") return true;
          if (filter === "filings") return event.sourceGroup === "filings";
          return event.sourceGroup !== "filings";
        })
      : [];
  const renderedLimit = nonNegativeInteger(visibleEventCount);
  const visibleEvents = filteredEvents.slice(0, renderedLimit);
  const renderState: StockEventsRenderState =
    status === "ready" && filter !== "all" && filteredEvents.length === 0
      ? "filtered_empty"
      : status;
  const presentation = presentationFor(renderState, ticker);

  return {
    ...request,
    filter,
    filteredResultCount: filteredEvents.length,
    message: presentation.message,
    remainingResultCount: Math.max(
      0,
      filteredEvents.length - visibleEvents.length,
    ),
    renderedResultCount: visibleEvents.length,
    renderState,
    requestHref,
    resultLabel: resultLabelFor(renderState, filteredEvents.length),
    role: presentation.role,
    status,
    ticker,
    title: presentation.title,
    visibleEvents,
  };
}

function resolveStatus(
  request: StockEventsRequestSnapshot,
  mappedResultCount: number,
  hasRequestHref: boolean,
): StockEventsStatus {
  if (request.requestState === "idle") return "idle";
  if (request.requestState === "loading") return "loading";
  if (
    request.requestState === "failed" ||
    request.responseStatus !== "success" ||
    request.apiOk !== true ||
    request.httpStatus === null ||
    !hasRequestHref ||
    request.sourceResultCount === null
  ) {
    return "unavailable";
  }
  if (request.sourceResultCount === 0 && mappedResultCount === 0) return "empty";
  if (
    request.sourceResultCount > 0 &&
    mappedResultCount > 0 &&
    mappedResultCount <= request.sourceResultCount
  ) {
    return "ready";
  }

  // A count alone never proves an empty result. Inconsistent response/mapping
  // state stays unavailable rather than being projected as an empty view.
  return "unavailable";
}

function presentationFor(renderState: StockEventsRenderState, ticker: string) {
  if (renderState === "idle") {
    return {
      message: "Preparing tracked events…",
      role: "status" as const,
      title: "Preparing tracked events",
    };
  }
  if (renderState === "loading") {
    return {
      message: "Loading tracked events…",
      role: "status" as const,
      title: "Loading tracked events",
    };
  }
  if (renderState === "empty") {
    return {
      message: `No tracked ${ticker} events were returned.`,
      role: "status" as const,
      title: "No tracked events",
    };
  }
  if (renderState === "filtered_empty") {
    return {
      message: `No tracked ${ticker} events match this filter.`,
      role: "status" as const,
      title: "No events in this view",
    };
  }
  if (renderState === "unavailable") {
    return {
      message: "Event data is temporarily unavailable.",
      role: "status" as const,
      title: "Events temporarily unavailable",
    };
  }
  return { message: null, role: null, title: null };
}

function resultLabelFor(
  renderState: StockEventsRenderState,
  filteredResultCount: number,
) {
  if (renderState === "idle") return "Events pending";
  if (renderState === "loading") return "Loading events";
  if (renderState === "unavailable") return "Events unavailable";
  return `${filteredResultCount} ${filteredResultCount === 1 ? "event" : "events"}`;
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
