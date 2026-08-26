import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGenericMonitorChildIdentities,
  type GenericMonitorChildIdentity,
} from "./genericMonitorChildExecution.ts";
import {
  corporateActionTerminalStateAfterPersistence,
  persistCorporateActionAnalyzerResult,
  readCurrentCorporateActionFacts,
  validateCurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";
import {
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  CORPORATE_ACTION_LEGACY_ANALYZER_CONTRACT_VERSION,
  CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION,
} from "./corporateActionCanonicalFacts.ts";

const facts = {
  version: "corporate_action_reverse_split_facts_v1",
  event_kind: "reverse_split",
  action_stage: "scheduled",
  effective_date: {
    availability: "available",
    value: "2026-08-04",
    calculation_basis: "split_effective",
  },
  ratio: { old_shares_per_new_share: { availability: "available", value: 20 } },
  source_ref: "nasdaq_notice_body",
  evidence: { availability: "available", value: "reverse split effective August 4, 2026" },
  confidence: "high",
  as_of: { availability: "available", value: "2026-08-04" },
  source: {
    source_family: "nasdaq",
    source_id: "ECA-test",
    source_url: "https://example.com/ECA-test",
  },
} as const;

test("persistence sends only exact validated child identity and canonical result to the RPC", async () => {
  const identity = childIdentity();
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await persistCorporateActionAnalyzerResult({
    identity,
    result: { applicable: true, facts },
    dependencies: {
      async rpc(name, payload) {
        calls.push({ name, payload });
        return {
          ok: true,
          status: 200,
          data: {
            status: "saved",
            applicable: true,
            event_id: identity.eventId,
            source_execution_id: identity.executionId,
          },
        };
      },
    },
  });
  assert.equal(result.status, "saved");
  assert.deepEqual(calls, [{
    name: "persist_corporate_action_analyzer_result",
    payload: {
      p_event_id: identity.eventId,
      p_source_execution_id: identity.executionId,
      p_expected_result: { applicable: true, facts },
    },
  }]);
  assert.equal(corporateActionTerminalStateAfterPersistence({ applicable: true, facts }, result), "succeeded_applicable");
});

test("invalid identity/result never reaches persistence and terminal state is fail closed", async () => {
  let calls = 0;
  const result = await persistCorporateActionAnalyzerResult({
    identity: { ...childIdentity(), monitorAnalyzerKey: "listing_risk" },
    result: { applicable: false },
    dependencies: { async rpc() { calls += 1; throw new Error("must not run"); } },
  });
  assert.equal(result.status, "rejected");
  assert.equal(calls, 0);
  assert.equal(corporateActionTerminalStateAfterPersistence({ applicable: false }, {
    status: "conflict",
    reason: "different payload",
  }), null);
});

test("official reader validates exact-contract available and not-applicable payloads", () => {
  const identity = childIdentity();
  const lineage = {
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    source_execution_id: identity.executionId,
    monitor_analyzer_key: "corporate_action",
    analyzer_contract_version: identity.analyzerContractVersion,
    persisted_at: "2026-08-14T00:00:00Z",
  };
  const available = validateCurrentCorporateActionReadResult({
    status: "available",
    ...lineage,
    fact_schema_version: facts.version,
    facts,
  });
  assert.equal(available.status, "available");
  const unknownStage = validateCurrentCorporateActionReadResult({
    status: "available",
    ...lineage,
    fact_schema_version: facts.version,
    facts: { ...facts, action_stage: "unknown" },
  });
  assert.equal(unknownStage.status, "available");
  if (unknownStage.status === "available") assert.equal(unknownStage.facts.action_stage, "unknown");
  assert.equal(validateCurrentCorporateActionReadResult({ status: "not_applicable", ...lineage }).status, "not_applicable");
  assert.deepEqual(validateCurrentCorporateActionReadResult({
    status: "available",
    ...lineage,
    fact_schema_version: facts.version,
    facts: { ...facts, event_kind: "forward_split" },
  }), { status: "not_ready", reason: "reader_facts_validation_failed" });
  const forwardFacts = {
    ...facts,
    version: "corporate_action_forward_split_facts_v1" as const,
    event_kind: "forward_split" as const,
    ratio: { old_shares_per_new_share: { availability: "available" as const, value: 0.25 } },
    evidence: { availability: "available" as const, value: "4-for-1 forward stock split" },
  };
  assert.equal(validateCurrentCorporateActionReadResult({
    status: "available",
    ...lineage,
    fact_schema_version: forwardFacts.version,
    facts: forwardFacts,
  }).status, "available");
});

test("current reader prefers V4 and falls back to current-lineage V3 only when V4 has no attempt", async () => {
  const identity = childIdentity();
  const calls: string[] = [];
  const current = await readCurrentCorporateActionFacts(identity.eventId, {
    async rpc(_name, payload) {
      const version = String(payload.p_analyzer_contract_version);
      calls.push(version);
      if (version === CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION) {
        return {
          ok: true,
          status: 200,
          data: { status: "not_ready", reason: "current_successful_result_missing" },
        };
      }
      if (version === CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION) return {
        ok: true,
        status: 200,
        data: currentReaderPayload(identity, CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION),
      };
      throw new Error("legacy reader must not run");
    },
  });
  assert.equal(current.status, "available");
  if (current.status === "available") {
    assert.equal(current.analyzerContractVersion, CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION);
  }
  assert.deepEqual(calls, [
    CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
    CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION,
  ]);
});

test("current reader reaches legacy V1 only when both V4 and V3 are genuinely absent", async () => {
  const identity = childIdentity();
  const calls: string[] = [];
  const current = await readCurrentCorporateActionFacts(identity.eventId, {
    async rpc(_name, payload) {
      const version = String(payload.p_analyzer_contract_version);
      calls.push(version);
      if (version !== CORPORATE_ACTION_LEGACY_ANALYZER_CONTRACT_VERSION) {
        return {
          ok: true,
          status: 200,
          data: { status: "not_ready", reason: "current_successful_result_missing" },
        };
      }
      return {
        ok: true,
        status: 200,
        data: currentReaderPayload(identity, CORPORATE_ACTION_LEGACY_ANALYZER_CONTRACT_VERSION),
      };
    },
  });
  assert.equal(current.status, "available");
  if (current.status === "available") {
    assert.equal(current.analyzerContractVersion, CORPORATE_ACTION_LEGACY_ANALYZER_CONTRACT_VERSION);
  }
  assert.deepEqual(calls, [
    CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
    CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION,
    CORPORATE_ACTION_LEGACY_ANALYZER_CONTRACT_VERSION,
  ]);
});

test("current reader never masks an incomplete or failed exact-current V4 attempt with prior success", async () => {
  const identity = childIdentity();
  const calls: string[] = [];
  const current = await readCurrentCorporateActionFacts(identity.eventId, {
    async rpc(_name, payload) {
      calls.push(String(payload.p_analyzer_contract_version));
      return {
        ok: true,
        status: 200,
        data: { status: "not_ready", reason: "current_contract_result_incomplete_or_failed" },
      };
    },
  });
  assert.deepEqual(current, {
    status: "not_ready",
    reason: "current_contract_result_incomplete_or_failed",
  });
  assert.deepEqual(calls, [CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION]);
});

test("current V4 not-applicable is terminal and never revives a prior applicable fact", async () => {
  const identity = childIdentity();
  let calls = 0;
  const current = await readCurrentCorporateActionFacts(identity.eventId, {
    async rpc() {
      calls += 1;
      return {
        ok: true,
        status: 200,
        data: {
          ...currentReaderPayload(identity, CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION),
          status: "not_applicable",
          facts: undefined,
          fact_schema_version: undefined,
        },
      };
    },
  });
  assert.equal(current.status, "not_applicable");
  assert.equal(calls, 1);
});

test("current V4 requires a calculation-date semantic role while persisted V3 remains readable", () => {
  const identity = childIdentity();
  const withoutRole = structuredClone(facts);
  if (withoutRole.effective_date.availability === "available") {
    delete (withoutRole.effective_date as { calculation_basis?: string }).calculation_basis;
  }
  assert.deepEqual(validateCurrentCorporateActionReadResult({
    ...currentReaderPayload(identity, CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION),
    facts: withoutRole,
  }, CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION), {
    status: "not_ready",
    reason: "reader_calculation_effective_date_role_validation_failed",
  });
  assert.equal(validateCurrentCorporateActionReadResult({
    ...currentReaderPayload(identity, CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION),
    facts: withoutRole,
  }, CORPORATE_ACTION_PREVIOUS_ANALYZER_CONTRACT_VERSION).status, "available");
});

test("migration is server-only, exact-lineage, stale-safe, and contains no parser/calendar fallback", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260814165708_corporate_action_canonical_facts_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table public\.event_corporate_action_results/);
  assert.match(migration, /create table public\.event_corporate_action_facts/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table public\.event_corporate_action_results[\s\S]*?service_role/);
  assert.match(migration, /grant execute on function public\.persist_corporate_action_analyzer_result[\s\S]*?to service_role/);
  assert.match(migration, /parent_not_current/);
  assert.match(migration, /same_execution_different_payload/);
  assert.match(migration, /monitor_analyzer_key' = 'corporate_action'/);
  assert.doesNotMatch(migration, /event_calendar_items|corporate_action_event_family|event_type\s*=\s*'listing_risk'/i);
});

test("applicability migration reuses canonical class support and exposes only current-verified history candidates", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260822104833_reverse_split_applicability_history_contract_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /alter table public\.event_corporate_action_facts/);
  assert.match(migration, /references public\.sec_issuers\(cik\)/);
  assert.match(migration, /support\.canonical_security_class_id = new\.canonical_security_class_id/);
  assert.match(migration, /support\.accepted_at <= v_ledger\.accepted_at/);
  assert.match(migration, /ratio_old_share_units numeric/);
  assert.match(migration, /ratio_new_share_units numeric/);
  assert.match(migration, /read_corporate_action_applicability_context/);
  assert.match(migration, /read_reverse_split_history_candidates/);
  assert.match(migration, /applicability_status = 'mapped'/);
  assert.match(migration, /grant execute on function public\.read_reverse_split_history_candidates[\s\S]*?to service_role/);
  assert.doesNotMatch(migration, /sec_issuer_ticker_observations|company_name|forward_split|stock_dividend/i);
});

test("execution update migration exposes bounded service-only lineage candidates without lifecycle inference", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260822124557_reverse_split_execution_update_safety_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /read_reverse_split_execution_update_candidates/);
  assert.match(migration, /facts_payload \? 'execution_update'/);
  assert.match(migration, /limit 512/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.read_reverse_split_execution_update_candidates\(text\)[\s\S]*authenticated/);
  assert.match(migration, /grant execute on function public\.read_reverse_split_execution_update_candidates\(text\)[\s\S]*service_role/);
  assert.doesNotMatch(migration, /ratio.*similar|ticker|company_name|old_share_units|new_share_units/i);
});

test("forward split migration extends the existing lineage and reader without O/S arithmetic or a parallel table", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260822171825_forward_stock_split_canonical_execution_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /corporate_action_forward_split_facts_v1/);
  assert.match(migration, /read_stock_split_history_candidates/);
  assert.match(migration, /read_stock_split_execution_update_candidates/);
  assert.match(migration, /ratio_new_share_units > ratio_old_share_units/);
  assert.match(migration, /pg_get_functiondef[\s\S]*persist_corporate_action_analyzer_result/);
  assert.match(migration, /pg_get_functiondef[\s\S]*read_current_event_corporate_action_facts/);
  assert.doesNotMatch(migration, /create table[\s\S]*(?:forward|stock)_split_execution/i);
  assert.doesNotMatch(migration, /outstanding_shares|shares_outstanding|normalizeClassShareCountAt|anchor reconciliation|dilution/i);
});

test("V3 migration preserves the SECURITY DEFINER boundary and distinguishes an exact-current failed attempt", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260823023000_stock_split_day_basis_evidence_contract_v3.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /pg_get_functiondef[\s\S]*persist_corporate_action_analyzer_result/);
  assert.match(migration, /pg_get_functiondef[\s\S]*read_current_event_corporate_action_facts/);
  assert.match(migration, /corporate_action_reverse_split_analyzer_v1/);
  assert.match(migration, /corporate_action_stock_split_day_basis_evidence_v3/);
  assert.match(migration, /current_contract_result_incomplete_or_failed/);
  assert.match(migration, /current_successful_result_missing/);
  assert.match(migration, /Recheck V3 at the legacy-reader boundary/);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)|security invoker|set search_path\s*=\s*public/i);
});

test("V4 migration admits semantic-role facts and blocks V4 attempts from V3 or V1 fallback", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260826135027_stock_split_effective_date_semantic_role_binding_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /corporate_action_stock_split_day_basis_evidence_v4/);
  assert.match(migration, /calculation_effective_date_role_invalid/);
  assert.match(migration, /split_effective[\s\S]*shares_reclassified[\s\S]*split_adjusted_trading/);
  assert.match(migration, /p_analyzer_contract_version in \([\s\S]*evidence_v3/);
  assert.doesNotMatch(migration, /create table|alter table|outstanding_shares|shares_outstanding|exchange calendar/i);
});

function currentReaderPayload(
  identity: GenericMonitorChildIdentity,
  analyzerContractVersion: string,
) {
  return {
    status: "available",
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    source_execution_id: identity.executionId,
    monitor_analyzer_key: "corporate_action",
    analyzer_contract_version: analyzerContractVersion,
    persisted_at: "2026-08-14T00:00:00Z",
    fact_schema_version: facts.version,
    facts,
  };
}

function childIdentity(): GenericMonitorChildIdentity {
  return buildGenericMonitorChildIdentities({
    primary: {
      eventId: "71000000-0000-4000-8000-000000000001",
      rawItemId: "71000000-0000-4000-8000-000000000002",
      sourceFamily: "nasdaq_corporate_actions",
      sourceGroup: "news",
      sourceCode: "nasdaq_corporate_actions",
      sourceIdentity: "ECA-test",
      parentPrimaryAiRunId: "71000000-0000-4000-8000-000000000003",
      parentPromptKey: "nasdaq_corporate_action_analysis",
      parentPromptVersion: "v8-corporate-action-routing",
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "corporate_action" }] },
    now: "2026-08-14T00:00:00Z",
  })[0];
}
