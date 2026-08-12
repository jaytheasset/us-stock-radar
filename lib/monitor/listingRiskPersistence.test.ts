import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildGenericMonitorChildIdentities } from "./genericMonitorChildExecution.ts";
import {
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  type ListingRiskAnalyzerResult,
} from "./listingRiskAnalyzer.ts";
import {
  LISTING_RISK_EVENT_FACTS_VERSION,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  listingRiskTerminalStateAfterPersistence,
  persistListingRiskAnalyzerResult,
  readCurrentListingRiskFacts,
  validateCurrentListingRiskReadResult,
  type ListingRiskPersistenceDependencies,
} from "./listingRiskPersistence.ts";

const EVENT_ID = "81000000-0000-4000-8000-000000000001";
const RAW_ID = "81000000-0000-4000-8000-000000000002";
const PARENT_ID = "81000000-0000-4000-8000-000000000003";
const EXECUTION_ID = "594634a0-928b-5a4f-90c3-584b0ffd3b0b";

test("valid applicable persistence sends the exact validated payload and identity to the atomic RPC", async () => {
  const facts = listingFacts();
  const result: ListingRiskAnalyzerResult = { status: "applicable", facts };
  const calls: Array<{ functionName: string; payload: Record<string, unknown> }> = [];
  const dependencies = rpcDependencies((functionName, payload) => {
    calls.push({ functionName, payload });
    return {
      status: "saved",
      result_status: "applicable",
      event_id: EVENT_ID,
      source_execution_id: identity().executionId,
    };
  });

  assert.deepEqual(await persistListingRiskAnalyzerResult({ identity: identity(), result, dependencies }), {
    status: "saved",
    resultStatus: "applicable",
    eventId: EVENT_ID,
    sourceExecutionId: identity().executionId,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].functionName, "persist_listing_risk_analyzer_result");
  assert.equal(calls[0].payload.p_event_id, EVENT_ID);
  assert.equal(calls[0].payload.p_source_execution_id, identity().executionId);
  assert.deepEqual(calls[0].payload.p_expected_result, result);
});

test("invalid canonical facts and unsupported identity fail before the database", async () => {
  let calls = 0;
  const dependencies = rpcDependencies(() => {
    calls += 1;
    return {};
  });
  const malformed = { status: "applicable", facts: { version: LISTING_RISK_EVENT_FACTS_VERSION } };
  assert.equal(
    (await persistListingRiskAnalyzerResult({ identity: identity(), result: malformed, dependencies })).status,
    "rejected",
  );

  const emptyAvailableText = listingFacts();
  emptyAvailableText.exchange.value = "";
  assert.equal(
    (await persistListingRiskAnalyzerResult({
      identity: identity(),
      result: { status: "applicable", facts: emptyAvailableText },
      dependencies,
    })).status,
    "rejected",
  );

  const wrongContract = { ...identity(), analyzerContractVersion: "listing_risk_domain_analyzer_v999" };
  assert.deepEqual(
    await persistListingRiskAnalyzerResult({
      identity: wrongContract,
      result: { status: "not_applicable" },
      dependencies,
    }),
    { status: "rejected", reason: "unsupported_analyzer_contract_version" },
  );
  assert.equal(calls, 0);
});

test("terminal success is available only after saved or idempotent persistence", () => {
  const applicable: ListingRiskAnalyzerResult = { status: "applicable", facts: listingFacts() };
  const notApplicable: ListingRiskAnalyzerResult = { status: "not_applicable" };
  assert.equal(listingRiskTerminalStateAfterPersistence(applicable, {
    status: "saved",
    resultStatus: "applicable",
    eventId: EVENT_ID,
    sourceExecutionId: EXECUTION_ID,
  }), "succeeded_applicable");
  assert.equal(listingRiskTerminalStateAfterPersistence(notApplicable, {
    status: "idempotent",
    resultStatus: "not_applicable",
    eventId: EVENT_ID,
    sourceExecutionId: EXECUTION_ID,
  }), "succeeded_not_applicable");
  for (const status of ["stale", "conflict", "rejected"] as const) {
    assert.equal(listingRiskTerminalStateAfterPersistence(applicable, { status, reason: status }), null);
  }
});

test("current reader round-trips provenance plus null, false, and text zero without fallback normalization", async () => {
  const facts = listingFacts();
  const response = readerResponse("available", facts);
  const dependencies = rpcDependencies((functionName, payload) => {
    assert.equal(functionName, "read_current_event_listing_risk_facts");
    assert.deepEqual(payload, {
      p_event_id: EVENT_ID,
      p_analyzer_contract_version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
    });
    return response;
  });
  const read = await readCurrentListingRiskFacts(EVENT_ID, dependencies);
  assert.equal(read.status, "available");
  if (read.status !== "available") return;
  assert.deepEqual(read.facts, facts);
  assert.equal(read.facts.sources[0].source_ref, "source:block:1");
  assert.equal(read.facts.sources[0].evidence, "Issuer received a minimum bid price notice.");
  assert.equal(read.facts.as_of.source_ref, "source:block:1");
  assert.equal(read.facts.continued_trading.continues.value, false);
  assert.equal(read.facts.affected_security.ticker.value, "0");
  assert.equal(read.facts.listing_rule.value, null);
  assert.equal(read.facts.confidence, null);
});

test("reader distinguishes not_applicable and rejects malformed available payloads", () => {
  assert.equal(validateCurrentListingRiskReadResult(readerResponse("not_applicable")).status, "not_applicable");
  const malformed = readerResponse("available", listingFacts()) as Record<string, unknown>;
  malformed.facts = { ...listingFacts(), sources: [] };
  assert.deepEqual(validateCurrentListingRiskReadResult(malformed), {
    status: "not_ready",
    reason: "reader_facts_validation_failed",
  });
  assert.deepEqual(validateCurrentListingRiskReadResult({
    status: "available",
    event_type: "listing_risk",
    listing_status_snapshot: [{ label: "Listing Status", value: "At risk" }],
  }), {
    status: "not_ready",
    reason: "reader_lineage_validation_failed",
  });
});

test("migration keeps history separate from facts and locks down the public schema boundary", () => {
  const migration = readFileSync(join(
    process.cwd(),
    "supabase/migrations/20260812195846_listing_risk_typed_persistence.sql",
  ), "utf8");
  const repository = readFileSync(new URL("./listingRiskPersistence.ts", import.meta.url), "utf8");

  assert.match(migration, /create table public\.event_listing_risk_results/);
  assert.match(migration, /create table public\.event_listing_risk_facts/);
  assert.doesNotMatch(migration, /event_listing_risk_facts\s*\([\s\S]*?event_id uuid primary key/);
  assert.match(migration, /result_status = 'not_applicable'[\s\S]+validated_result_payload =/);
  assert.match(migration, /alter table public\.event_listing_risk_results enable row level security/);
  assert.match(migration, /revoke all on table public\.event_listing_risk_facts from public, anon, authenticated, service_role/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /grant execute on function public\.read_current_event_listing_risk_facts\(uuid, text\)\s+to service_role/);
  assert.match(repository, /read_current_event_listing_risk_facts/);
  for (const forbiddenFallback of [
    "listing_status_snapshot",
    "event_type",
    "parser_output",
    "event_offering_terms",
  ]) {
    assert.equal(repository.includes(forbiddenFallback), false);
  }
  assert.doesNotMatch(repository, /(?:\.|\[)["']?summary\b/);
});

function identity() {
  const [result] = buildGenericMonitorChildIdentities({
    primary: {
      eventId: EVENT_ID,
      rawItemId: RAW_ID,
      sourceFamily: "news",
      sourceGroup: "news",
      sourceCode: "phase1i_news",
      sourceIdentity: "phase1i-article",
      parentPrimaryAiRunId: PARENT_ID,
      parentPromptKey: "news_event_analysis",
      parentPromptVersion: "v27-monitor-routing",
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "listing_risk" }] },
    now: "2026-08-13T00:00:00.000Z",
  });
  return result;
}

function listingFacts(): ListingRiskEventFacts {
  const unavailableText = {
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  };
  const unavailableDate = {
    ...unavailableText,
    date_status: "unknown" as const,
  };
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: {
      event_kind: "deficiency_notice",
      event_outcome: "adverse",
      source_ref: "source:block:1",
    },
    exchange: {
      value: "Nasdaq",
      availability: "available",
      value_quality: "exact",
      source_ref: "source:block:1",
    },
    affected_security: {
      title: { ...unavailableText },
      ticker: {
        value: "0",
        availability: "available",
        value_quality: "exact",
        source_ref: "source:block:1",
      },
      security_basis: { ...unavailableText },
    },
    listing_rule: { ...unavailableText },
    listing_requirement: {
      value: "Minimum bid price requirement",
      availability: "available",
      value_quality: "exact",
      source_ref: "source:block:1",
    },
    compliance_period: { ...unavailableText },
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: {
      notice_date: {
        value: "2026-08-12",
        availability: "available",
        value_quality: "exact",
        date_status: "occurred",
        source_ref: "source:block:1",
      },
      compliance_deadline: { ...unavailableDate },
      hearing_date: { ...unavailableDate },
      appeal_deadline: { ...unavailableDate },
      trading_suspension_date: { ...unavailableDate },
      removal_effective_date: { ...unavailableDate },
    },
    continued_trading: {
      continues: {
        value: false,
        availability: "available",
        value_quality: "exact",
        source_ref: "source:block:1",
      },
      venue: { ...unavailableText },
    },
    as_of: {
      value: "2026-08-12",
      availability: "available",
      value_quality: "exact",
      date_status: "occurred",
      source_ref: "source:block:1",
    },
    confidence: null,
    sources: [{
      source_family: "news",
      source_id: "phase1i-article",
      source_url: "https://example.com/phase1i",
      source_ref: "source:block:1",
      evidence: "Issuer received a minimum bid price notice.",
    }],
  };
}

function readerResponse(status: "available" | "not_applicable", facts?: ListingRiskEventFacts) {
  return {
    status,
    event_id: EVENT_ID,
    raw_item_id: RAW_ID,
    parent_primary_ai_run_id: PARENT_ID,
    source_execution_id: EXECUTION_ID,
    monitor_analyzer_key: "listing_risk",
    analyzer_contract_version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
    ...(status === "available" ? { fact_schema_version: LISTING_RISK_EVENT_FACTS_VERSION, facts } : {}),
    persisted_at: "2026-08-13T01:00:00.000Z",
  };
}

function rpcDependencies(
  handler: (functionName: string, payload: Record<string, unknown>) => unknown,
): ListingRiskPersistenceDependencies {
  return {
    rpc: async (functionName, payload) => ({
      ok: true,
      status: 200,
      data: handler(functionName, payload),
    }),
  };
}
