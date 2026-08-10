import assert from "node:assert/strict";
import test from "node:test";
import {
  getDashboardV2MoversRequest,
  resolveDashboardV2MoverObservation,
  type DashboardV2MoversApiResponse,
} from "./dashboardV2MoverObservation.ts";
import type { DashboardV2MarketMover } from "./dashboardV2Types.ts";

test("maps the selected mover tab and session to the existing GET exactly", () => {
  assert.deepEqual(getDashboardV2MoversRequest("Top Gainers", "Regular"), {
    href: "/api/dashboard-v2/movers?session=Regular&mode=gainers",
    mode: "gainers",
    moverTab: "Top Gainers",
    session: "Regular",
  });
  assert.equal(
    getDashboardV2MoversRequest("Top Losers", "Pre").href,
    "/api/dashboard-v2/movers?session=Pre&mode=losers",
  );
  assert.equal(
    getDashboardV2MoversRequest("Top Volume", "After").href,
    "/api/dashboard-v2/movers?session=After&mode=volume",
  );
});

test("keeps a ready result ready when optional sources are unavailable", () => {
  const response = apiResponse({
    dataAvailability: {
      events: "ready",
      marketCap: "unavailable",
      volume: "unavailable",
    },
    rows: moverRows(25),
  });
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Gainers",
    renderedResultCount: 18,
    requestState: "received",
    response,
    session: "Regular",
  });

  assert.equal(observation.status, "ready");
  assert.equal(observation.renderState, "ready");
  assert.equal(observation.sourceResultCount, 25);
  assert.equal(observation.renderedResultCount, 18);
  assert.equal(observation.dataAvailability.marketCap, "unavailable");
  assert.equal(observation.dataAvailability.volume, "unavailable");
  assert.equal(observation.resultLabel, "Showing 18 of 25 market movers");
});

test("derives public-safe upstream error state without carrying raw error details", () => {
  const response = apiResponse({
    available: false,
    error: "provider exception: secret-token-value",
    freshness: "stale",
    ok: false,
    reason: "upstream_error",
    rows: [],
  });
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: 502,
    moverTab: "Top Losers",
    renderedResultCount: 0,
    requestState: "received",
    response,
    session: "Regular",
  });

  assert.equal(observation.status, "error");
  assert.equal(observation.reason, "upstream_error");
  assert.equal(observation.apiOk, false);
  assert.equal(observation.apiAvailable, false);
  assert.equal(observation.httpStatus, 502);
  assert.equal(observation.renderTitle, "Market data unavailable");
  assert.doesNotMatch(JSON.stringify(observation), /secret-token-value|provider exception/);
});

test("distinguishes confirmed empty, unavailable, and transport failure", () => {
  const empty = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Volume",
    renderedResultCount: 0,
    requestState: "received",
    response: apiResponse({ reason: "empty", rows: [] }),
    session: "Regular",
  });
  const unavailable = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Gainers",
    renderedResultCount: 0,
    requestState: "received",
    response: apiResponse({
      available: false,
      reason: "session_unavailable",
      rows: [],
    }),
    session: "Pre",
  });
  const failed = resolveDashboardV2MoverObservation({
    moverTab: "Top Gainers",
    renderedResultCount: 0,
    requestState: "failed",
    session: "After",
  });

  assert.equal(empty.status, "empty");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(failed.status, "error");
  assert.equal(failed.reason, "unknown");
  assert.equal(failed.apiAvailable, null);
});

test("does not infer empty from zero rows when the API reason says ready", () => {
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Gainers",
    renderedResultCount: 0,
    requestState: "received",
    response: apiResponse({ reason: "ready", rows: [] }),
    session: "Regular",
  });

  assert.equal(observation.status, "error");
  assert.notEqual(observation.status, "empty");
});

test("keeps API ready while identifying a normal filter-empty render state", () => {
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Gainers",
    renderedResultCount: 0,
    requestState: "received",
    response: apiResponse({ rows: moverRows(2) }),
    session: "Pre",
  });

  assert.equal(observation.status, "ready");
  assert.equal(observation.renderState, "filtered_empty");
  assert.equal(observation.sourceResultCount, 2);
  assert.equal(observation.renderedResultCount, 0);
  assert.equal(observation.renderMessage, "No market movers match the selected filters.");
});

test("treats absent optional availability and invalid timestamps as unknown, not unavailable", () => {
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: 200,
    moverTab: "Top Gainers",
    renderedResultCount: 1,
    requestState: "received",
    response: apiResponse({ asOf: "not-a-date", dataAvailability: undefined }),
    session: "Regular",
  });

  assert.equal(observation.status, "ready");
  assert.equal(observation.dataAvailability.events, "unknown");
  assert.equal(observation.dataAvailability.marketCap, "unknown");
  assert.equal(observation.asOf, null);
});

function apiResponse(
  overrides: Partial<DashboardV2MoversApiResponse> = {},
): DashboardV2MoversApiResponse {
  return {
    asOf: "2026-08-03T18:04:00.000Z",
    available: true,
    dataAvailability: {
      events: "ready",
      marketCap: "ready",
      volume: "ready",
    },
    freshness: "closed",
    ok: true,
    reason: "ready",
    receivedAt: "2026-08-03T18:05:00.000Z",
    rows: moverRows(1),
    ...overrides,
  };
}

function moverRows(count: number): DashboardV2MarketMover[] {
  return Array.from({ length: count }, (_, index) => ({
    changePercent: "+1.00%",
    company: `Company ${index + 1}`,
    events: [],
    marketCap: "—",
    price: "$1.00",
    priceValue: 1,
    rank: index + 1,
    ticker: `TEST${index + 1}`,
    volume: "—",
  }));
}
