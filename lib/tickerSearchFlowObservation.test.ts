import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTickerSearchReadout,
  createTickerSearchSelectionSnapshot,
  getTickerSearchRequestHref,
  parseTickerSearchSelectionSnapshot,
  resolveTickerSearchObservation,
  resolveTickerSearchRequestSnapshot,
  resolveTickerSearchToStockDetailReadout,
  serializeTickerSearchSelectionSnapshot,
} from "./tickerSearchFlowObservation.ts";

const amdPayload = {
  ok: true,
  data: [
    {
      ticker: "AMD",
      companyName: "Advanced Micro Devices, Inc.",
      exchange: "NASDAQ",
    },
    { ticker: "DOX", companyName: "AMDOCS LTD" },
  ],
};

test("maps the public query to the exact existing ticker-search GET", () => {
  assert.equal(
    getTickerSearchRequestHref("  Advanced   Micro Devices  "),
    "/api/tickers/search?q=Advanced%20Micro%20Devices",
  );
  assert.equal(getTickerSearchRequestHref(""), "");
});

test("one ready observation drives safe request, count, active option, and readout state", () => {
  const request = resolveTickerSearchRequestSnapshot({
    httpStatus: 200,
    payload: amdPayload,
    requestState: "received",
  });
  const observation = resolveTickerSearchObservation({
    activeIndex: 0,
    payload: amdPayload,
    query: "amd",
    request,
  });
  const readout = buildTickerSearchReadout(observation);

  assert.equal(observation.status, "ready");
  assert.equal(observation.requestHref, "/api/tickers/search?q=amd");
  assert.equal(observation.sourceResultCount, 2);
  assert.equal(observation.renderedResultCount, 2);
  assert.equal(observation.activeTicker, "AMD");
  assert.equal(readout.searchStatus, "ready");
  assert.equal(readout.activeTicker, "AMD");
  assert.match(readout.summary, /2 rendered matches/);
});

test("idle and loading remain explicit before a response is available", () => {
  const idle = resolveTickerSearchObservation({
    activeIndex: -1,
    query: "",
    request: resolveTickerSearchRequestSnapshot({ requestState: "idle" }),
  });
  const loading = resolveTickerSearchObservation({
    activeIndex: -1,
    query: "AMD",
    request: resolveTickerSearchRequestSnapshot({ requestState: "loading" }),
  });

  assert.equal(idle.status, "idle");
  assert.equal(idle.responseStatus, "unknown");
  assert.equal(loading.status, "loading");
  assert.equal(loading.message, "Searching…");
  assert.equal(loading.sourceResultCount, null);
});

test("confirmed empty stays distinct from API and transport failure", () => {
  const emptyPayload = { ok: true, data: [] };
  const empty = resolveTickerSearchObservation({
    activeIndex: -1,
    payload: emptyPayload,
    query: "ZZZZZZ",
    request: resolveTickerSearchRequestSnapshot({
      httpStatus: 200,
      payload: emptyPayload,
      requestState: "received",
    }),
  });
  const apiFailure = resolveTickerSearchObservation({
    activeIndex: -1,
    payload: {
      ok: false,
      error: "TICKER_SEARCH_FAILED",
      message: "provider exception: secret-token-value",
    },
    query: "AMD",
    request: resolveTickerSearchRequestSnapshot({
      httpStatus: 500,
      payload: { ok: false, message: "provider exception: secret-token-value" },
      requestState: "received",
    }),
  });
  const transportFailure = resolveTickerSearchObservation({
    activeIndex: -1,
    query: "AMD",
    request: resolveTickerSearchRequestSnapshot({ requestState: "failed" }),
  });

  assert.equal(empty.status, "empty");
  assert.equal(empty.message, "No matching active ticker.");
  assert.equal(apiFailure.status, "unavailable");
  assert.equal(transportFailure.status, "unavailable");
  assert.doesNotMatch(
    JSON.stringify({ apiFailure, transportFailure }),
    /secret-token-value|provider exception/,
  );
});

test("does not reinterpret an inconsistent mapped response as successful empty", () => {
  const invalidPayload = { ok: true, data: [{ ticker: "AMD" }] };
  const observation = resolveTickerSearchObservation({
    activeIndex: -1,
    payload: invalidPayload,
    query: "AMD",
    request: resolveTickerSearchRequestSnapshot({
      httpStatus: 200,
      payload: invalidPayload,
      requestState: "received",
    }),
  });

  assert.equal(observation.status, "unavailable");
  assert.notEqual(observation.status, "empty");
  assert.equal(observation.sourceResultCount, 1);
  assert.equal(observation.renderedResultCount, 0);
});

test("selection transfer is allowlisted, validated, one-flow data without raw errors", () => {
  const request = resolveTickerSearchRequestSnapshot({
    httpStatus: 200,
    payload: amdPayload,
    requestState: "received",
  });
  const observation = resolveTickerSearchObservation({
    activeIndex: 0,
    payload: amdPayload,
    query: "AMD",
    request,
  });
  const snapshot = createTickerSearchSelectionSnapshot({
    observation,
    selectedTicker: "AMD",
    selectionHref: "/stocks/AMD",
  });

  assert.ok(snapshot);
  const serialized = serializeTickerSearchSelectionSnapshot(snapshot);
  const parsed = parseTickerSearchSelectionSnapshot(
    serialized,
    "AMD",
    "/stocks/AMD",
  );
  assert.deepEqual(parsed, snapshot);
  assert.equal(
    parseTickerSearchSelectionSnapshot(serialized, "NVDA", "/stocks/NVDA"),
    null,
  );
  assert.doesNotMatch(serialized, /companyName|exchange|error|message|secret/i);
});

test("detail readout joins the validated selection to the actual rendered route", () => {
  const snapshot = parseTickerSearchSelectionSnapshot(
    JSON.stringify({
      apiOk: true,
      httpStatus: 200,
      query: "AMD",
      renderedResultCount: 2,
      requestHref: "/api/tickers/search?q=AMD",
      requestState: "received",
      responseStatus: "success",
      selectedTicker: "AMD",
      selectionHref: "/stocks/AMD",
      sourceResultCount: 2,
      status: "ready",
      version: "ticker-search-selection-v1",
    }),
    "AMD",
    "/stocks/AMD",
  );
  const ready = resolveTickerSearchToStockDetailReadout({
    detailRenderState: "ready",
    routeHref: "/stocks/AMD",
    routeTicker: "AMD",
    selection: snapshot,
  });
  const direct = resolveTickerSearchToStockDetailReadout({
    detailRenderState: "ready",
    routeHref: "/stocks/NVDA",
    routeTicker: "NVDA",
    selection: null,
  });

  assert.equal(ready.routeMatchesSelection, true);
  assert.equal(ready.renderedTicker, "AMD");
  assert.equal(ready.detailRenderState, "ready");
  assert.match(ready.summary, /selected AMD and opened \/stocks\/AMD/);
  assert.equal(direct.searchStatus, "unobserved");
  assert.equal(direct.renderedTicker, "NVDA");
});
