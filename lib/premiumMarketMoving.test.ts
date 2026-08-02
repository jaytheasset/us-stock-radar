import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPremiumMarketMovingEventQuery,
  buildPremiumMarketMovingTickerQuery,
  PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS,
  PREMIUM_MARKET_MOVING_LIMIT,
  PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS,
  PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS,
  selectPremiumMarketMovingEvents,
  shouldPollPremiumMarketMoving,
} from "./premiumMarketMoving.ts";

const ids = {
  newest: "11111111-1111-4111-8111-111111111111",
  second: "22222222-2222-4222-8222-222222222222",
  third: "33333333-3333-4333-8333-333333333333",
  fourth: "44444444-4444-4444-8444-444444444444",
  lowScore: "55555555-5555-4555-8555-555555555555",
  news: "66666666-6666-4666-8666-666666666666",
  qa: "77777777-7777-4777-8777-777777777777",
  localSource: "88888888-8888-4888-8888-888888888888",
};

const baseRow = {
  detected_at: "2026-08-03T10:05:00.000Z",
  event_type: "dilution_risk",
  published_at: "2026-08-03T10:00:00.000Z",
  score: 94,
  signal: "bearish",
  source_code: "sec_edgar",
  source_group: "filings",
  source_name: "SEC EDGAR",
  source_url: "https://www.sec.gov/Archives/edgar/data/1/filing.htm",
  ticker: "BASE",
  title: "Issuer files a registered direct offering",
};

test("builds a server-enforced filing, source, score, sort, and minimal-select query", () => {
  assert.deepEqual(buildPremiumMarketMovingEventQuery(), {
    limit: "50",
    order: "detected_at.desc",
    score: "gte.90",
    select:
      "id,source_code,source_group,source_name,source_url,published_at,detected_at,ticker,event_type,score,signal,title",
    source_code: "eq.sec_edgar",
    source_group: "eq.filings",
  });
  assert.deepEqual(buildPremiumMarketMovingTickerQuery([ids.newest]), {
    event_id: `in.(${ids.newest})`,
    limit: "10",
    order: "sort_order.asc",
    select: "event_id,symbol,role,sort_order",
  });
});

test("excludes score 89, news score 99, QA titles, and non-SEC local sources", () => {
  const rows = [
    { ...baseRow, id: ids.lowScore, score: 89 },
    { ...baseRow, id: ids.news, score: 99, source_group: "news" },
    { ...baseRow, id: ids.qa, score: 99, title: "[QA] synthetic filing fixture" },
    {
      ...baseRow,
      id: ids.localSource,
      score: 99,
      source_code: "local-filings-qa",
      source_name: "Local filings QA",
    },
    { ...baseRow, id: ids.newest },
  ];

  const events = selectPremiumMarketMovingEvents(rows);
  assert.deepEqual(events.map((event) => event.id), [ids.newest]);
});

test("sorts by published/detected recency, limits to three, and maps canonical detail rows", () => {
  const rows = [
    {
      ...baseRow,
      id: ids.fourth,
      published_at: "2026-08-01T10:00:00.000Z",
      ticker: "FOUR",
    },
    {
      ...baseRow,
      event_type: "fda_clinical",
      id: ids.second,
      published_at: "2026-08-03T09:00:00.000Z",
      score: 92,
      signal: "bullish",
      ticker: "SECOND",
      title: "Long-form clinical disclosure title",
    },
    {
      ...baseRow,
      id: ids.newest,
      detected_at: "2026-08-03T11:00:00.000Z",
      published_at: null,
      ticker: "ROWVALUE",
    },
    {
      ...baseRow,
      id: ids.third,
      published_at: "2026-08-02T10:00:00.000Z",
      ticker: "THIRD",
    },
  ];
  const tickerRows = [
    { event_id: ids.newest, role: "related", sort_order: 2, symbol: "RELATED" },
    { event_id: ids.newest, role: "primary", sort_order: 1, symbol: "PRIMARY.L" },
  ];

  const events = selectPremiumMarketMovingEvents(rows, tickerRows);
  assert.equal(events.length, PREMIUM_MARKET_MOVING_LIMIT);
  assert.deepEqual(events.map((event) => event.id), [ids.newest, ids.second, ids.third]);
  assert.deepEqual(events[0], {
    eventTypeLabel: "Dilution Risk",
    href: `/filings/${ids.newest}`,
    id: ids.newest,
    score: 94,
    signal: "bearish",
    ticker: "PRIMARY.L",
    title: baseRow.title,
  });
  assert.deepEqual(Object.keys(events[0] || {}).sort(), [
    "eventTypeLabel",
    "href",
    "id",
    "score",
    "signal",
    "ticker",
    "title",
  ]);
  assert.equal(events[1]?.eventTypeLabel, "FDA / Clinical");
});

test("keeps the public cache and visible-only polling policy aligned at 60 seconds", () => {
  assert.equal(PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS, 60);
  assert.equal(PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS, 60);
  assert.equal(PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS, 60_000);
  assert.equal(shouldPollPremiumMarketMoving("visible"), true);
  assert.equal(shouldPollPremiumMarketMoving("hidden"), false);
  assert.equal(shouldPollPremiumMarketMoving("prerender"), false);
});

test("orders candidates by detected time so a newest null-published filing survives the candidate limit", () => {
  const query = buildPremiumMarketMovingEventQuery();
  assert.equal(query.limit, "50");
  assert.equal(query.order, "detected_at.desc");
  assert.doesNotMatch(query.order, /published_at/);

  const events = selectPremiumMarketMovingEvents([
    {
      ...baseRow,
      detected_at: "2026-08-03T12:00:00.000Z",
      id: ids.newest,
      published_at: null,
    },
    {
      ...baseRow,
      detected_at: "2026-08-03T11:00:00.000Z",
      id: ids.second,
      published_at: "2026-08-03T10:59:00.000Z",
    },
  ]);

  assert.deepEqual(events.map((event) => event.id), [ids.newest, ids.second]);
});
