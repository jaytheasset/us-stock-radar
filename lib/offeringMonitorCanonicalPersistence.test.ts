import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  promoteOfferingMonitorCanonical,
  validateOfferingMonitorCandidateForPromotion,
  validateOfferingMonitorCanonicalReadResult,
  type CanonicalPersistenceDependencies,
} from "./offeringMonitorCanonicalPersistence.ts";
import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";

const EVENT_ID = "69606800-ee16-4a75-9bbf-3b64bdc56d69";
const RAW_ID = "efea3384-9eef-4e6b-9e63-60dc1cd3090e";
const PRIMARY_ID = "5e56353f-e700-4c3f-89c1-0d7c6faf851a";
const EXECUTION_ID = "42745e3b-7ac8-55af-a362-dec6ee07b96f";

test("strict Phase 5K candidate promotes five facts and one deterministic total", () => {
  const result = validateOfferingMonitorCandidateForPromotion(candidate());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.canonical.facts.actual_primary_offering_amount.value, 10_000_000);
  assert.equal(result.canonical.facts.immediate_primary_share_exposure.value, 15_713_387);
  assert.equal(result.canonical.facts.additional_potential_primary_share_exposure.value, 15_713_387);
  assert.equal(result.totalPotentialPrimaryShareExposure, 31_426_774);
  assert.match(
    result.materialized.total_potential_primary_share_exposure.security_basis || "",
    /common_shares.*common_warrants/,
  );
});

test("available fact outside selectedSourceRefs is rejected before atomic promotion", () => {
  const value = candidate();
  value.canonical_candidate.facts.actual_primary_offering_amount.source_ref = "foreign_ref";
  value.materialized_candidate = materialize(value.canonical_candidate);
  const result = validateOfferingMonitorCandidateForPromotion(value);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("; "), /selectedSourceRefs/);
});

test("malformed, failed, and materialization-divergent candidates fail closed", () => {
  assert.equal(validateOfferingMonitorCandidateForPromotion(null).ok, false);
  const failed = candidate();
  failed.validation.status = "validation_failed";
  assert.equal(validateOfferingMonitorCandidateForPromotion(failed).ok, false);
  const divergent = candidate();
  divergent.materialized_candidate.total_potential_primary_share_exposure.value = 99;
  const result = validateOfferingMonitorCandidateForPromotion(divergent);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("; "), /materialized candidate/);
});

test("unavailable, unknown-quality, and incompatible comparison facts remain governed by strict canonical validation", () => {
  const unavailable = candidate();
  assert.equal(unavailable.canonical_candidate.facts.offering_price.availability, "unavailable");
  assert.equal(validateOfferingMonitorCandidateForPromotion(unavailable).ok, true);

  const invalid = candidate();
  invalid.canonical_candidate.facts.additional_potential_primary_share_exposure.comparison_basis_type = "public_float";
  invalid.materialized_candidate = materialize(invalid.canonical_candidate);
  const result = validateOfferingMonitorCandidateForPromotion(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("; "), /comparison_basis_type/);
});

test("application promotion validates immutable candidate then calls only the atomic RPC", async () => {
  const calls: string[] = [];
  const value = candidate();
  const dependencies: CanonicalPersistenceDependencies = {
    select: async (table) => {
      calls.push(`select:${table}`);
      return { ok: true, status: 200, data: [{ payload: value }] };
    },
    rpc: async (functionName, payload) => {
      calls.push(`rpc:${functionName}`);
      assert.equal(payload.p_event_id, EVENT_ID);
      assert.equal(payload.p_source_execution_id, EXECUTION_ID);
      assert.deepEqual(payload.p_expected_candidate, value);
      return { ok: true, status: 200, data: { status: "saved" } };
    },
  };
  const result = await promoteOfferingMonitorCanonical({
    eventId: EVENT_ID,
    sourceExecutionId: EXECUTION_ID,
    dependencies,
  });
  assert.deepEqual(result, { status: "saved", eventId: EVENT_ID, sourceExecutionId: EXECUTION_ID });
  assert.deepEqual(calls, ["select:ai_outputs", "rpc:promote_event_offering_monitor_canonical"]);
});

test("atomic stale/rejected responses never become saved application results", async () => {
  for (const status of ["stale", "rejected"] as const) {
    const value = candidate();
    const result = await promoteOfferingMonitorCanonical({
      eventId: EVENT_ID,
      sourceExecutionId: EXECUTION_ID,
      dependencies: {
        select: async () => ({ ok: true, status: 200, data: [{ payload: value }] }),
        rpc: async () => ({ ok: true, status: 200, data: { status, reason: "parent_not_current" } }),
      },
    });
    assert.deepEqual(result, { status, reason: "parent_not_current" });
  }
});

test("canonical reader accepts stored total without recomputing and fails closed on mismatch", () => {
  const value = candidate();
  const available = readerPayload(value, 31_426_774);
  const result = validateOfferingMonitorCanonicalReadResult(available);
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.totalPotentialPrimaryShareExposure, 31_426_774);
    assert.equal(result.sourceExecutionId, EXECUTION_ID);
  }
  assert.deepEqual(
    validateOfferingMonitorCanonicalReadResult({ ...available, total_potential_primary_share_exposure: 1 }),
    { status: "not_ready", reason: "canonical_reader_validation_failed" },
  );
  assert.deepEqual(validateOfferingMonitorCanonicalReadResult({ status: "not_ready", reason: "parent_not_current" }), {
    status: "not_ready",
    reason: "parent_not_current",
  });
});

test("repository and migration preserve the canonical-only, RPC-only boundary", () => {
  const repository = source("lib/offeringMonitorCanonicalPersistence.ts");
  const migration = source("supabase/migrations/20260812111402_offering_monitor_canonical_persistence.sql");
  assert.doesNotMatch(repository, /event_offering_terms|offering_monitor_payload|market_context|parser fallback/i);
  assert.match(repository, /promote_event_offering_monitor_canonical/);
  assert.match(repository, /read_event_offering_monitor_canonical/);
  assert.match(migration, /primary key references public\.events/);
  assert.match(migration, /source_execution_id uuid not null unique/);
  assert.match(migration, /for update of event_row/);
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = ''/g);
  assert.match(migration, /revoke all on table public\.event_offering_monitor_canonical from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.promote_event_offering_monitor_canonical[\s\S]+to service_role/);
  assert.doesNotMatch(migration, /(?:from|join)\s+public\.event_offering_terms/i);
});

function candidate() {
  const canonicalCandidate: MinimalOfferingMonitor = {
    version: "minimal_offering_monitor_v1",
    applicability: "applicable",
    financing_stage: "registration_only",
    primary_or_resale: "primary",
    security_nature: "equity_linked",
    has_warrant: true,
    has_prefunded_warrant: true,
    has_convertible: false,
    facts: {
      actual_primary_offering_amount: availableFact(10_000_000, "currency", "USD", "unit_offering", "market_cap", "amount_ref"),
      offering_price: unavailableFact("currency_per_security", "market_price"),
      immediate_primary_share_exposure: availableFact(15_713_387, "shares", null, "common_shares", "shares_outstanding", "immediate_ref"),
      additional_potential_primary_share_exposure: availableFact(15_713_387, "shares", null, "common_warrants", "shares_outstanding", "additional_ref"),
      resale_share_exposure: unavailableFact("shares", "public_float"),
    },
  };
  return {
    schema_version: "offering_monitor_second_stage_candidate_v2",
    job_id: EXECUTION_ID,
    parent_primary_ai_run_id: PRIMARY_ID,
    event_id: EVENT_ID,
    raw_item_id: RAW_ID,
    source_identity: "0001437749-26-021738",
    prompt: { key: "offering_monitor_normalization_job", version: "second_stage_direct_v8" },
    input_stats: { selectedSourceRefs: ["amount_ref", "immediate_ref", "additional_ref"] },
    provider: {},
    raw_output: "{}",
    direct_payload: {},
    validation: { status: "success", errors: [] as string[] },
    canonical_candidate: canonicalCandidate,
    materialized_candidate: materialize(canonicalCandidate),
  };
}

function readerPayload(value: ReturnType<typeof candidate>, total: number | null) {
  return {
    status: "available",
    event_id: EVENT_ID,
    raw_item_id: RAW_ID,
    parent_primary_ai_run_id: PRIMARY_ID,
    source_execution_id: EXECUTION_ID,
    form_family: "s1",
    contract_version: "second_stage_direct_v8",
    schema_version: value.schema_version,
    canonical_payload: value.canonical_candidate,
    materialized_payload: value.materialized_candidate,
    total_potential_primary_share_exposure: total,
    promoted_at: "2026-08-12T00:00:00.000Z",
  };
}

function materialize(value: MinimalOfferingMonitor) {
  return materializeMinimalOfferingMonitor(value, buildMinimalOfferingMarketSnapshot(null));
}

function availableFact(
  value: number,
  unit: "currency" | "shares",
  currency: string | null,
  securityBasis: string,
  comparisonBasis: "market_cap" | "shares_outstanding",
  sourceRef: string,
) {
  return {
    value,
    availability: "available" as const,
    value_quality: "estimated" as const,
    bound: "maximum" as const,
    unit,
    currency,
    security_basis: securityBasis,
    comparison_basis_type: comparisonBasis,
    comparable_to_event_market_basis: false,
    source_ref: sourceRef,
  };
}

function unavailableFact(
  unit: "currency_per_security" | "shares",
  comparisonBasis: "market_price" | "public_float",
) {
  return {
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    bound: "unknown" as const,
    unit,
    currency: null,
    security_basis: null,
    comparison_basis_type: comparisonBasis,
    comparable_to_event_market_basis: null,
    source_ref: null,
  };
}

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
