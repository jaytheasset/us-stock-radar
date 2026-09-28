import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeListingMonitorAlertsForEvent,
  type ListingMonitorAlertConsumerDependencies,
} from "./listingMonitorAlertConsumer.ts";
import type {
  ListingMonitor,
  ListingMonitorDiagnostic,
} from "./listingMonitorPersistence.ts";
import type { CurrentListingRiskReadResult } from "./listingRiskPersistence.ts";
import type { CurrentCorporateActionReadResult } from "./corporateActionPersistence.ts";
import { validateNaturalLanguageConditionCompilerOutput } from "./naturalLanguageConditionCompiler.ts";
import { buildNaturalLanguageMonitorDraft } from "./naturalLanguageMonitorDraft.ts";
import {
  applyNaturalLanguageMonitorConfirmation,
  parseNaturalLanguageMonitorConfirmationRequest,
} from "./naturalLanguageMonitorConfirmation.ts";
import {
  buildForm4InsiderPurchaseConditions,
  FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  type Form4InsiderPurchaseSettings,
  type Form4PurchaseMatchEvidence,
} from "./form4InsiderPurchaseMonitor.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";

const EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const SOURCE_EXECUTION_ID = "5323aa52-5944-5877-99b0-c9f74ba6d98c";
const OTHER_SOURCE_EXECUTION_ID = "696bc839-6355-57e8-a758-98954c23acb6";
const OWNER_ID = "a2000000-0000-4000-8000-000000000001";

test("MATCH creates once, retry dedupes, and NO_MATCH/INELIGIBLE/invalid monitors create nothing", async () => {
  const harness = consumerHarness();
  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);

  assert.equal(harness.reads(), 2, "one official read per source processing attempt");
  assert.deepEqual(first.evaluations.map((item) => item.status), ["match", "no_match", "ineligible"]);
  assert.deepEqual(first.diagnostics, [invalidDiagnostic()]);
  assert.deepEqual([first.createdCount, first.existingCount, first.failedCount], [1, 0, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount, replay.failedCount], [0, 1, 0]);
  assert.equal(harness.alertCount(), 1);
  assert.equal(first.sourceExecutionId, SOURCE_EXECUTION_ID);
  assert.equal(first.evaluationDate, "2026-08-14");
});

test("same monitor and canonical event dedupes across different source executions", async () => {
  const harness = consumerHarness({
    sourceExecutionIds: [SOURCE_EXECUTION_ID, OTHER_SOURCE_EXECUTION_ID],
  });
  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  const reanalysis = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);

  assert.equal(first.sourceExecutionId, SOURCE_EXECUTION_ID);
  assert.equal(reanalysis.sourceExecutionId, OTHER_SOURCE_EXECUTION_ID);
  assert.deepEqual([first.createdCount, first.existingCount], [1, 0]);
  assert.deepEqual([reanalysis.createdCount, reanalysis.existingCount], [0, 1]);
  assert.equal(harness.alertCount(), 1);
});

test("Form 4 purchase consumer stores every matching row in one replay-safe internal alert", async () => {
  const settings: Form4InsiderPurchaseSettings = {
    target: { scope: "watchlist" }, role: "director", minimumShares: null,
  };
  const specialMonitor: ListingMonitor = {
    id: "a2000000-0000-4000-8000-000000000041",
    userId: OWNER_ID,
    domain: "listing",
    kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND,
    conditions: buildForm4InsiderPurchaseConditions(settings),
    form4PurchaseSettings: settings,
    isActive: true,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const keys = new Set<string>();
  const evidence: Form4PurchaseMatchEvidence[] = [];
  const history: Parameters<NonNullable<ListingMonitorAlertConsumerDependencies["recordForm4Evaluation"]>>[0][] = [];
  let watchlistReads = 0;
  const dependencies: ListingMonitorAlertConsumerDependencies = {
    readOwnershipFacts: async () => availableForm4Purchase(),
    readWatchlistTickers: async (userId) => {
      watchlistReads += 1;
      assert.equal(userId, OWNER_ID);
      return ["AGIG"];
    },
    listActiveMonitors: async () => ({ monitors: [specialMonitor], diagnostics: [] }),
    recordForm4Evaluation: async (input) => {
      history.push(input);
      return { status: "recorded", recordId: input.processingAttemptId };
    },
    createAlert: async (input) => {
      assert.deepEqual(input.matchEvidence?.matches.map((row) => row.sharesRaw), ["1050", "8950"]);
      if (input.matchEvidence) evidence.push(input.matchEvidence);
      const key = `${input.monitorId}:${input.eventId}`;
      if (keys.has(key)) return { status: "existing", monitorId: input.monitorId };
      keys.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-05-23T15:00:00.000Z"),
  };

  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);

  assert.deepEqual(first.evaluations.map((item) => [item.status, item.reasonCode]), [["match", "all_conditions_match"]]);
  assert.deepEqual([first.createdCount, first.existingCount], [1, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount], [0, 1]);
  assert.equal(keys.size, 1);
  assert.equal(evidence.length, 2, "replay reaches the same unique upsert with the full evidence envelope");
  assert.equal(watchlistReads, 2, "watchlist is read once per complete processing attempt");
  assert.deepEqual(history.map((item) => [item.result.status, item.notification.status, item.notification.reasonCode]), [
    ["match", "created", "alert_created"],
    ["match", "existing", "duplicate_alert_existing"],
  ]);
  assert.equal(history[0]?.result.form4PurchaseTrace?.rows.length, 2);
  assert.notEqual(history[0]?.processingAttemptId, history[1]?.processingAttemptId);
  assert.deepEqual(first.evaluationHistoryWrites.map((write) => write.status), ["recorded"]);
});

test("Form 4 purchase consumer does not backfill a filing from before monitor activation", async () => {
  const settings: Form4InsiderPurchaseSettings = {
    target: { scope: "ticker", ticker: "AGIG" }, role: "director", minimumShares: null,
  };
  const monitor: ListingMonitor = {
    id: "a2000000-0000-4000-8000-000000000042",
    userId: OWNER_ID,
    domain: "listing",
    kind: FORM4_INSIDER_PURCHASE_MONITOR_KIND,
    conditions: buildForm4InsiderPurchaseConditions(settings),
    form4PurchaseSettings: settings,
    isActive: true,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
  let writes = 0;
  const history: Parameters<NonNullable<ListingMonitorAlertConsumerDependencies["recordForm4Evaluation"]>>[0][] = [];
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    readOwnershipFacts: async () => availableForm4Purchase(),
    listActiveMonitors: async () => ({ monitors: [monitor], diagnostics: [] }),
    recordForm4Evaluation: async (input) => {
      history.push(input);
      return { status: "recorded" };
    },
    createAlert: async () => {
      writes += 1;
      return { status: "created", monitorId: monitor.id };
    },
    now: () => new Date("2026-05-24T00:01:00.000Z"),
  });

  assert.deepEqual(result.evaluations, [{
    monitorId: monitor.id,
    status: "no_match",
    reasonCode: "monitor_activation_not_met",
  }]);
  assert.equal(writes, 0);
  assert.equal(result.createdCount, 0);
  assert.deepEqual(history.map((item) => [item.result.reasonCode, item.notification.status]), [
    ["monitor_activation_not_met", "not_created"],
  ]);
  assert.equal(history[0]?.result.form4PurchaseTrace?.status, "match", "raw literal matcher result remains inspectable behind the effective activation gate");
});

test("not-applicable and reader-unavailable results remain literal INELIGIBLE outcomes", async () => {
  const base = consumerHarness();
  const notApplicable = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...base.dependencies,
    readFacts: async () => {
      const current = availableCurrent();
      const { facts: _facts, factSchemaVersion: _version, status: _status, ...lineage } = current;
      return { status: "not_applicable", ...lineage };
    },
  });
  assert.ok(notApplicable.evaluations.every((item) => item.status === "ineligible"));
  assert.equal(notApplicable.writes.length, 0);

  const unavailable = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...base.dependencies,
    readFacts: async () => { throw new Error("offline"); },
  });
  assert.ok(unavailable.evaluations.every((item) => item.reasonCode === "reader_unavailable"));
  assert.equal(unavailable.writes.length, 0);
});

test("SEC amendment identity validation failures never fall back to existing facts or write Alerts", async () => {
  for (const reason of ["original_url_missing", "issuer_cik_mismatch"]) {
    const harness = consumerHarness();
    const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
      ...harness.dependencies,
      readSecAmendmentCurrentState: async () => ({ status: "blocked", reason }),
    });

    assert.equal(harness.reads(), 0, reason);
    assert.equal(harness.alertCount(), 0, reason);
    assert.equal(result.createdCount, 0, reason);
    assert.equal(result.existingCount, 0, reason);
    assert.equal(result.writes.length, 0, reason);
    assert.ok(result.evaluations.every((item) => item.status === "ineligible"), reason);
  }
});

test("one Alert insert failure is reported and does not block another matching monitor", async () => {
  const harness = consumerHarness({ secondMatch: true, failFirstWrite: true });
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  assert.equal(result.status, "partial_failure");
  assert.deepEqual(result.writes.map((write) => write.status), ["failed", "created"]);
  assert.equal(result.failedCount, 1);
  assert.equal(result.createdCount, 1);
});

test("Price plus Listing creates one deduped Alert from one price read per event attempt", async () => {
  let priceReads = 0;
  const alerts = new Set<string>();
  const monitors = [
    monitor("a2000000-0000-4000-8000-000000000021", [
      { key: "market.price", operator: "lt", value: 1 },
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    ]),
    monitor("a2000000-0000-4000-8000-000000000022", [
      { key: "market.price", operator: "gt", value: 1 },
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    ]),
    monitor("a2000000-0000-4000-8000-000000000023", [
      { key: "market.price", operator: "lt", value: 1 },
      { key: "listing.appeal_deadline", operator: "eq", value: "2026-08-20" },
    ]),
  ] satisfies ListingMonitor[];
  const dependencies: ListingMonitorAlertConsumerDependencies = {
    readFacts: async () => availableCurrent(),
    readCurrentPrice: async (symbol) => {
      priceReads += 1;
      assert.equal(symbol, "ATPC");
      return {
        asOf: "2026-08-14T11:59:00.000Z",
        availability: "available",
        dataMode: "realtime",
        price: 0.99,
        symbol,
      };
    },
    listActiveMonitors: async () => ({ monitors, diagnostics: [] }),
    createAlert: async (input) => {
      const key = `${input.monitorId}:${input.eventId}`;
      if (alerts.has(key)) return { status: "existing", monitorId: input.monitorId };
      alerts.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  };

  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  assert.equal(priceReads, 2, "one physical price read for each complete event attempt");
  assert.deepEqual(first.evaluations.map((item) => item.status), ["match", "no_match", "ineligible"]);
  assert.deepEqual([first.createdCount, first.existingCount], [1, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount], [0, 1]);
  assert.equal(alerts.size, 1);
});

test("$0.82 plus AEMD reverse split creates exactly one Alert and replay preserves dedupe", async () => {
  let corporateActionReads = 0;
  let tickerReads = 0;
  let priceReads = 0;
  const alerts = new Set<string>();
  const monitors = [
    monitor("a2000000-0000-4000-8000-000000000031", clarifiedReverseSplitConditions()),
    monitor("a2000000-0000-4000-8000-000000000032", [
      { key: "market.price", operator: "lt", value: 0.5 },
      { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    ]),
  ] satisfies ListingMonitor[];
  const dependencies: ListingMonitorAlertConsumerDependencies = {
    readCorporateActionFacts: async () => {
      corporateActionReads += 1;
      return availableCorporateAction();
    },
    readEventTicker: async () => {
      tickerReads += 1;
      return "AEMD";
    },
    readCurrentPrice: async (symbol) => {
      priceReads += 1;
      assert.equal(symbol, "AEMD");
      return {
        asOf: "2026-08-14T11:59:00.000Z",
        availability: "available",
        dataMode: "realtime",
        price: 0.82,
        symbol,
      };
    },
    listActiveMonitors: async () => ({ monitors, diagnostics: [] }),
    createAlert: async (input) => {
      assert.equal(input.sourceExecutionId, availableCorporateAction().sourceExecutionId);
      const key = `${input.monitorId}:${input.eventId}`;
      if (alerts.has(key)) return { status: "existing", monitorId: input.monitorId };
      alerts.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  };

  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  assert.equal(corporateActionReads, 2, "one official Corporate Action read per complete attempt");
  assert.equal(tickerReads, 2, "one event ticker read per complete attempt");
  assert.equal(priceReads, 2, "one provider-neutral price read per complete attempt");
  assert.deepEqual(first.evaluations.map((item) => item.status), ["match", "no_match"]);
  assert.deepEqual([first.createdCount, first.existingCount], [1, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount], [0, 1]);
  assert.equal(first.corporateActionReaderStatus, "available");
  assert.equal(alerts.size, 1);
});

test("source-backed forward split creates one Alert through the unchanged consumer", async () => {
  let writes = 0;
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    readCorporateActionFacts: async () => availableCorporateAction("forward_split"),
    listActiveMonitors: async () => ({
      monitors: [monitor("a2000000-0000-4000-8000-000000000033", [
        { key: "corporate_action.event_kind", operator: "eq", value: "forward_split" },
        { key: "corporate_action.action_stage", operator: "eq", value: "scheduled" },
      ])],
      diagnostics: [],
    }),
    createAlert: async (input) => {
      writes += 1;
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  assert.deepEqual(result.evaluations.map((item) => item.status), ["match"]);
  assert.equal(result.createdCount, 1);
  assert.equal(writes, 1);
});

function clarifiedReverseSplitConditions() {
  const text = "Alert me when a stock below $1 announces a reverse split.";
  const result = validateNaturalLanguageConditionCompilerOutput({
    requirements: [
      {
        source_text: "a stock below $1",
        decision: "mapped",
        conditions: [{ key: "market.price", operator: "lt", value: 1 }],
        reason: null,
        question: null,
      },
      {
        source_text: "announces a reverse split",
        decision: "mapped",
        conditions: [
          { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
          { key: "corporate_action.action_stage", operator: "eq", value: "announced" },
        ],
        reason: null,
        question: null,
      },
    ],
  }, text);
  const draft = buildNaturalLanguageMonitorDraft(result, text);
  return applyNaturalLanguageMonitorConfirmation(parseNaturalLanguageMonitorConfirmationRequest({
    draft,
    proposalId: "p1",
    choiceId: "omit",
  })).conditions;
}

test("Marketstack-style EOD price is INELIGIBLE and creates no Alert", async () => {
  let writes = 0;
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    readFacts: async () => availableCurrent(),
    readCurrentPrice: async (symbol) => ({
      asOf: "2026-08-14T00:00:00.000Z",
      availability: "available",
      dataMode: "end-of-day",
      price: 0.75,
      symbol,
    }),
    listActiveMonitors: async () => ({
      monitors: [monitor("a2000000-0000-4000-8000-000000000024", [
        { key: "market.price", operator: "lt", value: 1 },
        { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      ])],
      diagnostics: [],
    }),
    createAlert: async (input) => {
      writes += 1;
      return { status: "created", monitorId: input.monitorId };
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
  assert.deepEqual(result.evaluations.map((item) => [item.status, item.reasonCode]), [
    ["ineligible", "market_price_data_mode_ineligible"],
  ]);
  assert.equal(writes, 0);
  assert.equal(result.writes.length, 0);
});

test("consumer boundary has no provider, parser, Primary, legacy, or external delivery execution dependency", () => {
  const source = readFileSync(new URL("./listingMonitorAlertConsumer.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "Gemini",
    "runAnalyzer",
    "parser",
    "primary_analysis",
    "ai_runs",
    "Telegram",
    "Email",
    "Web push",
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("evaluation date preserves Matcher V1 runtime moving-window semantics", async () => {
  const harness = consumerHarness();
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...harness.dependencies,
    now: () => new Date("2026-08-20T23:59:59.000Z"),
  });
  assert.equal(result.evaluationDate, "2026-08-20");
});

test("existing delivery worker claim predicates cannot select Listing internal Alerts", () => {
  const worker = readFileSync(new URL("../alerts/delivery/processQueuedDeliveries.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260813211146_listing_monitor_alert_e2e_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(worker, /delivery_status:\s*"eq\.queued"/);
  assert.match(worker, /scheduled_for:\s*`lte\.\$\{new Date\(\)\.toISOString\(\)\}`/);
  assert.match(worker, /for \(const channel of new Set\(row\.delivered_channels\)\)/);
  assert.match(migration, /delivered_channels = array\[\]::text\[\]/);
  assert.match(migration, /scheduled_for is null/);
});

function consumerHarness(options: {
  secondMatch?: boolean;
  failFirstWrite?: boolean;
  sourceExecutionIds?: string[];
} = {}) {
  let reads = 0;
  let writeAttempts = 0;
  const alerts = new Set<string>();
  const monitors = [
    monitor("a2000000-0000-4000-8000-000000000011", [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "listing.event_outcome", operator: "eq", value: "adverse" },
    ]),
    monitor("a2000000-0000-4000-8000-000000000012", [{
      key: "listing.event_kind",
      operator: "eq",
      value: options.secondMatch ? "deficiency_notice" : "compliance_recovery",
    }]),
    monitor("a2000000-0000-4000-8000-000000000013", [{
      key: "listing.appeal_deadline",
      operator: "eq",
      value: "2026-08-20",
    }]),
  ] satisfies ListingMonitor[];

  const dependencies: ListingMonitorAlertConsumerDependencies = {
    readFacts: async () => {
      const sourceExecutionId = options.sourceExecutionIds?.[reads] ?? SOURCE_EXECUTION_ID;
      reads += 1;
      return availableCurrent(sourceExecutionId);
    },
    listActiveMonitors: async () => ({ monitors, diagnostics: [invalidDiagnostic()] }),
    createAlert: async (input) => {
      writeAttempts += 1;
      if (options.failFirstWrite && writeAttempts === 1) {
        return { status: "failed", monitorId: input.monitorId, error: "fake insert failure" };
      }
      const key = `${input.monitorId}:${input.eventId}`;
      if (alerts.has(key)) return { status: "existing", monitorId: input.monitorId };
      alerts.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T00:00:00.000Z"),
  };
  return { dependencies, reads: () => reads, alertCount: () => alerts.size };
}

function monitor(id: string, conditions: ListingMonitor["conditions"]): ListingMonitor {
  return {
    id,
    userId: OWNER_ID,
    domain: "listing",
    kind: "condition_set",
    conditions,
    isActive: true,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

function availableForm4Purchase(): Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }> {
  const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1685251/000149315226023264/ownership.xml";
  const base = {
    event_id: EVENT_ID,
    transaction_kind: "non_derivative",
    transaction_code: "P",
    acquired_disposed_code: "A",
    security_title: "Common Stock",
    shares_availability: "available",
    shares_value_quality: "exact",
    price_per_share_availability: "available",
    price_per_share_value_quality: "exact",
    transaction_date: "2026-05-12",
    direct_or_indirect_ownership: "D",
    symbol: "AGIG",
    provenance: {
      source_url: sourceUrl,
      reporting_owner_scope: "single_filing_owner",
      reporting_owner_profiles: [{
        name: "Bailey Robert J.", roles: ["director"], officer_title: null,
        is_officer: false, is_director: true,
      }],
    },
  };
  return {
    status: "available",
    form: "form4",
    filingForm: "4",
    filedAt: "2026-05-23T15:00:00.000Z",
    rows: [
      {
        ...base, transaction_index: 0, shares: 1050, price_per_share: 1.195,
        calculation_basis: { shares: { text: "1050" }, price_per_share: { text: "1.195" } },
      },
      {
        ...base, transaction_index: 1, shares: 8950, price_per_share: 1.1999,
        calculation_basis: { shares: { text: "8950" }, price_per_share: { text: "1.1999" } },
      },
    ],
    eventId: EVENT_ID,
    rawItemId: "11111111-1111-4111-8111-111111111111",
    sourceExecutionId: EVENT_ID,
    accessionNumber: "0001493152-26-023264",
    parserVersion: "ownership_parser_v1",
    persistedAt: "2026-05-23T15:00:00.000Z",
  };
}

function invalidDiagnostic(): ListingMonitorDiagnostic {
  return {
    id: "a2000000-0000-4000-8000-000000000099",
    reason: "stored_conditions_invalid",
    errors: ["conditions[0]:condition_key_unknown"],
  };
}

function availableCurrent(
  sourceExecutionId = SOURCE_EXECUTION_ID,
): Extract<CurrentListingRiskReadResult, { status: "available" }> {
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "a2000000-0000-4000-8000-000000000002",
    parentPrimaryAiRunId: "a2000000-0000-4000-8000-000000000003",
    sourceExecutionId,
    monitorAnalyzerKey: "listing_risk",
    analyzerContractVersion: "listing_risk_domain_analyzer_v11",
    persistedAt: "2026-08-13T18:57:34.542648Z",
    factSchemaVersion: "listing_risk_event_facts_v2",
    facts: {
      classification: { event_kind: "deficiency_notice", event_outcome: "adverse" },
      affected_security: {
        ticker: {
          value: "ATPC",
          availability: "available",
          value_quality: "exact",
        },
      },
      dates: {
        appeal_deadline: {
          value: null,
          availability: "unavailable",
          value_quality: "unknown",
          date_status: "unknown",
        },
      },
    } as never,
  };
}

function availableCorporateAction(
  eventKind: "reverse_split" | "forward_split" = "reverse_split",
): Extract<CurrentCorporateActionReadResult, { status: "available" }> {
  const version = eventKind === "reverse_split"
    ? "corporate_action_reverse_split_facts_v1" as const
    : "corporate_action_forward_split_facts_v1" as const;
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "a2000000-0000-4000-8000-000000000042",
    parentPrimaryAiRunId: "a2000000-0000-4000-8000-000000000043",
    sourceExecutionId: "a2000000-0000-4000-8000-000000000044",
    monitorAnalyzerKey: "corporate_action",
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    persistedAt: "2026-08-14T00:00:00.000Z",
    factSchemaVersion: version,
    facts: {
      version,
      event_kind: eventKind,
      action_stage: "scheduled",
      effective_date: { availability: "unavailable" },
      ratio: { old_shares_per_new_share: { availability: "unavailable" } },
      source_ref: "aemd_source",
      evidence: { availability: "available", value: `AEMD scheduled a ${eventKind === "reverse_split" ? "reverse" : "forward"} stock split.` },
      confidence: "high",
      as_of: { availability: "available", value: "2026-08-14" },
      source: { source_family: "news", source_id: "AEMD", source_url: "https://example.com/aemd" },
    },
  };
}
