import assert from "node:assert/strict";
import test from "node:test";

import {
  addDateOnlyDays,
  getCalendarMarketDate,
} from "./dateUtils.ts";
import {
  CalendarRepositoryError,
  CalendarRowValidationError,
  MAX_CALENDAR_RANGE_DAYS,
  NORMALIZED_CALENDAR_PAGE_SIZE,
  NORMALIZED_CALENDAR_SELECT,
  STOCK_COMPANY_CALENDAR_LIMIT,
  buildNormalizedCalendarQuery,
  buildStockCompanyCalendarQuery,
  mapNormalizedCalendarRow,
  normalizeCalendarProvider,
  normalizeCalendarAnalysisHref,
  normalizeCompanyCalendarTicker,
  normalizeSafeCalendarSourceUrl,
  parseCalendarEventsApiPayload,
  parseNormalizedCalendarRange,
  readNormalizedCalendarEvents,
  readStockCompanyCalendarEvents,
} from "./normalized.ts";

test("normalized range parser validates required dates, order, and maximum span", () => {
  assert.deepEqual(parseRange("2026-07-01", "2026-07-07"), {
    ok: true,
    range: { from: "2026-07-01", to: "2026-07-07" },
  });
  assert.equal(parseRange("", "2026-07-07").ok, false);
  assert.equal(parseRange("2026-02-30", "2026-03-01").ok, false);
  assert.equal(parseRange("2026-07-08", "2026-07-07").ok, false);
  assert.equal(
    parseRange(
      "2026-01-01",
      addDateOnlyDays("2026-01-01", MAX_CALENDAR_RANGE_DAYS - 1),
    ).ok,
    true,
  );
  assert.deepEqual(
    parseRange(
      "2026-01-01",
      addDateOnlyDays("2026-01-01", MAX_CALENDAR_RANGE_DAYS),
    ),
    {
      ok: false,
      error: {
        code: "RANGE_TOO_LARGE",
        message: `Calendar ranges are limited to ${MAX_CALENDAR_RANGE_DAYS} days.`,
      },
    },
  );
});

test("normalized query uses the date index contract and a public projection", () => {
  assert.deepEqual(
    buildNormalizedCalendarQuery(
      { from: "2026-07-01", to: "2026-07-07" },
      500,
    ),
    {
      and: "(event_date.gte.2026-07-01,event_date.lte.2026-07-07)",
      limit: String(NORMALIZED_CALENDAR_PAGE_SIZE),
      offset: "500",
      order: "event_date.asc,event_time.asc.nullslast,id.asc",
      select: NORMALIZED_CALENDAR_SELECT,
    },
  );
  for (const forbidden of [
    "canonical_identity_key",
    "source_event_key",
    "raw_payload_id",
    "checksum",
    "payload",
  ]) {
    assert.doesNotMatch(NORMALIZED_CALENDAR_SELECT, new RegExp(forbidden));
  }
  for (const relation of [
    "calendar_event_types",
    "calendar_event_sources",
    "calendar_event_securities",
    "calendar_event_sectors",
    "calendar_event_metrics",
    "calendar_event_details",
    "calendar_event_analysis_links",
  ]) {
    assert.match(NORMALIZED_CALENDAR_SELECT, new RegExp(relation));
  }
});

test("stock company query is exact, primary-ticker scoped, direction-aware, and capped", async () => {
  const range = { from: "2026-08-01", to: "2026-10-31" };
  const query = buildStockCompanyCalendarQuery(range, "amd");
  assert.equal(query.category, "eq.company");
  assert.equal(query["securities.role"], "eq.primary");
  assert.equal(query["securities.ticker"], "eq.AMD");
  assert.equal(query.limit, String(STOCK_COMPANY_CALENDAR_LIMIT));
  assert.equal(query.order, "event_date.asc,event_time.asc.nullslast,id.asc");
  assert.equal(
    buildStockCompanyCalendarQuery(range, "AMD", "desc").order,
    "event_date.desc,event_time.desc.nullslast,id.desc",
  );
  assert.match(query.select, /calendar_event_securities!inner/);
  assert.equal(normalizeCompanyCalendarTicker(" amd "), "AMD");
  assert.equal(normalizeCompanyCalendarTicker("AMD&category=eq.policy"), null);

  const amdRow = baseMacroRow({
    category: "company",
    details: { detail: { company_name: "Advanced Micro Devices" }, schema_version: 1 },
    event_date: "2026-08-04",
    event_type: "earnings",
    impact_scope: "company",
    securities: [{ role: "primary", ticker: "AMD" }],
    title: "AMD earnings",
    type_definition: { label: "Earnings", policy_subcategory: null, schema_version: 1 },
  });
  const otherRow = {
    ...amdRow,
    id: uuidFor(91),
    securities: [{ role: "primary", ticker: "JPM" }],
    title: "JPM earnings",
  };
  const events = await readStockCompanyCalendarEvents(
    range,
    "AMD",
    async (_table, receivedQuery) => {
      assert.deepEqual(receivedQuery, query);
      return { count: 2, data: [amdRow, otherRow], ok: true, status: 200 };
    },
  );
  assert.deepEqual(events.map((event) => event.ticker), ["AMD"]);
});

test("mapper creates a Macro event from normalized relations and numeric text", () => {
  const event = mapNormalizedCalendarRow(baseMacroRow());
  assert.equal(event.category, "macro");
  assert.equal(event.eventType, "cpi");
  assert.equal(event.provider, "fmp");
  assert.equal(event.sourceAgency, "BLS");
  assert.equal(event.sourceUrl, "https://www.bls.gov/cpi/");
  assert.equal(event.status, "confirmed");
  assert.deepEqual(event.affectedSectors, ["Consumer Cyclical"]);
  assert.deepEqual(event.relatedTickers, ["SPY"]);
  if (event.category !== "macro") assert.fail("expected Macro event");
  assert.deepEqual(event.details.metrics[0], {
    actual: null,
    consensus: 0.2,
    name: "Headline CPI MoM",
    previous: 0.1,
    releaseStage: "monthly",
    released: false,
    unit: "percent",
  });
});

test("mapper handles missing optional source, security, metric, and details safely", () => {
  const row = baseMacroRow({
    details: null,
    metrics: null,
    sectors: null,
    securities: null,
    sources: null,
  });
  const event = mapNormalizedCalendarRow(row);
  assert.equal(event.provider, "unknown");
  assert.equal(event.sourceAgency, "Agency not announced");
  assert.equal(event.sourceUrl, null);
  assert.equal(event.detailHref, null);
  assert.deepEqual(event.affectedSectors, []);
  assert.deepEqual(event.relatedTickers, []);
  if (event.category !== "macro") assert.fail("expected Macro event");
  assert.deepEqual(event.details, {
    metrics: [],
    referencePeriod: null,
    releaseNote: null,
  });
});

test("calendar analysis routes come only from linked relationships and use the filing route", () => {
  const eventId = "00000000-0000-4000-8000-000000000001";
  assert.equal(normalizeCalendarAnalysisHref(`/events/${eventId}`), null);
  assert.equal(normalizeCalendarAnalysisHref(`/filings/${eventId}`), `/filings/${eventId}`);
  assert.equal(normalizeCalendarAnalysisHref(`/stocks/${eventId}`), null);
  assert.equal(normalizeCalendarAnalysisHref("https://example.com/events/1"), null);
  assert.equal(normalizeCalendarAnalysisHref("/filings/not-persistent"), null);

  const mapped = mapNormalizedCalendarRow(
    baseMacroRow({
      analysis_links: [
        { analysis_event_id: eventId, is_primary: true, link_status: "linked" },
        { analysis_event_id: uuidFor(2), is_primary: false, link_status: "linked" },
      ],
      details: {
        detail: {
          analysis_href: `/filings/${uuidFor(3)}`,
          reference_period: "June 2026",
        },
        schema_version: 1,
      },
    }),
  );
  assert.equal(mapped.detailHref, `/filings/${eventId}`);
  assert.equal(mapped.relatedAnalysisCount, 1);
  assert.equal(mapped.analysisPending, false);

  const pending = mapNormalizedCalendarRow(
    baseMacroRow({
      analysis_links: [
        { analysis_event_id: uuidFor(4), is_primary: false, link_status: "candidate" },
      ],
    }),
  );
  assert.equal(pending.detailHref, null);
  assert.equal(pending.relatedAnalysisCount, 0);
  assert.equal(pending.analysisPending, true);
});

test("mapper creates Company and Policy discriminated details without inventing values", () => {
  const earnings = mapNormalizedCalendarRow(
    baseMacroRow({
      category: "company",
      details: {
        detail: {
          company_name: "Example Corporation",
          eps_estimate: "1.25",
        },
        schema_version: 1,
      },
      event_type: "earnings",
      impact_scope: "company",
      securities: [
        { role: "primary", ticker: "EXM" },
        { role: "related", ticker: "EXM.A" },
      ],
      title: "Example earnings",
      type_definition: {
        label: "Earnings",
        policy_subcategory: null,
        schema_version: 1,
      },
    }),
  );
  assert.equal(earnings.category, "company");
  if (earnings.category !== "company" || earnings.eventType !== "earnings") {
    assert.fail("expected Earnings event");
  }
  assert.equal(earnings.ticker, "EXM");
  assert.equal(earnings.companyName, "Example Corporation");
  assert.equal(earnings.details.epsEstimate, 1.25);
  assert.equal(earnings.details.fiscalQuarter, null);

  const policy = mapNormalizedCalendarRow(
    baseMacroRow({
      category: "policy",
      details: null,
      event_type: "fda-advisory-committee",
      impact_scope: "sector",
      securities: [{ role: "related", ticker: "BIO" }],
      sources: [
        {
          confidence: "high",
          fetched_at: "2026-07-29T12:00:00Z",
          provider: "unrecognized-provider",
          source_agency: "FDA",
          source_name: "Advisory Committee Calendar",
          source_url: "javascript:alert(1)",
        },
      ],
      title: "FDA advisory committee",
      type_definition: {
        label: "FDA Advisory Committee",
        policy_subcategory: "industry-regulation",
        schema_version: 1,
      },
    }),
  );
  assert.equal(policy.category, "policy");
  if (
    policy.category !== "policy" ||
    policy.eventType !== "fda-advisory-committee"
  ) {
    assert.fail("expected FDA event");
  }
  assert.equal(policy.provider, "other");
  assert.equal(policy.sourceUrl, null);
  assert.equal(policy.primaryTicker, null);
  assert.deepEqual(policy.relatedTickers, ["BIO"]);
  assert.equal(policy.details.product, null);
});

test("mapper rejects malformed core rows and contradictory taxonomy", () => {
  assert.throws(
    () => mapNormalizedCalendarRow(baseMacroRow({ event_date: "2026-02-30" })),
    CalendarRowValidationError,
  );
  assert.throws(
    () =>
      mapNormalizedCalendarRow(
        baseMacroRow({
          category: "company",
          event_type: "cpi",
        }),
      ),
    /does not belong/,
  );
  assert.throws(
    () =>
      mapNormalizedCalendarRow(
        baseMacroRow({ event_timezone: "Asia/Seoul" }),
      ),
    /America\/New_York/,
  );
  assert.throws(
    () => mapNormalizedCalendarRow(baseMacroRow({ type_definition: null })),
    /type definition is missing/,
  );
});

test("repository core paginates, maps rows, and refuses oversized or invalid results", async () => {
  const calls: Array<Record<string, string>> = [];
  const rows = Array.from({ length: NORMALIZED_CALENDAR_PAGE_SIZE + 1 }, (_, index) =>
    baseMacroRow({ id: uuidFor(index + 1) }),
  );
  const events = await readNormalizedCalendarEvents(
    { from: "2026-07-01", to: "2026-07-07" },
    async (_table, query) => {
      calls.push(query);
      const offset = Number(query.offset);
      return {
        count: rows.length,
        data: rows.slice(offset, offset + NORMALIZED_CALENDAR_PAGE_SIZE),
        ok: true,
        status: 200,
      };
    },
  );
  assert.equal(events.length, NORMALIZED_CALENDAR_PAGE_SIZE + 1);
  assert.deepEqual(calls.map((query) => query.offset), ["0", "500"]);

  await assert.rejects(
    () =>
      readNormalizedCalendarEvents(
        { from: "2026-07-01", to: "2026-07-07" },
        async () => ({
          count: 2_001,
          data: [],
          ok: true,
          status: 200,
        }),
      ),
    (error: unknown) =>
      error instanceof CalendarRepositoryError &&
      error.code === "CALENDAR_RESULT_LIMIT",
  );
  await assert.rejects(
    () =>
      readNormalizedCalendarEvents(
        { from: "2026-07-01", to: "2026-07-07" },
        async () => ({
          count: null,
          data: null,
          error: "secret database detail",
          ok: false,
          status: 500,
        }),
      ),
    (error: unknown) =>
      error instanceof CalendarRepositoryError &&
      error.message === "Normalized Calendar data could not be loaded." &&
      !error.message.includes("secret"),
  );
});

test("public API payload parser rejects malformed responses and exposes no internal fields", () => {
  const event = mapNormalizedCalendarRow(baseMacroRow());
  const events = parseCalendarEventsApiPayload({ ok: true, data: [event] });
  assert.equal(events[0]?.id, event.id);
  assert.throws(() => parseCalendarEventsApiPayload({ ok: true, data: [{}] }));
  assert.throws(() =>
    parseCalendarEventsApiPayload({ ok: false, error: { code: "failed" } }),
  );
  const serialized = JSON.stringify({ ok: true, data: events });
  for (const forbidden of [
    "canonical_identity_key",
    "source_event_key",
    "raw_payload_id",
    "checksum",
    "service_role",
    "providerEventKey",
    "sourceEventKey",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("provider and source URL normalizers use closed public values", () => {
  assert.equal(normalizeCalendarProvider("Financial Modeling Prep"), "fmp");
  assert.equal(normalizeCalendarProvider("Bureau of Labor Statistics"), "bls");
  assert.equal(normalizeCalendarProvider("custom feed"), "other");
  assert.equal(normalizeCalendarProvider(null), "unknown");
  assert.equal(
    normalizeSafeCalendarSourceUrl("https://www.sec.gov/news"),
    "https://www.sec.gov/news",
  );
  assert.equal(normalizeSafeCalendarSourceUrl("javascript:alert(1)"), null);
  assert.equal(normalizeSafeCalendarSourceUrl("https://user:pass@example.com"), null);
});

test("ET market date is stable across UTC, KST, and DST boundaries", () => {
  assert.equal(
    getCalendarMarketDate(new Date("2026-07-30T00:30:00+09:00")),
    "2026-07-29",
  );
  assert.equal(
    getCalendarMarketDate(new Date("2026-03-08T04:59:59Z")),
    "2026-03-07",
  );
  assert.equal(
    getCalendarMarketDate(new Date("2026-03-08T05:00:00Z")),
    "2026-03-08",
  );
  assert.equal(
    getCalendarMarketDate(new Date("2026-11-01T03:59:59Z")),
    "2026-10-31",
  );
  assert.equal(
    getCalendarMarketDate(new Date("2026-11-01T04:00:00Z")),
    "2026-11-01",
  );
  assert.throws(() => getCalendarMarketDate(new Date("invalid")), RangeError);
});

function parseRange(from: string, to: string) {
  return parseNormalizedCalendarRange(
    new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }),
  );
}

function baseMacroRow(overrides: Record<string, unknown> = {}) {
  return {
    analysis_links: [],
    category: "macro",
    details: {
      detail: {
        reference_period: "June 2026",
        release_note: null,
      },
      schema_version: 1,
    },
    event_date: "2026-07-15",
    event_end_date: null,
    event_time: "08:30:00",
    event_timezone: "America/New_York",
    event_type: "cpi",
    id: "00000000-0000-4000-8000-000000000001",
    impact_level: "high",
    impact_scope: "market-wide",
    last_seen_at: "2026-07-29T13:00:00Z",
    lifecycle_status: "scheduled",
    market_session: "bmo",
    metrics: [
      {
        actual: null,
        actual_text: null,
        consensus: "0.2",
        consensus_text: "0.2%",
        metric_key: "headline-mom",
        name: "Headline CPI MoM",
        previous: "0.1",
        previous_text: "0.1%",
        release_stage: "monthly",
        released: false,
        unit: "percent",
        unit_raw: "%",
      },
    ],
    schedule_confidence: "confirmed",
    sectors: [{ role: "affected", sector: "Consumer Cyclical" }],
    securities: [{ role: "related", ticker: "SPY" }],
    sources: [
      {
        confidence: "high",
        fetched_at: "2026-07-29T12:00:00Z",
        provider: "fmp",
        source_agency: "BLS",
        source_modified_at: "2026-07-29T12:30:00Z",
        source_name: "Consumer Price Index",
        source_url: "https://www.bls.gov/cpi/",
      },
    ],
    time_status: "exact",
    title: "Consumer Price Index release",
    type_definition: {
      label: "CPI",
      policy_subcategory: null,
      schema_version: 1,
    },
    updated_at: "2026-07-29T12:45:00Z",
    ...overrides,
  };
}

function uuidFor(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
