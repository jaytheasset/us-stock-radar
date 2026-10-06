import {
  mapTickerSearchResults,
  parseTickerSearchResponse,
  TICKER_SEARCH_UNAVAILABLE_MESSAGE,
  TICKER_SEARCH_PARTIAL_MESSAGE,
  normalizeTickerSearchQuery,
  normalizeTickerSymbol,
  type TickerSearchResult,
} from "./tickerSearchContract.ts";

export const TICKER_SEARCH_SELECTION_STORAGE_KEY =
  "stock-radar:ticker-search-selection:v1";

export type TickerSearchRequestState =
  | "idle"
  | "loading"
  | "received"
  | "failed";
export type TickerSearchResponseStatus = "unknown" | "success" | "partial" | "failure";
export type TickerSearchStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "unavailable";
export type StockDetailRenderState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

export type TickerSearchRequestSnapshot = {
  apiOk: boolean | null;
  httpStatus: number | null;
  requestState: TickerSearchRequestState;
  responseStatus: TickerSearchResponseStatus;
  sourceResultCount: number | null;
};

export type TickerSearchObservation = TickerSearchRequestSnapshot & {
  activeTicker: string | null;
  message: string;
  query: string;
  renderedResultCount: number;
  results: TickerSearchResult[];
  role: "alert" | "status" | null;
  requestHref: string;
  status: TickerSearchStatus;
};

export type TickerSearchSelectionSnapshot = {
  apiOk: true;
  httpStatus: number;
  query: string;
  renderedResultCount: number;
  requestHref: string;
  requestState: "received";
  responseStatus: "success" | "partial";
  selectedTicker: string;
  selectionHref: string;
  sourceResultCount: number;
  status: "ready";
  version: "ticker-search-selection-v1";
};

export type TickerSearchFlowReadoutState = {
  activeTicker: string | null;
  apiOk: boolean | null;
  detailRenderState: StockDetailRenderState | "not_rendered";
  httpStatus: number | null;
  query: string;
  renderedResultCount: number | null;
  renderedTicker: string | null;
  requestHref: string;
  requestState: TickerSearchRequestState | "unobserved";
  responseStatus: TickerSearchResponseStatus;
  routeHref: string;
  routeMatchesSelection: boolean | null;
  routeTicker: string | null;
  searchStatus: TickerSearchStatus | "unobserved";
  selectedTicker: string | null;
  selectionHref: string;
  sourceResultCount: number | null;
  stage: "search" | "detail";
  summary: string;
};

export function getTickerSearchRequestHref(query: unknown) {
  const normalized = normalizeTickerSearchQuery(query);
  return normalized
    ? `/api/tickers/search?q=${encodeURIComponent(normalized)}`
    : "";
}

export function resolveTickerSearchRequestSnapshot({
  httpStatus = null,
  payload,
  requestState,
}: {
  httpStatus?: number | null;
  payload?: unknown;
  requestState: TickerSearchRequestState;
}): TickerSearchRequestSnapshot {
  if (requestState !== "received") {
    return {
      apiOk: null,
      httpStatus: null,
      requestState,
      responseStatus: requestState === "failed" ? "failure" : "unknown",
      sourceResultCount: null,
    };
  }

  const response = asRecord(payload);
  const safeStatus = safeHttpStatus(httpStatus);
  const apiOk = typeof response?.ok === "boolean" ? response.ok : null;
  const rows = Array.isArray(response?.data) ? response.data : null;
  let responseStatus: TickerSearchResponseStatus = "failure";
  try {
    const result = parseTickerSearchResponse(payload, safeStatus ?? 0);
    responseStatus = result.partial ? "partial" : "success";
  } catch { /* Invalid/failed responses are unavailable, never empty. */ }

  return {
    apiOk,
    httpStatus: safeStatus,
    requestState,
    responseStatus,
    sourceResultCount: apiOk === true && safeStatus !== null && safeStatus >= 200 && safeStatus < 300 && rows ? rows.length : null,
  };
}

export function resolveTickerSearchObservation({
  activeIndex,
  payload,
  query,
  request,
}: {
  activeIndex: number;
  payload?: unknown;
  query: unknown;
  request: TickerSearchRequestSnapshot;
}): TickerSearchObservation {
  const normalizedQuery = normalizeTickerSearchQuery(query);
  const mappedResults =
    request.responseStatus === "success" || request.responseStatus === "partial" ? mapTickerSearchResults(payload) : [];
  const status = resolveSearchStatus(
    normalizedQuery,
    request,
    mappedResults.length,
  );
  const results = status === "ready" ? mappedResults : [];
  const safeActiveIndex =
    status === "ready" &&
    Number.isInteger(activeIndex) &&
    activeIndex >= 0 &&
    activeIndex < results.length
      ? activeIndex
      : -1;
  const presentation = status === "ready" && request.responseStatus === "partial"
    ? { message: TICKER_SEARCH_PARTIAL_MESSAGE, role: "status" as const }
    : searchPresentation(status);

  return {
    ...request,
    activeTicker: results[safeActiveIndex]?.ticker ?? null,
    message: presentation.message,
    query: normalizedQuery,
    renderedResultCount: results.length,
    results,
    role: presentation.role,
    requestHref: getTickerSearchRequestHref(normalizedQuery),
    status,
  };
}

export function buildTickerSearchReadout(
  observation: TickerSearchObservation,
): TickerSearchFlowReadoutState {
  const countCopy =
    observation.status === "ready"
      ? `${observation.renderedResultCount} rendered ${pluralizeMatch(observation.renderedResultCount)}`
      : observation.status === "empty"
        ? "no matches"
        : observation.status;
  const activeCopy = observation.activeTicker
    ? ` ${observation.activeTicker} is active.`
    : "";

  return {
    activeTicker: observation.activeTicker,
    apiOk: observation.apiOk,
    detailRenderState: "not_rendered",
    httpStatus: observation.httpStatus,
    query: observation.query,
    renderedResultCount: observation.renderedResultCount,
    renderedTicker: null,
    requestHref: observation.requestHref,
    requestState: observation.requestState,
    responseStatus: observation.responseStatus,
    routeHref: "",
    routeMatchesSelection: null,
    routeTicker: null,
    searchStatus: observation.status,
    selectedTicker: null,
    selectionHref: "",
    sourceResultCount: observation.sourceResultCount,
    stage: "search",
    summary: observation.query
      ? `Ticker search for ${observation.query}: ${countCopy}.${activeCopy}${observation.responseStatus === "partial" ? ` ${TICKER_SEARCH_PARTIAL_MESSAGE}` : ""}`
      : "Ticker search is idle.",
  };
}

export function createTickerSearchSelectionSnapshot({
  observation,
  selectedTicker,
  selectionHref,
}: {
  observation: TickerSearchObservation;
  selectedTicker: unknown;
  selectionHref: unknown;
}): TickerSearchSelectionSnapshot | null {
  const ticker = normalizeTickerSymbol(selectedTicker);
  if (
    observation.status !== "ready" ||
    observation.requestState !== "received" ||
    (observation.responseStatus !== "success" && observation.responseStatus !== "partial") ||
    observation.apiOk !== true ||
    observation.httpStatus === null ||
    observation.sourceResultCount === null ||
    !ticker ||
    !observation.results.some((result) => result.ticker === ticker) ||
    typeof selectionHref !== "string" ||
    !selectionHref.startsWith("/stocks/")
  ) {
    return null;
  }

  return {
    apiOk: true,
    httpStatus: observation.httpStatus,
    query: observation.query,
    renderedResultCount: observation.renderedResultCount,
    requestHref: observation.requestHref,
    requestState: "received",
    responseStatus: observation.responseStatus,
    selectedTicker: ticker,
    selectionHref,
    sourceResultCount: observation.sourceResultCount,
    status: "ready",
    version: "ticker-search-selection-v1",
  };
}

export function serializeTickerSearchSelectionSnapshot(
  snapshot: TickerSearchSelectionSnapshot,
) {
  return JSON.stringify(snapshot);
}

export function parseTickerSearchSelectionSnapshot(
  value: unknown,
  expectedTicker: unknown,
  expectedHref: unknown,
): TickerSearchSelectionSnapshot | null {
  if (typeof value !== "string" || !value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const row = asRecord(parsed);
  const ticker = normalizeTickerSymbol(row?.selectedTicker);
  const normalizedExpectedTicker = normalizeTickerSymbol(expectedTicker);
  const query = normalizeTickerSearchQuery(row?.query);
  const httpStatus = safeHttpStatus(row?.httpStatus);
  const sourceResultCount = safeCount(row?.sourceResultCount);
  const renderedResultCount = safeCount(row?.renderedResultCount);
  if (
    row?.version !== "ticker-search-selection-v1" ||
    row?.status !== "ready" ||
    row?.requestState !== "received" ||
    (row?.responseStatus !== "success" && row?.responseStatus !== "partial") ||
    row?.apiOk !== true ||
    !query ||
    !ticker ||
    ticker !== normalizedExpectedTicker ||
    typeof expectedHref !== "string" ||
    row?.selectionHref !== expectedHref ||
    typeof row?.requestHref !== "string" ||
    row.requestHref !== getTickerSearchRequestHref(query) ||
    httpStatus === null ||
    httpStatus < 200 ||
    httpStatus >= 300 ||
    sourceResultCount === null ||
    sourceResultCount <= 0 ||
    renderedResultCount === null ||
    renderedResultCount <= 0 ||
    renderedResultCount > sourceResultCount
  ) {
    return null;
  }

  return {
    apiOk: true,
    httpStatus,
    query,
    renderedResultCount,
    requestHref: row.requestHref,
    requestState: "received",
    responseStatus: row.responseStatus,
    selectedTicker: ticker,
    selectionHref: expectedHref,
    sourceResultCount,
    status: "ready",
    version: "ticker-search-selection-v1",
  };
}

export function resolveTickerSearchToStockDetailReadout({
  detailRenderState,
  routeHref,
  routeTicker,
  selection,
}: {
  detailRenderState: StockDetailRenderState;
  routeHref: string;
  routeTicker: unknown;
  selection: TickerSearchSelectionSnapshot | null;
}): TickerSearchFlowReadoutState {
  const ticker = normalizeTickerSymbol(routeTicker);
  const routeMatchesSelection = selection && ticker
    ? selection.selectedTicker === ticker && selection.selectionHref === routeHref
    : selection
      ? false
      : null;
  const renderedTicker = detailRenderState === "ready" ? ticker : null;
  const summary = selection
    ? routeMatchesSelection
      ? `Ticker search for ${selection.query} selected ${selection.selectedTicker} and opened ${routeHref}. Stock detail is ${detailRenderState}${renderedTicker ? ` for ${renderedTicker}` : ""}.`
      : `The stored ticker search selection does not match ${routeHref}. Stock detail is ${detailRenderState}.`
    : `No ticker search selection was observed for ${routeHref}. Stock detail is ${detailRenderState}.`;

  return {
    activeTicker: null,
    apiOk: selection?.apiOk ?? null,
    detailRenderState,
    httpStatus: selection?.httpStatus ?? null,
    query: selection?.query ?? "",
    renderedResultCount: selection?.renderedResultCount ?? null,
    renderedTicker,
    requestHref: selection?.requestHref ?? "",
    requestState: selection?.requestState ?? "unobserved",
    responseStatus: selection?.responseStatus ?? "unknown",
    routeHref,
    routeMatchesSelection,
    routeTicker: ticker,
    searchStatus: selection?.status ?? "unobserved",
    selectedTicker: selection?.selectedTicker ?? null,
    selectionHref: selection?.selectionHref ?? "",
    sourceResultCount: selection?.sourceResultCount ?? null,
    stage: "detail",
    summary: `${summary}${selection?.responseStatus === "partial" ? ` ${TICKER_SEARCH_PARTIAL_MESSAGE}` : ""}`,
  };
}

function resolveSearchStatus(
  query: string,
  request: TickerSearchRequestSnapshot,
  mappedResultCount: number,
): TickerSearchStatus {
  if (!query || request.requestState === "idle") return "idle";
  if (request.requestState === "loading") return "loading";
  if (
    request.requestState === "failed" ||
    (request.responseStatus !== "success" && request.responseStatus !== "partial") ||
    request.apiOk !== true ||
    request.httpStatus === null ||
    request.httpStatus < 200 ||
    request.httpStatus >= 300 ||
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

  // A zero mapped count never proves an empty result when the successful
  // response reported rows. Inconsistent mapping remains unavailable.
  return "unavailable";
}

function searchPresentation(status: TickerSearchStatus) {
  if (status === "loading") {
    return { message: "Searching…", role: "status" as const };
  }
  if (status === "unavailable") {
    return {
      message: TICKER_SEARCH_UNAVAILABLE_MESSAGE,
      role: "alert" as const,
    };
  }
  if (status === "empty") {
    return { message: "No matching active ticker.", role: "status" as const };
  }
  return {
    message: "Search active US tickers and companies.",
    role: null,
  };
}

function pluralizeMatch(count: number) {
  return count === 1 ? "match" : "matches";
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

function safeCount(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
