import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDilutionIdentityReviewDecision,
  formatDilutionIdentityReviewPacket,
  getDilutionIdentityReviewPacket,
  readEffectiveDilutionIdentityDecision,
  validateDilutionIdentityReviewDecision,
  type DilutionIdentityReviewRpc,
} from "./dilutionIdentityReviewExchange.ts";

const observationKey = `economic-observation:v1:${"a".repeat(64)}`;
const reviewCaseId = `dilution-review-case:v1:${"b".repeat(64)}`;
const inputHash = `dilution-review-input:v1:${"c".repeat(64)}`;
const exposureId = `economic-exposure:v1:${"d".repeat(64)}`;
const adjudicationId = `dilution-adjudication:v1:${"e".repeat(64)}`;
const evidenceRef = "sec:0000123456-26-000001:primary:series-a";

test("packet carries immutable resolver context, strong evidence, registry candidates, history, and output contract", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  assert.equal(packet.review_case_id, reviewCaseId);
  assert.equal(packet.input_hash, inputHash);
  assert.equal(packet.resolver_original.decision, "UNRESOLVED");
  assert.equal(packet.source_backed_claims[0]?.claim_kind, "series_or_designation");
  assert.equal(packet.source_backed_claims[0]?.source_excerpt, "Series A Warrants");
  assert.equal(packet.evidence_refs[0]?.ref, evidenceRef);
  assert.equal(packet.relevant_existing_economic_exposures[0]?.exposure_id, exposureId);
  assert.equal(packet.identity_observation_history.length, 1);
  assert.deepEqual(packet.allowed_target_exposure_ids, [exposureId]);
  assert.match(formatDilutionIdentityReviewPacket(packet), /gpt_output_contract/);
});

test("UNRESOLVED to LINK_EXISTING validates and previews without writing", async () => {
  let writes = 0;
  const rpc = packetRpc(() => { writes += 1; });
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc });
  const validation = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson(),
  });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;
  assert.equal(validation.preview.originalDecision, "UNRESOLVED");
  assert.equal(validation.preview.proposedDecision, "LINK_EXISTING");
  assert.equal(validation.preview.proposedTargetExposureId, exposureId);
  assert.equal(writes, 0, "packet and preview must not mutate persistence");
});

test("invalid JSON is rejected before apply", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const validation = validateDilutionIdentityReviewDecision({ packet, pastedDecision: "not json" });
  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.errors[0]?.code, "REVIEW_JSON_INVALID");
});

test("review case mismatch and stale input are independently rejected", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const mismatched = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ review_case_id: `dilution-review-case:v1:${"f".repeat(64)}` }),
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.equal(mismatched.errors[0]?.code, "REVIEW_CASE_ID_MISMATCH");

  const stale = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ input_hash: `dilution-review-input:v1:${"f".repeat(64)}` }),
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.errors[0]?.code, "STALE_REVIEW_INPUT");
});

test("packet-external targets and evidence references fail closed", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const target = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ target_exposure_id: `economic-exposure:v1:${"f".repeat(64)}` }),
  });
  assert.equal(target.ok, false);
  if (!target.ok) assert.equal(target.errors[0]?.code, "REVIEW_TARGET_NOT_IN_PACKET");

  const evidence = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ evidence_refs: ["invented:evidence"] }),
  });
  assert.equal(evidence.ok, false);
  if (!evidence.ok) assert.equal(evidence.errors[0]?.code, "REVIEW_EVIDENCE_REF_NOT_IN_PACKET");
});

test("CREATE_NEW forbids a GPT-created target exposure id", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const validation = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ decision: "CREATE_NEW" }),
  });
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.errors[0]?.code, "REVIEW_TARGET_FORBIDDEN");
});

test("human Apply is the only path that invokes the adjudication RPC", async () => {
  const calls: string[] = [];
  const baseRpc = packetRpc();
  const rpc: DilutionIdentityReviewRpc = async (functionName, payload) => {
    calls.push(functionName);
    return baseRpc(functionName, payload);
  };
  const result = await applyDilutionIdentityReviewDecision({
    observationKey,
    pastedDecision: decisionJson(),
    appliedByUserId: "11111111-1111-4111-8111-111111111111",
    rpc,
  });
  assert.deepEqual(calls, ["apply_dilution_identity_review_v1"]);
  assert.equal(result.status, "applied");
  assert.equal(result.originalDecision, "UNRESOLVED");
  assert.equal(result.effectiveDecision, "LINK_EXISTING");
  assert.equal(result.targetExposureId, exposureId);
});

test("effective reader preserves machine original and exposes human effective decision", async () => {
  const result = await readEffectiveDilutionIdentityDecision({
    observationKey,
    rpc: async (functionName) => ({
      ok: functionName === "read_effective_dilution_identity_decision_v1",
      status: 200,
      data: {
        observation_key: observationKey,
        original: { decision: "UNRESOLVED", target_exposure_id: null },
        effective: {
          source: "HUMAN_ADJUDICATION",
          decision: "LINK_EXISTING",
          target_exposure_id: exposureId,
        },
      },
    }),
  });
  assert.equal((result.original as Record<string, unknown>).decision, "UNRESOLVED");
  assert.equal((result.effective as Record<string, unknown>).decision, "LINK_EXISTING");
});

function decisionJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    review_case_id: reviewCaseId,
    input_hash: inputHash,
    decision: "LINK_EXISTING",
    target_exposure_id: exposureId,
    confidence: "HIGH",
    reason: "The series designation and exact source reference match the canonical warrant.",
    evidence_refs: [evidenceRef],
    ...overrides,
  });
}

function packetRpc(onApply?: (functionName: string) => void): DilutionIdentityReviewRpc {
  return async (functionName) => {
    if (functionName === "read_dilution_identity_review_case_v1") {
      return { ok: true, status: 200, data: reviewContext() };
    }
    if (functionName === "apply_dilution_identity_review_v1") {
      onApply?.(functionName);
      return {
        ok: true,
        status: 200,
        data: {
          status: "applied",
          adjudication_id: adjudicationId,
          observation_key: observationKey,
          original_decision: "UNRESOLVED",
          effective_decision: "LINK_EXISTING",
          target_exposure_id: exposureId,
          applied_at: "2026-08-28T01:00:00Z",
        },
      };
    }
    return { ok: false, status: 404, data: null, error: "unexpected rpc" };
  };
}

function reviewContext() {
  const evidence = {
    version: "dilution_evidence_identity_v1",
    source_ref: evidenceRef,
    range_start: 10,
    range_end: 27,
    source_content_hash: "1".repeat(64),
    exact_source: true,
  };
  const claim = {
    version: "dilution_identity_claim_v1",
    claim_kind: "series_or_designation",
    value: "Series A Warrants",
    semantic_role: null,
    evidence_identity: evidence,
  };
  const resolver = {
    decision: "UNRESOLVED",
    reason_code: "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
    target_exposure_id: null,
    result: {
      decision: "UNRESOLVED",
      reason_code: "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
      candidate_exposure_identity: null,
      identity_evidence: [evidence],
      supporting_evidence_references: [evidence],
    },
  };
  const observation = {
    version: "dilution_source_observation_v1",
    issuer_cik: "0000123456",
    accession: "0000123456-26-000001",
    form: "8-K",
    filed_date: "2026-08-27",
    accepted_at: "2026-08-27T12:00:00Z",
    analysis_lineage: null,
    exposure_id: null,
    exposure_type: "warrant",
    observation_kind: "exposure_identity",
    observed_fields: [],
    identity_claims: [claim],
    status: "VALIDATED",
  };
  return {
    state_version: "dilution_identity_review_state_v1",
    review_case_id: reviewCaseId,
    input_hash: inputHash,
    issuer: { cik: "0000123456", entity_name: "Example Corp", tickers: [{ ticker: "EXM", exchange: "NASDAQ" }] },
    review_observation_key: observationKey,
    review_observation: {
      observation_key: observationKey,
      accession: observation.accession,
      form: observation.form,
      filed_date: observation.filed_date,
      accepted_at: observation.accepted_at,
      exposure_type: observation.exposure_type,
      observation_kind: observation.observation_kind,
      observation,
      resolver_original: resolver,
    },
    existing_economic_exposures: [{
      exposure_id: exposureId,
      issuer_cik: "0000123456",
      exposure_type: "warrant",
      canonical_identity_claims: [claim],
      created_from_observation_key: `economic-observation:v1:${"9".repeat(64)}`,
      created_accession: "0000123456-26-000000",
      created_at: "2026-08-26T12:00:00Z",
    }],
    identity_observation_history: [{
      observation_key: observationKey,
      accession: observation.accession,
      form: observation.form,
      filed_date: observation.filed_date,
      exposure_type: observation.exposure_type,
      observation_kind: observation.observation_kind,
      resolver_original: resolver,
      observation,
      human_adjudication: null,
    }],
    allowed_target_exposure_ids: [exposureId],
    allowed_evidence_refs: [evidenceRef],
  };
}
