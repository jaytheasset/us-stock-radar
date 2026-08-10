import type {
  DashboardV2MarketMover,
  DashboardV2Session,
  DashboardV2Tab,
} from "./dashboardV2Types.ts";

export const dashboardV2MoverModeByTab = {
  "Top Gainers": "gainers",
  "Top Losers": "losers",
  "Top Volume": "volume",
} as const satisfies Record<DashboardV2Tab, "gainers" | "losers" | "volume">;

export type DashboardV2MoverApiReason =
  | "ready"
  | "empty"
  | "session_unavailable"
  | "missing_key"
  | "upstream_error";
export type DashboardV2MoverDataStatus =
  | "ready"
  | "partial"
  | "empty"
  | "unavailable";
export type DashboardV2MoverFreshness =
  | "fresh"
  | "stale"
  | "finalizing"
  | "final"
  | "closed";
export type DashboardV2MoverStatus =
  | "loading"
  | "ready"
  | "empty"
  | "unavailable"
  | "error";
export type DashboardV2MoverRenderState =
  | DashboardV2MoverStatus
  | "filtered_empty";

export type DashboardV2MoversApiResponse = {
  asOf: string | null;
  available: boolean;
  dataAvailability?: Partial<
    Record<"events" | "marketCap" | "volume", DashboardV2MoverDataStatus>
  >;
  error?: string;
  freshness?: DashboardV2MoverFreshness;
  marketSessionOpen?: boolean;
  message?: string;
  ok: boolean;
  reason: DashboardV2MoverApiReason;
  receivedAt: string;
  refreshAfterSeconds?: number | null;
  rows: DashboardV2MarketMover[];
  sourceCount?: number;
  stale?: boolean;
};

export type DashboardV2MoverRequestState = "loading" | "received" | "failed";

export type DashboardV2MoverObservation = {
  apiAvailable: boolean | null;
  apiOk: boolean | null;
  asOf: string | null;
  dataAvailability: Record<
    "events" | "marketCap" | "volume",
    DashboardV2MoverDataStatus | "unknown"
  >;
  freshness: DashboardV2MoverFreshness | "unknown";
  httpStatus: number | null;
  mode: (typeof dashboardV2MoverModeByTab)[DashboardV2Tab];
  moverTab: DashboardV2Tab;
  reason: DashboardV2MoverApiReason | "unknown";
  receivedAt: string | null;
  renderMessage: string;
  renderState: DashboardV2MoverRenderState;
  renderTitle: string;
  renderedResultCount: number;
  requestHref: string;
  resultLabel: string;
  session: DashboardV2Session;
  sourceResultCount: number;
  status: DashboardV2MoverStatus;
};

export function getDashboardV2MoversRequest(
  moverTab: DashboardV2Tab,
  session: DashboardV2Session,
) {
  const mode = dashboardV2MoverModeByTab[moverTab];
  return {
    href: `/api/dashboard-v2/movers?session=${encodeURIComponent(session)}&mode=${mode}`,
    mode,
    moverTab,
    session,
  } as const;
}

export function resolveDashboardV2MoverObservation({
  httpStatus = null,
  moverTab,
  renderedResultCount,
  requestState,
  response,
  session,
}: {
  httpStatus?: number | null;
  moverTab: DashboardV2Tab;
  renderedResultCount: number;
  requestState: DashboardV2MoverRequestState;
  response?: DashboardV2MoversApiResponse;
  session: DashboardV2Session;
}): DashboardV2MoverObservation {
  const request = getDashboardV2MoversRequest(moverTab, session);
  const sourceResultCount = Array.isArray(response?.rows) ? response.rows.length : 0;
  const status = resolveStatus(requestState, httpStatus, response, sourceResultCount);
  const safeRenderedResultCount =
    status === "ready"
      ? Math.min(sourceResultCount, nonNegativeInteger(renderedResultCount))
      : 0;
  const renderState: DashboardV2MoverRenderState =
    status === "ready" && safeRenderedResultCount === 0 ? "filtered_empty" : status;
  const presentation = presentationFor(renderState);

  return {
    apiAvailable: requestState === "received" ? Boolean(response?.available) : null,
    apiOk: requestState === "received" ? Boolean(response?.ok) : null,
    asOf: safeIsoTimestamp(response?.asOf),
    dataAvailability: {
      events: safeDataStatus(response?.dataAvailability?.events),
      marketCap: safeDataStatus(response?.dataAvailability?.marketCap),
      volume: safeDataStatus(response?.dataAvailability?.volume),
    },
    freshness: safeFreshness(response?.freshness),
    httpStatus: safeHttpStatus(httpStatus),
    mode: request.mode,
    moverTab,
    reason: safeReason(response?.reason),
    receivedAt: safeIsoTimestamp(response?.receivedAt),
    renderMessage: presentation.message,
    renderState,
    renderTitle: presentation.title,
    renderedResultCount: safeRenderedResultCount,
    requestHref: request.href,
    resultLabel: `Showing ${safeRenderedResultCount} of ${sourceResultCount} market movers`,
    session,
    sourceResultCount,
    status,
  };
}

function resolveStatus(
  requestState: DashboardV2MoverRequestState,
  httpStatus: number | null,
  response: DashboardV2MoversApiResponse | undefined,
  sourceResultCount: number,
): DashboardV2MoverStatus {
  if (requestState === "loading") return "loading";
  if (requestState === "failed" || !response) return "error";

  if (
    response.reason === "missing_key" ||
    response.reason === "session_unavailable"
  ) {
    return "unavailable";
  }
  if (
    !safeHttpStatus(httpStatus) ||
    httpStatus! < 200 ||
    httpStatus! >= 300 ||
    !response.ok ||
    !response.available ||
    response.reason === "upstream_error"
  ) {
    return "error";
  }
  if (response.reason === "empty" && sourceResultCount === 0) return "empty";
  if (response.reason === "ready" && sourceResultCount > 0) return "ready";

  // Do not infer an empty result from row count alone when the API reason disagrees.
  return "error";
}

function presentationFor(renderState: DashboardV2MoverRenderState) {
  if (renderState === "loading") {
    return { title: "Loading market data", message: "Loading market movers…" };
  }
  if (renderState === "empty") {
    return { title: "No results", message: "No market movers returned for this view." };
  }
  if (renderState === "filtered_empty") {
    return {
      title: "No filter matches",
      message: "No market movers match the selected filters.",
    };
  }
  if (renderState === "unavailable") {
    return {
      title: "Market data unavailable",
      message: "Market data is unavailable for this session.",
    };
  }
  if (renderState === "error") {
    return {
      title: "Market data unavailable",
      message: "Market movers are temporarily unavailable. Try again shortly.",
    };
  }
  return { title: "Market movers ready", message: "Market movers are ready." };
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function safeReason(value: unknown): DashboardV2MoverObservation["reason"] {
  return value === "ready" ||
    value === "empty" ||
    value === "session_unavailable" ||
    value === "missing_key" ||
    value === "upstream_error"
    ? value
    : "unknown";
}

function safeDataStatus(value: unknown) {
  return value === "ready" ||
    value === "partial" ||
    value === "empty" ||
    value === "unavailable"
    ? value
    : "unknown";
}

function safeFreshness(value: unknown): DashboardV2MoverObservation["freshness"] {
  return value === "fresh" ||
    value === "stale" ||
    value === "finalizing" ||
    value === "final" ||
    value === "closed"
    ? value
    : "unknown";
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function safeIsoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
