import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adaptFmpCalendarRow } from "./fmpCalendarAdapter.ts";
import {
  buildDividendIdentity,
  buildEarningsIdentity,
  buildIpoIdentity,
  buildSplitIdentity,
  isAllowedFmpCompanyExchange,
  normalizeFmpCalendarExchange,
  normalizeSplitRatio,
} from "./fmpCalendarIdentity.ts";
import {
  parseFmpCalendarIngestRequest,
  runFmpCalendarIngestCore,
} from "./fmpCalendarIngestCore.ts";
import {
  FMP_CALENDAR_DAILY_CAP,
  FMP_CALENDAR_ENDPOINTS,
  FMP_CALENDAR_FETCH_CONCURRENCY,
  FMP_CALENDAR_READ_LIMIT,
  FMP_CALENDAR_UNIVERSE_REFERENCE_COUNT,
  FMP_CALENDAR_WEEKLY_REFERENCE,
  type FmpCalendarFetchResult,
  type FmpCalendarIngestRequest,
  type FmpCompanyCalendarEventType,
  type FmpTickerUniverseEntry,
} from "./fmpCalendarTypes.ts";

const read = (relativePath: string) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("FMP endpoint, cap, concurrency, universe, and weekly reference contracts are fixed", () => {
  assert.deepEqual(FMP_CALENDAR_ENDPOINTS, {
    dividend: "dividends-calendar",
    earnings: "earnings-calendar",
    ipo: "ipos-calendar",
    split: "splits-calendar",
  });
  assert.equal(FMP_CALENDAR_DAILY_CAP, 4_000);
  assert.equal(FMP_CALENDAR_FETCH_CONCURRENCY, 2);
  assert.equal(FMP_CALENDAR_READ_LIMIT, 2_000);
  assert.equal(FMP_CALENDAR_UNIVERSE_REFERENCE_COUNT, 5_492);
  assert.deepEqual(FMP_CALENDAR_WEEKLY_REFERENCE, {
    accepted: {
      dividend: 96,
      earnings: 967,
      ipoListed: 1,
      split: 12,
    },
    fetched: {
      dividend: 557,
      earnings: 2_294,
      ipo: 28,
      split: 17,
    },
    from: "2026-07-27",
    to: "2026-08-02",
  });
});

test("allowed universe accepts active NASDAQ/NYSE/AMEX family stock classes only", async () => {
  for (const exchange of [
    "NASDAQ",
    "Nasdaq Global Select",
    "NYSE",
    "NYSEArca",
    "NYSE American",
    "AMEX",
    "New York Stock Exchange",
  ]) {
    assert.equal(isAllowedFmpCompanyExchange(exchange), true);
  }
  assert.equal(normalizeFmpCalendarExchange("Nasdaq Capital Market"), "NASDAQ");
  assert.equal(normalizeFmpCalendarExchange("NYSE American"), "AMEX");
  assert.equal(isAllowedFmpCompanyExchange("OTCQB"), false);
  assert.equal(isAllowedFmpCompanyExchange("TSX"), false);

  const repository = await read("lib/calendar-v1/fmpCalendarRepository.ts");
  assert.match(repository, /is_active:\s*"eq\.true"/);
  assert.match(repository, /asset_type:\s*"in\.\(stock,adr_or_class\)"/);
  assert.match(repository, /isAllowedFmpCompanyExchange/);
  assert.doesNotMatch(repository, /\.slice\([^)]*2_000/);
});

test("occurrence identities exclude the scheduled date where required", () => {
  assert.equal(
    buildEarningsIdentity("AAPL", "2026-07-27"),
    buildEarningsIdentity("AAPL", "2026-08-20"),
  );
  assert.notEqual(
    buildEarningsIdentity("AAPL", "2026-08-20"),
    buildEarningsIdentity("AAPL", "2026-10-20"),
  );
  const dividend = buildDividendIdentity({
    amount: 0.25,
    frequency: "Quarterly",
    occurrenceDate: "2026-06-15",
    occurrenceKind: "declaration",
    symbol: "AAPL",
  });
  assert.equal(
    dividend,
    "fmp:company:dividend:AAPL:declaration:2026-06-15:0.25:quarterly",
  );
  assert.equal(
    buildSplitIdentity({
      denominator: 2,
      eventDate: "2026-07-31",
      numerator: 4,
      symbol: "EXM",
    }),
    "fmp:company:split:EXM:2026:2:1",
  );
  assert.equal(
    buildIpoIdentity({
      company: "Example Holdings, Inc.",
      exchange: "NASDAQ",
      symbol: null,
    }),
    "fmp:company:ipo:tba:nasdaq:example-holdings-inc",
  );
  assert.doesNotMatch(
    buildEarningsIdentity("AAPL", "2026-07-27"),
    /2026-07-27/,
  );
});

test("earnings adapter preserves estimates/results and releases only with actuals", () => {
  const scheduled = adapt(
    "earnings",
    earningsRow({ epsActual: null, revenueActual: null }),
  );
  assert.equal(scheduled.kind, "accepted");
  if (scheduled.kind !== "accepted") return;
  assert.equal(scheduled.observation.lifecycleStatus, "scheduled");
  assert.equal(scheduled.observation.scheduleConfidence, "tentative");
  assert.equal(scheduled.observation.details.actualEps, null);
  assert.equal(scheduled.observation.details.epsEstimate, 1.25);

  const released = adapt(
    "earnings",
    earningsRow({ epsActual: 1.5, revenueActual: 12_500_000 }),
  );
  assert.equal(released.kind, "accepted");
  if (released.kind !== "accepted") return;
  assert.equal(released.observation.lifecycleStatus, "released");
  assert.equal(released.observation.details.outcome, "beat");
});

test("dividend adapter nulls implausible auxiliary dates instead of trusting them", () => {
  const result = adapt("dividend", {
    adjDividend: 0.25,
    declarationDate: "2026-07-01",
    dividend: 0.25,
    frequency: "Quarterly",
    paymentDate: "2026-08-15",
    recordDate: "2036-07-31",
    symbol: "EXM",
    date: "2026-07-30",
    yield: 0.01,
  });
  assert.equal(result.kind, "accepted");
  if (result.kind !== "accepted") return;
  assert.equal(result.observation.details.recordDate, null);
  assert.equal(result.observation.details.paymentDate, "2026-08-15");
  assert.ok(result.warnings.includes("dividend_record_date_invalid"));
  assert.match(
    result.observation.canonicalIdentityKey,
    /declaration:2026-07-01/,
  );

  const noOccurrence = adapt("dividend", {
    adjDividend: 0.25,
    declarationDate: null,
    frequency: "Quarterly",
    recordDate: "2036-07-31",
    symbol: "EXM",
    date: "2026-07-30",
  });
  assert.equal(noOccurrence.kind, "quarantined");
});

test("dividend adapter falls back to a distinct payment date for canonical identity", () => {
  const result = adapt(
    "dividend",
    {
      adjDividend: 0.41406,
      declarationDate: null,
      frequency: "Quarterly",
      paymentDate: "2026-07-30",
      recordDate: "2026-07-29",
      symbol: "EXM",
      date: "2026-07-29",
    },
    "2026-07-29",
  );

  assert.equal(result.kind, "accepted");
  if (result.kind !== "accepted") return;
  assert.equal(
    result.observation.canonicalIdentityKey,
    "fmp:company:dividend:EXM:payment:2026-07-30:0.41406:quarterly",
  );
  assert.doesNotMatch(
    result.observation.canonicalIdentityKey,
    /2026-07-29/,
  );
});

test("irregular daily dividends use distinct payment dates instead of colliding on one declaration", () => {
  const first = adapt(
    "dividend",
    {
      adjDividend: 0.0493,
      declarationDate: "2026-06-13",
      frequency: "Irregular",
      paymentDate: "2026-07-24",
      recordDate: "2026-07-23",
      symbol: "EXM",
      date: "2026-07-23",
    },
    "2026-07-23",
  );
  const second = adapt(
    "dividend",
    {
      adjDividend: 0.0493,
      declarationDate: "2026-06-13",
      frequency: "Irregular",
      paymentDate: "2026-07-27",
      recordDate: "2026-07-24",
      symbol: "EXM",
      date: "2026-07-24",
    },
    "2026-07-24",
  );

  assert.equal(first.kind, "accepted");
  assert.equal(second.kind, "accepted");
  if (first.kind !== "accepted" || second.kind !== "accepted") return;
  assert.equal(
    first.observation.canonicalIdentityKey,
    "fmp:company:dividend:EXM:payment:2026-07-24:0.0493:irregular",
  );
  assert.equal(
    second.observation.canonicalIdentityKey,
    "fmp:company:dividend:EXM:payment:2026-07-27:0.0493:irregular",
  );
  assert.notEqual(
    first.observation.canonicalIdentityKey,
    second.observation.canonicalIdentityKey,
  );
});

test("dividend adapter quarantines rows without an auxiliary date distinct from the event date", () => {
  const result = adapt(
    "dividend",
    {
      adjDividend: 0.25,
      declarationDate: "2026-07-29",
      frequency: "Quarterly",
      paymentDate: "2026-07-29",
      recordDate: "2026-07-29",
      symbol: "EXM",
      date: "2026-07-29",
    },
    "2026-07-29",
  );

  assert.equal(result.kind, "quarantined");
  if (result.kind !== "quarantined") return;
  assert.equal(result.reason, "dividend_occurrence_unverified");
});

test("split ratio determines forward/reverse and conflicting provider labels only warn", () => {
  assert.deepEqual(normalizeSplitRatio(10, 2), {
    denominator: 1,
    kind: "forward",
    numerator: 5,
    ratio: "5:1",
  });
  assert.equal(normalizeSplitRatio(1, 1), null);
  const result = adapt("split", {
    date: "2026-07-30",
    denominator: 2,
    numerator: 10,
    splitType: "Reverse",
    symbol: "EXM",
  });
  assert.equal(result.kind, "accepted");
  if (result.kind !== "accepted") return;
  assert.equal(result.observation.details.ratio, "5:1");
  assert.equal(result.observation.details.splitKind, "forward");
  assert.ok(result.warnings.includes("split_type_conflicts_with_ratio"));
});

test("IPO candidates survive ticker mismatch without a fabricated security relation", () => {
  const candidate = adapt("ipo", {
    actions: "Expected",
    company: "New Company Inc.",
    daa: "opaque-provider-field",
    date: "2026-07-30",
    exchange: "NASDAQ Global Market",
    marketCap: 250_000_000,
    priceRange: "$15.00 - $17.00",
    shares: 10_000_000,
    symbol: "NEWC",
  });
  assert.equal(candidate.kind, "accepted");
  if (candidate.kind !== "accepted") return;
  assert.equal(candidate.universeClass, "ipo-candidate");
  assert.equal(candidate.observation.ticker, null);
  assert.equal(candidate.observation.details.priceRangeLow, 15);
  assert.equal(candidate.observation.details.priceRangeHigh, 17);
  assert.doesNotMatch(JSON.stringify(candidate.observation.details), /daa/i);

  const listed = adapt("ipo", {
    actions: "Expected",
    company: "Example Corporation",
    date: "2026-07-30",
    exchange: "NYSE",
    priceRange: "20",
    symbol: "EXM",
  });
  assert.equal(listed.kind, "accepted");
  if (listed.kind === "accepted") {
    assert.equal(listed.universeClass, "listed");
    assert.equal(listed.observation.ticker, "EXM");
  }
});

test("IPO priced actions preserve expected ranges without inventing a final offer price", () => {
  const range = adapt("ipo", {
    actions: "Priced",
    company: "Example Corporation",
    date: "2026-07-30",
    exchange: "NASDAQ",
    priceRange: "$15.00 - $17.00",
    symbol: "EXM",
  });
  const pointRange = adapt("ipo", {
    actions: "Priced",
    company: "Example Corporation",
    date: "2026-07-30",
    exchange: "NASDAQ",
    priceRange: "20",
    symbol: "EXM",
  });

  for (const result of [range, pointRange]) {
    assert.equal(result.kind, "accepted");
    if (result.kind !== "accepted") continue;
    assert.equal(result.observation.details.ipoStage, "priced");
    assert.equal(result.observation.details.offerPrice, null);
  }
  if (range.kind === "accepted") {
    assert.equal(range.observation.details.priceRangeLow, 15);
    assert.equal(range.observation.details.priceRangeHigh, 17);
  }
  if (pointRange.kind === "accepted") {
    assert.equal(pointRange.observation.details.priceRangeLow, 20);
    assert.equal(pointRange.observation.details.priceRangeHigh, 20);
  }
});

test("request parsing is strict, GET is dry-run only, and ranges stop at 93 days", () => {
  assert.deepEqual(
    parseRequest("GET", {
      eventTypes: "earnings,split",
      from: "2026-07-01",
      to: "2026-07-07",
    }),
    {
      ok: true,
      request: {
        dryRun: true,
        eventTypes: ["earnings", "split"],
        from: "2026-07-01",
        mode: "backfill",
        persist: false,
        to: "2026-07-07",
      },
    },
  );
  assert.equal(
    parseRequest("GET", {
      dryRun: "false",
      from: "2026-07-01",
      to: "2026-07-07",
    }).ok,
    false,
  );
  assert.equal(
    parseFmpCalendarIngestRequest(
      "POST",
      new URLSearchParams(),
      {
        dryRun: false,
        eventTypes: ["earnings"],
        from: "2026-07-01",
        mode: "backfill",
        persist: true,
        to: "2026-07-07",
      },
    ).ok,
    true,
  );
  assert.equal(
    parseRequest("GET", { from: "2026-01-01", to: "2026-04-04" }).ok,
    false,
  );
  assert.equal(
    parseRequest("GET", {
      eventTypes: "macro",
      from: "2026-07-01",
      to: "2026-07-07",
    }).ok,
    false,
  );
});

test("orchestrator fetches one day at a time, deduplicates, and reports IPO candidates", async () => {
  const calls: string[] = [];
  const result = await runFmpCalendarIngestCore(dryRunRequest(), {
    fetchDay: async (eventType, date) => {
      calls.push(`${eventType}:${date}`);
      return fetchResult(eventType, date, fixtureRows(eventType));
    },
    loadUniverse: async () => universe(),
    persistObservation: async () => {
      assert.fail("dry-run must not persist");
    },
    runId: () => "test-run",
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.endsWith(":2026-07-30")));
  assert.equal(result.ok, true);
  assert.equal(result.stage, "dry-run");
  assert.equal(result.stats.fetched, 5);
  assert.equal(result.stats.accepted, 4);
  assert.equal(result.stats.deduplicated, 1);
  assert.equal(result.stats.listed, 3);
  assert.equal(result.stats.ipoCandidates, 1);
  assert.equal(result.stats.readLimitRisk, false);
});

test("identity collisions quarantine instead of fabricating two confident events", async () => {
  const request: FmpCalendarIngestRequest = {
    ...dryRunRequest(),
    eventTypes: ["earnings"],
    from: "2026-07-30",
    to: "2026-08-01",
  };
  const result = await runFmpCalendarIngestCore(request, {
    fetchDay: async (eventType, date) =>
      fetchResult(eventType, date, [earningsRow({ date })]),
    loadUniverse: async () => universe(),
    persistObservation: async () => assert.fail("dry-run must not persist"),
    runId: () => "collision-run",
  });
  assert.equal(result.stats.accepted, 0);
  assert.equal(result.stats.quarantined, 3);
  assert.ok(
    result.warnings.some((warning) =>
      warning.startsWith("quarantined:identity_collision:"),
    ),
  );
});

test("cap or fetch failure is explicit and blocks persist", async () => {
  let persisted = 0;
  const result = await runFmpCalendarIngestCore(
    {
      ...dryRunRequest(),
      dryRun: false,
      eventTypes: ["earnings"],
      persist: true,
    },
    {
      fetchDay: async (eventType, date) => ({
        ...fetchResult(eventType, date, [earningsRow()]),
        truncated: true,
      }),
      loadUniverse: async () => universe(),
      persistObservation: async () => {
        persisted += 1;
        return {
          eventId: "event",
          historyCreated: true,
          revision: 1,
          unchanged: false,
          upserted: true,
        };
      },
      runId: () => "truncated-run",
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, "truncated");
  assert.equal(result.stats.truncated, true);
  assert.equal(persisted, 0);
  assert.ok(result.warnings.includes("persist_blocked_incomplete_fetch"));
});

test("backfill persistence reports upsert/history/unchanged without alert delivery", async () => {
  let persisted = 0;
  const result = await runFmpCalendarIngestCore(
    {
      ...dryRunRequest(),
      dryRun: false,
      eventTypes: ["earnings", "ipo"],
      persist: true,
    },
    {
      fetchDay: async (eventType, date) =>
        fetchResult(eventType, date, fixtureRows(eventType).slice(0, 1)),
      loadUniverse: async () => universe(),
      persistObservation: async () => {
        persisted += 1;
        return persisted === 1
          ? {
              eventId: "event-1",
              historyCreated: true,
              revision: 1,
              unchanged: false,
              upserted: true,
            }
          : {
              eventId: "event-2",
              historyCreated: false,
              revision: 1,
              unchanged: true,
              upserted: false,
            };
      },
      runId: () => "persist-run",
    },
  );
  assert.equal(result.stage, "persisted");
  assert.equal(result.stats.upserted, 1);
  assert.equal(result.stats.unchanged, 1);
  assert.equal(result.stats.history, 1);

  const source = await read("lib/calendar-v1/fmpCalendarIngestCore.ts");
  assert.doesNotMatch(
    source,
    /calendar_alert_candidates|calendar_delivery_attempts|telegram|email/i,
  );
});

test("client and protected route keep credentials/raw payload server-side", async () => {
  const client = await read("lib/calendar-v1/fmpCalendarClient.ts");
  const repository = await read("lib/calendar-v1/fmpCalendarRepository.ts");
  const route = await read("app/api/sources/fmp-calendar/ingest/route.ts");
  const combined = `${client}\n${repository}\n${route}`;

  assert.match(client, /import "server-only"/);
  assert.match(repository, /import "server-only"/);
  assert.match(client, /AbortController/);
  assert.match(client, /FMP_CALENDAR_FETCH_TIMEOUT_MS/);
  assert.match(client, /url\.searchParams\.set\("from", date\)/);
  assert.match(client, /url\.searchParams\.set\("to", date\)/);
  assert.match(route, /sourceIngestAuthResponse\(request\)/);
  assert.equal(
    (route.match(/sourceIngestAuthResponse\(request\)/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(route, /rawPayload|raw_payload|apiKey|FMP_API_KEY/);
  assert.doesNotMatch(combined, /NEXT_PUBLIC_[A-Z_]*FMP/);
});

function adapt(
  eventType: FmpCompanyCalendarEventType,
  row: Record<string, unknown>,
  requestDate = "2026-07-30",
) {
  return adaptFmpCalendarRow(eventType, row, {
    fetchedAt: "2026-07-30T12:00:00.000Z",
    requestDate,
    runId: "fixture-run",
    universe: universe(),
  });
}

function universe() {
  return new Map<string, FmpTickerUniverseEntry>([
    [
      "EXM",
      {
        assetType: "stock",
        exchange: "NASDAQ",
        name: "Example Corporation",
        symbol: "EXM",
      },
    ],
  ]);
}

function earningsRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-30",
    epsActual: null,
    epsEstimated: 1.25,
    lastUpdated: "2026-07-29T20:30:00Z",
    revenueActual: null,
    revenueEstimated: 12_000_000,
    symbol: "EXM",
    ...overrides,
  };
}

function fixtureRows(eventType: FmpCompanyCalendarEventType) {
  if (eventType === "earnings") return [earningsRow(), earningsRow()];
  if (eventType === "dividend") {
    return [
      {
        adjDividend: 0.25,
        date: "2026-07-30",
        declarationDate: "2026-07-01",
        dividend: 0.25,
        frequency: "Quarterly",
        paymentDate: "2026-08-15",
        recordDate: "2026-07-31",
        symbol: "EXM",
      },
    ];
  }
  if (eventType === "split") {
    return [
      {
        date: "2026-07-30",
        denominator: 1,
        numerator: 5,
        splitType: "Forward",
        symbol: "EXM",
      },
    ];
  }
  return [
    {
      actions: "Expected",
      company: "New Company Inc.",
      date: "2026-07-30",
      exchange: "NASDAQ",
      priceRange: "$15 - $17",
      symbol: "NEWC",
    },
  ];
}

function fetchResult(
  eventType: FmpCompanyCalendarEventType,
  date: string,
  rows: unknown[],
): FmpCalendarFetchResult {
  return {
    date,
    eventType,
    fetchedAt: "2026-07-30T12:00:00.000Z",
    rows,
    truncated: rows.length >= FMP_CALENDAR_DAILY_CAP,
  };
}

function dryRunRequest(): FmpCalendarIngestRequest {
  return {
    dryRun: true,
    eventTypes: ["earnings", "dividend", "split", "ipo"],
    from: "2026-07-30",
    mode: "backfill",
    persist: false,
    to: "2026-07-30",
  };
}

function parseRequest(
  method: "GET" | "POST",
  query: Record<string, string>,
) {
  return parseFmpCalendarIngestRequest(
    method,
    new URLSearchParams(query),
    null,
  );
}
