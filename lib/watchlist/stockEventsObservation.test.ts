import assert from "node:assert/strict";
import test from "node:test";
import type { StockOverviewEvent } from "./stockOverview.ts";
import {
  getStockEventsRequestHref,
  resolveStockEventsObservation,
  resolveStockEventsRequestSnapshot,
} from "./stockEventsObservation.ts";

test("the observation and the UI share the existing ticker Events GET", () => {
  assert.equal(
    getStockEventsRequestHref(" brk.b "),
    "/api/events?ticker=BRK.B&limit=50&include_archive=true",
  );
  assert.equal(getStockEventsRequestHref("A/B"), null);
});

test("a confirmed successful response with source rows is ready", () => {
  const request = receivedRequest(200, {
    data: [{ id: "filing" }, { id: "news" }],
    ok: true,
  });
  const observation = resolveStockEventsObservation({
    events: [event("filing", "filings"), event("news", "news")],
    filter: "all",
    request,
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  assert.equal(observation.status, "ready");
  assert.equal(observation.renderState, "ready");
  assert.equal(observation.httpStatus, 200);
  assert.equal(observation.apiOk, true);
  assert.equal(observation.responseStatus, "success");
  assert.equal(observation.sourceResultCount, 2);
  assert.equal(observation.filteredResultCount, 2);
  assert.equal(observation.renderedResultCount, 2);
  assert.equal(observation.resultLabel, "2 events");
  assert.equal(observation.message, null);
});

test("successful source empty is explicit and does not depend on count alone", () => {
  const observation = resolveStockEventsObservation({
    events: [],
    filter: "all",
    request: receivedRequest(200, { count: 91, data: [], ok: true }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  assert.equal(observation.status, "empty");
  assert.equal(observation.renderState, "empty");
  assert.equal(observation.sourceResultCount, 0);
  assert.equal(observation.resultLabel, "0 events");
  assert.equal(observation.title, "No tracked events");
  assert.equal(observation.message, "No tracked NVDA events were returned.");
});

test("a selected filter can be empty while the successful source remains ready", () => {
  const observation = resolveStockEventsObservation({
    events: [event("filing-1", "filings"), event("filing-2", "filings")],
    filter: "news",
    request: receivedRequest(200, { data: [{}, {}], ok: true }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  assert.equal(observation.status, "ready");
  assert.equal(observation.renderState, "filtered_empty");
  assert.equal(observation.sourceResultCount, 2);
  assert.equal(observation.filteredResultCount, 0);
  assert.equal(observation.renderedResultCount, 0);
  assert.equal(observation.title, "No events in this view");
  assert.equal(
    observation.message,
    "No tracked NVDA events match this filter.",
  );
});

test("request and response failures remain unavailable rather than empty", () => {
  const responseFailure = resolveStockEventsObservation({
    events: [],
    filter: "all",
    request: receivedRequest(503, { data: [], error: "private detail", ok: false }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });
  const requestFailure = resolveStockEventsObservation({
    events: [],
    filter: "all",
    request: resolveStockEventsRequestSnapshot({ requestState: "failed" }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  for (const observation of [responseFailure, requestFailure]) {
    assert.equal(observation.status, "unavailable");
    assert.equal(observation.renderState, "unavailable");
    assert.equal(observation.sourceResultCount, null);
    assert.equal(observation.resultLabel, "Events unavailable");
    assert.equal(observation.title, "Events temporarily unavailable");
    assert.equal(observation.message, "Event data is temporarily unavailable.");
    assert.doesNotMatch(JSON.stringify(observation), /private detail/);
  }
});

test("loading and malformed success shapes never become empty", () => {
  const loading = resolveStockEventsObservation({
    events: [],
    filter: "all",
    request: resolveStockEventsRequestSnapshot({ requestState: "loading" }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });
  const malformed = resolveStockEventsObservation({
    events: [],
    filter: "all",
    request: receivedRequest(200, { count: 0, ok: true }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  assert.equal(loading.status, "loading");
  assert.equal(loading.renderState, "loading");
  assert.equal(loading.resultLabel, "Loading events");
  assert.equal(malformed.status, "unavailable");
  assert.equal(malformed.renderState, "unavailable");
  assert.equal(malformed.sourceResultCount, null);
});

test("filtered and actually rendered counts stay separate for View more", () => {
  const events = Array.from({ length: 12 }, (_, index) =>
    event(`filing-${index}`, "filings"),
  );
  const observation = resolveStockEventsObservation({
    events,
    filter: "filings",
    request: receivedRequest(200, {
      data: Array.from({ length: 12 }, () => ({})),
      ok: true,
    }),
    ticker: "NVDA",
    visibleEventCount: 10,
  });

  assert.equal(observation.filteredResultCount, 12);
  assert.equal(observation.renderedResultCount, 10);
  assert.equal(observation.remainingResultCount, 2);
  assert.equal(observation.resultLabel, "12 events");
});

function receivedRequest(httpStatus: number, payload: unknown) {
  return resolveStockEventsRequestSnapshot({
    httpStatus,
    payload,
    requestState: "received",
  });
}

function event(
  id: string,
  sourceGroup: StockOverviewEvent["sourceGroup"],
): StockOverviewEvent {
  return {
    category: "Earnings",
    companyName: "NVIDIA Corporation",
    detectedAt: "2026-08-01T12:00:00.000Z",
    deliveryLevel: "feed",
    detailHref: `/events/${id}`,
    eventType: "earnings",
    formType: sourceGroup === "filings" ? "8-K" : "",
    id,
    score: 80,
    scoreTone: "bullish",
    signal: "bullish",
    source: sourceGroup === "filings" ? "SEC" : "Newswire",
    sourceGroup,
    summary: "Summary",
    ticker: "NVDA",
    title: "Event title",
  };
}
