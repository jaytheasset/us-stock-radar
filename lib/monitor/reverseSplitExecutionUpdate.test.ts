import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateActionCanonicalFacts } from "./corporateActionCanonicalFacts.ts";
import { readReverseSplitExecutionUpdates } from "./reverseSplitExecutionUpdate.ts";
import type { CurrentCorporateActionReadResult } from "./corporateActionPersistence.ts";

const cik = "0001234567";
const eventId = "10000000-0000-4000-8000-000000000001";
const sourceExecutionId = "20000000-0000-4000-8000-000000000001";
const targetExecutionId = `rse:v1:${"a".repeat(64)}`;

test("official update reader keeps only current source-time observations at or before targetAt", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const result = await readReverseSplitExecutionUpdates({
    cik,
    targetAt: "2026-08-24T00:00:00Z",
  }, {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        ok: true,
        status: 200,
        data: {
          status: "available",
          issuer_cik: cik,
          candidates: [
            candidate(eventId, sourceExecutionId),
            candidate("10000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000002"),
            candidate("10000000-0000-4000-8000-000000000003", "20000000-0000-4000-8000-000000000003"),
          ],
        },
      };
    },
    readCurrent: async (candidateEventId) => {
      if (candidateEventId.endsWith("2")) return { status: "not_ready", reason: "stale" };
      if (candidateEventId.endsWith("3")) {
        return current(candidateEventId, "20000000-0000-4000-8000-000000000003", "2026-08-25T00:00:00Z");
      }
      return current(candidateEventId, sourceExecutionId, "2026-08-23T00:00:00Z");
    },
  });
  assert.deepEqual(calls, [{
    name: "read_reverse_split_execution_update_candidates",
    payload: { p_issuer_cik: cik },
  }]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0]?.update.decision, "CANCEL_EXISTING_EXECUTION");
  assert.equal(result.updates[0]?.update.target_execution_id, targetExecutionId);
});

test("malformed update candidate responses fail closed", async () => {
  await assert.rejects(() => readReverseSplitExecutionUpdates({
    cik,
    targetAt: "2026-08-24T00:00:00Z",
  }, {
    rpc: async () => ({ ok: true, status: 200, data: { status: "available", issuer_cik: cik, candidates: [{}] } }),
    readCurrent: async () => ({ status: "not_ready", reason: "must_not_run" }),
  }), /candidate 0 is invalid/);
});

function candidate(candidateEventId: string, candidateExecutionId: string) {
  return {
    event_id: candidateEventId,
    source_execution_id: candidateExecutionId,
    persisted_at: "2026-08-23T00:00:01Z",
  };
}

function current(
  candidateEventId: string,
  candidateExecutionId: string,
  acceptedAt: string,
): CurrentCorporateActionReadResult {
  return {
    status: "available",
    eventId: candidateEventId,
    rawItemId: "30000000-0000-4000-8000-000000000001",
    parentPrimaryAiRunId: "40000000-0000-4000-8000-000000000001",
    sourceExecutionId: candidateExecutionId,
    monitorAnalyzerKey: "corporate_action",
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    factSchemaVersion: "corporate_action_reverse_split_facts_v1",
    facts: facts(acceptedAt),
    persistedAt: "2026-08-23T00:00:01Z",
  };
}

function facts(acceptedAt: string): CorporateActionCanonicalFacts {
  return {
    version: "corporate_action_reverse_split_facts_v1",
    event_kind: "reverse_split",
    action_stage: "unknown",
    effective_date: { availability: "unavailable" },
    ratio: {
      old_shares_per_new_share: { availability: "unavailable" },
      exact_source_components: { availability: "unavailable" },
    },
    applicability: {
      version: "reverse_split_applicability_v1",
      issuer: {
        availability: "available",
        issuer_cik: cik,
        accession_number: "0001234567-26-000023",
        accepted_at: acceptedAt,
        provenance: "sec_filing_ledger",
      },
      affected_security: {
        availability: "unavailable",
        reason: "source_security_ambiguous",
        source_ref: "sec_block_1",
        evidence: { availability: "available", value: "cancelled the reverse stock split" },
      },
      basis_change_capability: "reverse_split_only",
    },
    effective_timing: { availability: "unavailable", reason: "not_provided" },
    execution_update: {
      version: "reverse_split_execution_update_v1",
      decision: "CANCEL_EXISTING_EXECUTION",
      target_execution_id: targetExecutionId,
      target_issuer_cik: cik,
      target_canonical_security_class_id: `sc:v1:${cik}:common_stock:single`,
      candidate_execution_ids: [targetExecutionId],
      source_ref: "sec_block_1",
      evidence: { availability: "available", value: "cancelled the reverse stock split" },
      provenance: { rule: "llm_explicit_execution_update_exact_candidate" },
    },
    source_ref: "sec_block_1",
    evidence: { availability: "available", value: "cancelled the reverse stock split" },
    confidence: "high",
    as_of: { availability: "available", value: "2026-08-23" },
    source: {
      source_family: "sec",
      source_id: "0001234567-26-000023",
      source_url: "https://www.sec.gov/Archives/fixture.htm",
    },
  };
}
