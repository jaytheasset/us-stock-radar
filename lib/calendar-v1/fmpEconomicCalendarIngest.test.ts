import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  adaptFmpEconomicCalendarRows,
  fmpUtcToEastern,
} from "./fmpEconomicCalendarAdapter.ts";
import {
  buildFmpEconomicCalendarIdentity,
  extractFmpReferencePeriod,
} from "./fmpEconomicCalendarIdentity.ts";
import {
  parseFmpEconomicCalendarIngestRequest,
  runFmpEconomicCalendarIngestCore,
} from "./fmpEconomicCalendarIngestCore.ts";
import {
  FMP_ECONOMIC_CALENDAR_EVENT_TYPES,
  FMP_ECONOMIC_CALENDAR_UNSUPPORTED_POLICY_TYPES,
  type FmpEconomicCalendarFetchResult,
  type FmpEconomicCalendarIngestRequest,
} from "./fmpEconomicCalendarTypes.ts";

const read = (relativePath: string) =>
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("UTC schedules convert to Eastern time across daylight saving boundaries", () => {
  assert.deepEqual(fmpUtcToEastern("2026-07-14 12:30:00"), {
    eventDate: "2026-07-14",
    eventInstant: "2026-07-14T12:30:00.000Z",
    eventTime: "08:30",
  });
  assert.deepEqual(fmpUtcToEastern("2026-01-14 13:30:00"), {
    eventDate: "2026-01-14",
    eventInstant: "2026-01-14T13:30:00.000Z",
    eventTime: "08:30",
  });
});

test("the explicit Macro allowlist groups one release and rejects aliases", () => {
  const result = adapt([
    macroRow("CPI YoY (Jun)", { actual: 2.8 }),
    macroRow("Core CPI YoY (Jun)", { actual: 3.1 }),
    macroRow("CPI MoM (Jun)", { actual: 0.2 }),
    macroRow("CPI Index (Jun)", { actual: 322.6 }),
    macroRow("CPI YoY (Jun)", { country: "CA" }),
  ]);

  assert.equal(result.usRows, 4);
  assert.equal(result.matchedRows, 2);
  assert.equal(result.observations.length, 1);
  const [observation] = result.observations;
  assert.equal(observation.eventType, "cpi");
  assert.equal(observation.eventDate, "2026-07-14");
  assert.equal(observation.eventTime, "08:30");
  assert.deepEqual(
    observation.metrics.map((metric) => metric.metricKey),
    ["core-yoy", "headline-yoy"],
  );
  assert.equal(observation.lifecycleStatus, "released");
});

test("Employment Situation groups exactly three allowed metrics", () => {
  const result = adapt([
    macroRow("Non Farm Payrolls (Jun)", {
      actual: 177,
      unit: "K",
    }),
    macroRow("Unemployment Rate (Jun)", { actual: 4.1 }),
    macroRow("Average Hourly Earnings YoY (Jun)", { actual: 3.7 }),
    macroRow("ADP Employment Change (Jun)", {
      actual: 120,
      unit: "K",
    }),
  ]);

  assert.equal(result.observations.length, 1);
  assert.deepEqual(
    result.observations[0].metrics.map((metric) => metric.metricKey),
    [
      "average-hourly-earnings-yoy",
      "nonfarm-payrolls",
      "unemployment-rate",
    ],
  );
});

test("JOLTS converts FMP millions into normalized thousands", () => {
  const result = adapt([
    macroRow("JOLTs Job Openings (Jun)", {
      actual: 7.437,
      estimate: 7.51,
      previous: 7.769,
      unit: "M",
    }),
  ]);
  const metric = result.observations[0].metrics[0];
  assert.equal(metric.actual, 7_437);
  assert.equal(metric.consensus, 7_510);
  assert.equal(metric.previous, 7_769);
  assert.equal(metric.unit, "thousands");
});

test("FOMC projections never fabricate SEP or target range details", () => {
  const result = adapt([
    macroRow("Fed Interest Rate Decision", {
      actual: 4.5,
      date: "2026-07-29 18:00:00",
      unit: "%",
    }),
    macroRow("FOMC Economic Projections", {
      actual: null,
      date: "2026-07-29 18:00:00",
      unit: "",
    }),
  ]);

  assert.equal(result.observations.length, 1);
  const [observation] = result.observations;
  assert.equal(observation.eventType, "fomc-decision");
  assert.equal(observation.eventTime, "14:00");
  assert.equal(observation.eventInstant, "2026-07-29T18:00:00.000Z");
  assert.deepEqual(observation.metrics, []);
  assert.deepEqual(observation.details, {
    decisionTime: "14:00",
    includesSep: null,
    pressConferenceTime: null,
    targetRangeLower: null,
    targetRangeUpper: null,
  });
});

test("Policy documents complete after their FMP instant while future rows stay scheduled", () => {
  const result = adapt([
    macroRow("FOMC Minutes", {
      actual: null,
      date: "2026-07-08 18:00:00",
      unit: "",
    }),
    macroRow("FOMC Minutes", {
      actual: null,
      date: "2026-08-19 18:00:00",
      unit: "",
    }),
  ]);

  assert.equal(result.observations.length, 2);
  const july = result.observations.find(
    (observation) => observation.eventDate === "2026-07-08",
  );
  const august = result.observations.find(
    (observation) => observation.eventDate === "2026-08-19",
  );
  assert.equal(july?.eventTime, "14:00");
  assert.equal(july?.lifecycleStatus, "released");
  assert.equal(august?.eventTime, "14:00");
  assert.equal(august?.lifecycleStatus, "scheduled");
});

test("canonical identities use reference periods or recurrence, never scheduled dates", () => {
  const june = extractFmpReferencePeriod("CPI YoY (Jun)", "2026-07-14");
  assert.deepEqual(june, { display: "June 2026", identity: "2026-06" });
  const cpiIdentity = buildFmpEconomicCalendarIdentity({
    eventDate: "2026-07-14",
    eventType: "cpi",
    referencePeriod: june,
  });
  assert.equal(cpiIdentity, "fmp:macro:cpi:2026-06");
  assert.equal(
    cpiIdentity,
    buildFmpEconomicCalendarIdentity({
      eventDate: "2026-07-16",
      eventType: "cpi",
      referencePeriod: june,
    }),
  );
  assert.doesNotMatch(cpiIdentity, /2026-07-14/);
  assert.equal(
    buildFmpEconomicCalendarIdentity({
      eventDate: "2026-07-29",
      eventType: "fomc-decision",
      referencePeriod: null,
    }),
    "fmp:policy:fomc-decision:2026-07",
  );
  assert.equal(
    buildFmpEconomicCalendarIdentity({
      eventDate: "2026-08-05",
      eventType: "treasury-refunding",
      referencePeriod: null,
    }),
    "fmp:policy:treasury-refunding:2026:q3",
  );
});

test("coverage is explicit and unsupported Policy types are reported", () => {
  assert.deepEqual(FMP_ECONOMIC_CALENDAR_EVENT_TYPES, [
    "cpi",
    "ppi",
    "pce",
    "employment-situation",
    "jolts",
    "gdp-advance",
    "retail-sales",
    "fomc-decision",
    "fomc-minutes",
    "treasury-refunding",
    "treasury-auction-10y",
    "treasury-auction-30y",
  ]);
  assert.ok(
    FMP_ECONOMIC_CALENDAR_UNSUPPORTED_POLICY_TYPES.includes(
      "fed-chair-testimony",
    ),
  );
});

test("GET is dry-run only and POST is persist-only", () => {
  const get = parseRequest("GET", {
    from: "2026-07-01",
    to: "2026-08-31",
  });
  assert.equal(get.ok, true);
  if (get.ok) {
    assert.equal(get.request.dryRun, true);
    assert.equal(get.request.persist, false);
  }
  assert.equal(
    parseRequest("GET", {
      dryRun: "false",
      from: "2026-07-01",
      persist: "true",
      to: "2026-08-31",
    }).ok,
    false,
  );
  assert.equal(
    parseFmpEconomicCalendarIngestRequest(
      "POST",
      new URLSearchParams(),
      {
        dryRun: false,
        from: "2026-07-01",
        persist: true,
        to: "2026-08-31",
      },
    ).ok,
    true,
  );
});

test("dry-run never persists and persistence reports history versus unchanged", async () => {
  let persisted = 0;
  const dryRun = await runFmpEconomicCalendarIngestCore(
    request({ dryRun: true, persist: false }),
    {
      fetchRange: async () => fetchResult(),
      persistObservation: async () => {
        assert.fail("dry-run must not persist");
      },
      runId: () => "dry-run",
    },
  );
  assert.equal(dryRun.stage, "dry-run");
  assert.equal(dryRun.stats.accepted, 1);

  const persistedRun = await runFmpEconomicCalendarIngestCore(
    request({ dryRun: false, persist: true }),
    {
      fetchRange: async () => fetchResult(),
      persistObservation: async () => {
        persisted += 1;
        return {
          eventId: "event",
          historyCreated: persisted === 1,
          revision: 1,
          unchanged: persisted !== 1,
          upserted: persisted === 1,
        };
      },
      runId: () => "persist-run",
    },
  );
  assert.equal(persistedRun.stage, "persisted");
  assert.equal(persistedRun.stats.upserted, 1);
  assert.equal(persistedRun.stats.history, 1);
  assert.equal(persistedRun.stats.unchanged, 0);
});

test("retired route remains protected and never reaches provider or persistence", async () => {
  const route = await read("app/api/sources/fmp-economic-calendar/ingest/route.ts");
  const repository = await read("lib/calendar-v1/fmpEconomicCalendarRepository.ts");
  assert.match(repository, /import "server-only"/);
  assert.equal((route.match(/sourceIngestAuthResponse\(request\)/g) ?? []).length, 2);
  assert.match(route, /FMP_RETIRED/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /runFmp|request\.json|rawPayload|raw_payload|apiKey|FMP_API_KEY|NEXT_PUBLIC_/);
});

function adapt(rows: unknown[]) {
  return adaptFmpEconomicCalendarRows(rows, {
    eventTypes: new Set(FMP_ECONOMIC_CALENDAR_EVENT_TYPES),
    fetchedAt: "2026-07-30T12:00:00.000Z",
    requestFrom: "2026-07-01",
    requestTo: "2026-08-31",
    runId: "fixture-run",
  });
}

function macroRow(
  event: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    actual: null,
    country: "US",
    date: "2026-07-14 12:30:00",
    estimate: 2.7,
    event,
    impact: "High",
    previous: 2.4,
    unit: "%",
    ...overrides,
  };
}

function fetchResult(): FmpEconomicCalendarFetchResult {
  return {
    fetchedAt: "2026-07-30T12:00:00.000Z",
    from: "2026-07-01",
    rows: [macroRow("CPI YoY (Jun)", { actual: 2.8 })],
    to: "2026-08-31",
    truncated: false,
  };
}

function request(
  overrides: Partial<FmpEconomicCalendarIngestRequest>,
): FmpEconomicCalendarIngestRequest {
  return {
    dryRun: true,
    eventTypes: [...FMP_ECONOMIC_CALENDAR_EVENT_TYPES],
    from: "2026-07-01",
    mode: "backfill",
    persist: false,
    to: "2026-08-31",
    ...overrides,
  };
}

function parseRequest(
  method: "GET" | "POST",
  query: Record<string, string>,
) {
  return parseFmpEconomicCalendarIngestRequest(
    method,
    new URLSearchParams(query),
    null,
  );
}
