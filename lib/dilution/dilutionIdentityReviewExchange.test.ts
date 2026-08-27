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

test("packet has complete analysis, exposure comparison, SEC locator, and output-contract blocks", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  assert.equal(packet.review_case_id, reviewCaseId);
  assert.equal(packet.input_hash, inputHash);
  const analysis = packet.current_stock_radar_analysis;
  assert.equal((analysis.resolver_original as Record<string, unknown>).decision, "UNRESOLVED");
  assert.equal((analysis.filing as Record<string, unknown>).accession, "0000123456-26-000001");
  assert.equal((analysis.source_backed_claims as Record<string, unknown>[])[0]?.claim_kind, "series_or_designation");
  assert.equal((analysis.source_backed_claims as Record<string, unknown>[])[0]?.structured_value, "Series A Warrants");
  assert.equal((analysis.evidence_refs as Record<string, unknown>[])[0]?.ref, evidenceRef);
  assert.equal(packet.current_registered_exposures[0]?.exposure_id, exposureId);
  assert.equal((packet.current_registered_exposures[0]?.prior_observations as unknown[]).length, 1);
  assert.deepEqual(packet.allowed_target_exposure_ids, [exposureId]);
  const currentLocator = packet.sec_source_locators.current as Record<string, unknown>;
  assert.equal(
    currentLocator.filing_index_url,
    "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/0000123456-26-000001-index.html",
  );
  assert.match(formatDilutionIdentityReviewPacket(packet), /gpt_output_contract/);
});

test("packet never represents a structured claim value as a source quote", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const text = formatDilutionIdentityReviewPacket(packet);
  assert.doesNotMatch(text, /source_excerpt/);
  assert.doesNotMatch(text, /exact_quote/);
  assert.match(text, /structured_claim_value/);
  assert.match(text, /structured_value/);
});

test("packet instructs primary-source research and exposes resolver comparisons and target allowlist", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const instructions = packet.task_instructions.join(" ");
  assert.match(instructions, /Current Stock Radar Analysis/);
  assert.match(instructions, /Current Registered Exposures/);
  assert.match(instructions, /web search/);
  assert.match(instructions, /SEC primary filings/);
  assert.match(instructions, /only allowed_target_exposure_ids/);
  assert.match(instructions, /Never invent an exposure ID/);
  const resolver = packet.current_stock_radar_analysis.resolver_original as Record<string, unknown>;
  assert.ok(Array.isArray(resolver.matched_strong_claims));
  assert.ok(Array.isArray(resolver.conflicting_strong_claims));
  assert.ok(Array.isArray(resolver.independent_strong_claims));
  const schema = (packet.gpt_output_contract.schema as Record<string, unknown>);
  assert.ok((schema.required as string[]).includes("sources_checked"));
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

test("sources_checked is required and suggested corrections validate as non-decision metadata", async () => {
  const packet = await getDilutionIdentityReviewPacket({ observationKey, rpc: packetRpc() });
  const missingSources = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({ sources_checked: undefined }),
  });
  assert.equal(missingSources.ok, false);
  if (!missingSources.ok) {
    assert.ok(missingSources.errors.some((error) => error.code === "REVIEW_SOURCES_CHECKED_INVALID"));
  }

  const withSuggestion = validateDilutionIdentityReviewDecision({
    packet,
    pastedDecision: decisionJson({
      suggested_corrections: [{
        field: "current_stock_radar_analysis.source_backed_claims[0]",
        suggestion: "Review the series designation against Exhibit 4.1.",
        reason: "The structured value is not itself a verbatim quote.",
      }],
    }),
  });
  assert.equal(withSuggestion.ok, true);
  if (withSuggestion.ok) {
    assert.equal(withSuggestion.decision.decision, "LINK_EXISTING");
    assert.equal(withSuggestion.decision.target_exposure_id, exposureId);
    assert.equal(withSuggestion.decision.suggested_corrections?.length, 1);
  }
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
    sources_checked: [
      "https://www.sec.gov/Archives/edgar/data/123456/000012345626000001/0000123456-26-000001-index.html",
    ],
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
  const priorEvidenceRef = "sec:0000123456-26-000000:exhibit-4-1:series-a";
  const priorEvidence = {
    ...evidence,
    source_ref: priorEvidenceRef,
    source_content_hash: "2".repeat(64),
  };
  const priorClaim = {
    ...claim,
    evidence_identity: priorEvidence,
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
  const priorObservation = {
    ...observation,
    accession: "0000123456-26-000000",
    filed_date: "2026-08-26",
    accepted_at: "2026-08-26T12:00:00Z",
    identity_claims: [priorClaim],
  };
  const priorObservationKey = `economic-observation:v1:${"9".repeat(64)}`;
  const priorResolver = {
    decision: "CREATE_NEW",
    reason_code: "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY",
    target_exposure_id: exposureId,
    result: {
      ...resolver.result,
      decision: "CREATE_NEW",
      reason_code: "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY",
      independent_strong_claims: [{
        claim_kind: "series_or_designation",
        value: "Series A Warrants",
        evidence_identity: priorEvidence,
      }],
      identity_evidence: [priorEvidence],
      supporting_evidence_references: [priorEvidence],
    },
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
      canonical_identity_claims: [priorClaim],
      created_from_observation_key: priorObservationKey,
      created_accession: "0000123456-26-000000",
      created_at: "2026-08-26T12:00:00Z",
    }],
    identity_observation_history: [{
      observation_key: priorObservationKey,
      accession: priorObservation.accession,
      form: priorObservation.form,
      filed_date: priorObservation.filed_date,
      accepted_at: priorObservation.accepted_at,
      exposure_type: priorObservation.exposure_type,
      observation_kind: priorObservation.observation_kind,
      resolver_original: priorResolver,
      observation: priorObservation,
      human_adjudication: null,
    }, {
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
    allowed_evidence_refs: [evidenceRef, priorEvidenceRef],
  };
}
