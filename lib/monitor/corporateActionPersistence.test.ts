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
  validateCurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";

const facts = {
  version: "corporate_action_reverse_split_facts_v1",
  event_kind: "reverse_split",
  action_stage: "scheduled",
  effective_date: { availability: "available", value: "2026-08-04" },
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

test("official reader validates available and not-applicable without fallback", () => {
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
