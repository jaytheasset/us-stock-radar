import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  validateCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerTransportResult,
  type CorporateActionCanonicalFacts,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCorporateActionApplicabilityContext,
  validateCorporateActionApplicabilityContextResponse,
} from "./corporateActionApplicabilityContext.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import { readReverseSplitHistory } from "./reverseSplitHistory.ts";
import type { CurrentCorporateActionReadResult } from "./corporateActionPersistence.ts";

const cik = "0001234567";
const accession = "0001234567-26-000001";
const singleClassId = `sc:v1:${cik}:common_stock:single`;
const classAId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassAMember`;
const classBId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassBMember`;

function input(text: string, candidates = [candidate(singleClassId, "SINGLE_COMMON_STOCK_CLASS", null)]) {
  return adaptSec8k6kCorporateActionSource({
    accession_number: accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/filing.htm`,
    filed_at: "2026-08-01T16:30:00Z",
    title: "8-K",
    cleaned_source_blocks: [{ block_id: "sec_block_1", text }],
    issuer_context: {
      availability: "available",
      issuer_cik: cik,
      accession_number: accession,
      accepted_at: "2026-08-01T16:30:00Z",
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: candidates,
  });
}

function candidate(
  canonicalSecurityClassId: string,
  basis: "SINGLE_COMMON_STOCK_CLASS" | "CLASS_SPECIFIC_COMMON_STOCK",
  sourceMemberLocalName: string | null,
) {
  return {
    canonical_security_class_id: canonicalSecurityClassId,
    security_type: "common_stock" as const,
    security_class_basis: basis,
    source_member_local_name: sourceMemberLocalName,
    supporting_accessions: ["0001234567-26-000000"],
  };
}

function transport(overrides: Partial<Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>> = {}) {
  return {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: "scheduled",
    effective_date: {
      availability: "available",
      value: "2026-08-10",
      source_ref: "sec_block_1",
      evidence: "August 10, 2026",
    },
    ratio: {
      availability: "available",
      old_shares: "10",
      new_shares: "1",
      source_ref: "sec_block_1",
      evidence: "1-for-10 reverse stock split",
    },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "sec_block_1",
      evidence: "reverse stock split",
    },
    affected_security: {
      availability: "available",
      canonical_security_class_id: singleClassId,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: {
      availability: "available",
      kind: "market_open",
      timestamp: null,
      source_ref: "sec_block_1",
      evidence: "effective at market open on August 10, 2026",
    },
    source_ref: "sec_block_1",
    evidence: "1-for-10 reverse stock split of its common stock",
    confidence: "high",
    as_of: { availability: "available", value: "2026-08-10" },
    ...overrides,
  } as CorporateActionAnalyzerTransportResult;
}

test("SEC ledger CIK and canonical class candidates are validated without ticker identity", () => {
  const context = validateCorporateActionApplicabilityContextResponse({
    status: "available",
    issuer_context: {
      availability: "available",
      issuer_cik: cik,
      accession_number: accession,
      accepted_at: "2026-08-01T16:30:00Z",
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: [candidate(singleClassId, "SINGLE_COMMON_STOCK_CLASS", null)],
  });
  assert.equal(context.issuerContext.availability, "available");
  assert.equal(context.securityClassCandidates[0]?.canonical_security_class_id, singleClassId);
  assert.deepEqual(validateCorporateActionApplicabilityContextResponse({
    status: "unavailable",
    reason: "non_sec_source",
  }), {
    issuerContext: { availability: "unavailable", reason: "non_sec_source" },
    securityClassCandidates: [],
    reverseSplitExecutionCandidates: [],
    forwardSplitExecutionCandidates: [],
  });
});

test("production context reader uses one exact event/raw RPC boundary", async () => {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const eventId = "10000000-0000-4000-8000-000000000010";
  const rawItemId = "10000000-0000-4000-8000-000000000011";
  const result = await readCorporateActionApplicabilityContext({ eventId, rawItemId }, {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        ok: true,
        status: 200,
        data: {
          status: "available",
          issuer_context: {
            availability: "available",
            issuer_cik: cik,
            accession_number: accession,
            accepted_at: "2026-08-01T16:30:00Z",
            provenance: "sec_filing_ledger",
          },
          security_class_candidates: [candidate(singleClassId, "SINGLE_COMMON_STOCK_CLASS", null)],
        },
      };
    },
    readExecutionCandidates: async ({ actionKind, cik: requestedCik, targetAt }) => {
      assert.equal(requestedCik, cik);
      assert.equal(targetAt, "2026-08-01T16:30:00Z");
      return [{
        execution_id: `${actionKind === "reverse_split" ? "rse" : "fse"}:v1:${"a".repeat(64)}`,
        issuer_cik: cik,
        canonical_security_class_id: singleClassId,
        effective_date: "2026-08-10",
        old_share_units: "10",
        new_share_units: "1",
        calculation_status: "scheduled",
      }];
    },
  });
  assert.equal(result.securityClassCandidates.length, 1);
  assert.equal(result.reverseSplitExecutionCandidates.length, 1);
  assert.equal(result.forwardSplitExecutionCandidates.length, 1);
  assert.deepEqual(calls, [{
    name: "read_corporate_action_applicability_context",
    payload: { p_event_id: eventId, p_raw_item_id: rawItemId },
  }]);
});

test("single-common source maps only to the supplied issuer-scoped canonical class", () => {
  const source = "The company will effect a 1-for-10 reverse stock split of its common stock, effective at market open on August 10, 2026.";
  const canonical = canonicalizeCorporateActionAnalyzerResult(transport(), input(source));
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  if (!canonical.result?.applicable) return;
  assert.equal(canonical.result.facts.applicability?.issuer.availability, "available");
  assert.equal(
    canonical.result.facts.applicability?.affected_security.availability === "available"
      ? canonical.result.facts.applicability.affected_security.canonical_security_class_id : null,
    singleClassId,
  );
  const exact = canonical.result.facts.ratio.exact_source_components;
  assert.equal(exact?.availability, "available");
  assert.equal(exact?.availability === "available" ? exact.old_share_units : null, "10");
  assert.equal(exact?.availability === "available" ? exact.new_share_units : null, "1");
  assert.equal(canonical.result.facts.effective_timing?.availability, "available");
  assert.deepEqual(validateCorporateActionAnalyzerResult(canonical.result), []);
});

test("multi-class maps explicit Class A only and rejects an unsupplied class", () => {
  const source = "A 1-for-10 reverse stock split of Class A Common Stock will be effective at market open on August 10, 2026.";
  const candidates = [
    candidate(classAId, "CLASS_SPECIFIC_COMMON_STOCK", "CommonClassAMember"),
    candidate(classBId, "CLASS_SPECIFIC_COMMON_STOCK", "CommonClassBMember"),
  ];
  const classATransport = transport({
    evidence: source,
    affected_security: {
      availability: "available",
      canonical_security_class_id: classAId,
      security_type: "common_stock",
      source_security_title: "Class A Common Stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of Class A Common Stock",
    },
  });
  const canonical = canonicalizeCorporateActionAnalyzerResult(classATransport, input(source, candidates));
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable && canonical.result.facts.applicability?.affected_security.availability === "available"
    ? canonical.result.facts.applicability.affected_security.canonical_security_class_id : null, classAId);

  const unavailableRootPreview = canonicalizeCorporateActionAnalyzerResult(
    transport({
      evidence: "not an exact source span",
      affected_security: (classATransport as Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>)
        .affected_security,
    }),
    input(source, candidates),
  );
  assert.equal(unavailableRootPreview.result?.applicable, true);
  assert.deepEqual(unavailableRootPreview.errors, []);
  if (unavailableRootPreview.result?.applicable) {
    assert.equal(unavailableRootPreview.result.facts.evidence.availability, "unavailable");
    assert.equal(unavailableRootPreview.result.facts.calculation_activation?.state, "ON_EFFECTIVE_DATE");
  }

  const foreignClass = canonicalizeCorporateActionAnalyzerResult(transport({
    affected_security: {
      ...(classATransport as Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>).affected_security!,
      canonical_security_class_id: `sc:v1:${cik}:common_stock:us-gaap:CommonClassCMember`,
    } as Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>["affected_security"],
  }), input(source, candidates));
  assert.equal(foreignClass.result, null);
  assert.match(foreignClass.errors.join("; "), /supplied canonical security class candidate/);
});

test("generic multi-class and ADR/ordinary ambiguity remain unavailable", () => {
  const genericSource = "The company will effect a reverse stock split of its common stock on August 10, 2026.";
  const candidates = [
    candidate(classAId, "CLASS_SPECIFIC_COMMON_STOCK", "CommonClassAMember"),
    candidate(classBId, "CLASS_SPECIFIC_COMMON_STOCK", "CommonClassBMember"),
  ];
  const ambiguous = canonicalizeCorporateActionAnalyzerResult(transport({
    ratio: { availability: "unavailable" },
    affected_security: {
      availability: "unavailable",
      reason: "source_security_ambiguous",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: { availability: "unavailable", reason: "date_only" },
  }), input(genericSource, candidates));
  assert.equal(ambiguous.result?.applicable, true);
  if (ambiguous.result?.applicable) {
    assert.equal(ambiguous.result.facts.applicability?.affected_security.availability, "unavailable");
  }

  const adr = canonicalizeCorporateActionAnalyzerResult(transport({
    ratio: { availability: "unavailable" },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "sec_block_1",
      evidence: "reverse split",
    },
    affected_security: {
      availability: "unavailable",
      reason: "ads_or_ordinary_ambiguous",
      source_ref: "sec_block_1",
      evidence: "reverse split affecting its ADSs or underlying ordinary shares",
    },
    effective_timing: { availability: "unavailable", reason: "date_only" },
  }), input("The reverse split affecting its ADSs or underlying ordinary shares is effective on August 10, 2026.", []));
  assert.equal(adr.result?.applicable, true);
  if (adr.result?.applicable) {
    assert.equal(adr.result.facts.applicability?.affected_security.availability, "unavailable");
  }
});

test("nonstandard ratio components remain exact while date-only calculation activates on the effective date", () => {
  const source = "The company will effect a two-for-fifteen reverse stock split of its common stock on August 10, 2026.";
  const canonical = canonicalizeCorporateActionAnalyzerResult(transport({
    ratio: {
      availability: "available",
      old_shares: "15",
      new_shares: "2",
      source_ref: "sec_block_1",
      evidence: source,
    },
    affected_security: {
      availability: "available",
      canonical_security_class_id: singleClassId,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: { availability: "unavailable", reason: "date_only" },
    evidence: "two-for-fifteen reverse stock split of its common stock",
  }), input(source));
  assert.equal(canonical.result?.applicable, true);
  if (!canonical.result?.applicable) return;
  const exact = canonical.result.facts.ratio.exact_source_components;
  assert.equal(exact?.availability, "available");
  assert.equal(exact?.availability === "available" ? exact.old_share_units : null, "15");
  assert.equal(exact?.availability === "available" ? exact.new_share_units : null, "2");
  assert.deepEqual(canonical.result.facts.ratio.old_shares_per_new_share, {
    availability: "available",
    value: 7.5,
  });
  assert.deepEqual(canonical.result.facts.effective_timing, {
    availability: "unavailable",
    reason: "date_only",
  });
  assert.equal(canonical.result.facts.calculation_activation?.state, "ON_EFFECTIVE_DATE");
});

test("official history returns current mapped splits in effective chronology and excludes stale lineage", async () => {
  const factsOne = canonicalFacts("2026-03-01", "10", "1");
  const factsTwo = canonicalFacts("2026-08-10", "15", "2");
  const eventOne = "10000000-0000-4000-8000-000000000001";
  const eventTwo = "10000000-0000-4000-8000-000000000002";
  const staleEvent = "10000000-0000-4000-8000-000000000003";
  const executionOne = "20000000-0000-4000-8000-000000000001";
  const executionTwo = "20000000-0000-4000-8000-000000000002";
  const staleExecution = "20000000-0000-4000-8000-000000000003";
  const candidates = [
    historyCandidate(eventTwo, executionTwo, factsTwo),
    historyCandidate(staleEvent, staleExecution, factsOne),
    historyCandidate(eventOne, executionOne, factsOne),
  ];
  const current = new Map<string, CurrentCorporateActionReadResult>([
    [eventOne, currentRead(eventOne, executionOne, factsOne)],
    [eventTwo, currentRead(eventTwo, executionTwo, factsTwo)],
    [staleEvent, { status: "not_ready" as const, reason: "current_successful_result_missing" }],
  ]);
  const history = await readReverseSplitHistory({
    cik,
    canonicalSecurityClassId: singleClassId,
    from: "2026-01-01",
    to: "2026-12-31",
  }, {
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "available",
        issuer_cik: cik,
        canonical_security_class_id: singleClassId,
        from: "2026-01-01",
        to: "2026-12-31",
        candidates,
      },
    }),
    readCurrent: async (eventId) => current.get(eventId)!,
  });
  assert.equal(history.basisChangeCoverage, "reverse_split_only");
  assert.deepEqual(history.items.map((item) => item.effectiveDate), ["2026-03-01", "2026-08-10"]);
  assert.deepEqual(history.items.map((item) => item.sourceExecutionId), [executionOne, executionTwo]);
  assert.ok(history.items.every((item) => item.sameDayOrdering === "indeterminate"));
});

function canonicalFacts(effectiveDate: string, oldShares: string, newShares: string): CorporateActionCanonicalFacts {
  const source = `The company will effect a ${newShares}-for-${oldShares} reverse stock split of its common stock on ${effectiveDate}.`;
  const result = canonicalizeCorporateActionAnalyzerResult(transport({
    effective_date: {
      availability: "available",
      value: effectiveDate,
      source_ref: "sec_block_1",
      evidence: source,
    },
    ratio: {
      availability: "available",
      old_shares: oldShares,
      new_shares: newShares,
      source_ref: "sec_block_1",
      evidence: source,
    },
    affected_security: {
      availability: "available",
      canonical_security_class_id: singleClassId,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: { availability: "unavailable", reason: "date_only" },
    evidence: "reverse stock split of its common stock",
    as_of: { availability: "available", value: effectiveDate },
  }), input(source));
  assert.equal(result.result?.applicable, true);
  return (result.result as { applicable: true; facts: CorporateActionCanonicalFacts }).facts;
}

function historyCandidate(
  eventId: string,
  sourceExecutionId: string,
  facts: CorporateActionCanonicalFacts,
) {
  return {
    event_id: eventId,
    source_execution_id: sourceExecutionId,
    issuer_cik: cik,
    canonical_security_class_id: singleClassId,
    effective_date: facts.effective_date.availability === "available" ? facts.effective_date.value : null,
    effective_timing: facts.effective_timing,
    facts,
    persisted_at: "2026-08-20T00:00:00Z",
  };
}

function currentRead(eventId: string, sourceExecutionId: string, facts: CorporateActionCanonicalFacts) {
  return {
    status: "available" as const,
    eventId,
    rawItemId: "30000000-0000-4000-8000-000000000001",
    parentPrimaryAiRunId: "40000000-0000-4000-8000-000000000001",
    sourceExecutionId,
    monitorAnalyzerKey: "corporate_action" as const,
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    factSchemaVersion: "corporate_action_reverse_split_facts_v1",
    facts,
    persistedAt: "2026-08-20T00:00:00Z",
  };
}
