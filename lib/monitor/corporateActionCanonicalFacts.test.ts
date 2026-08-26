import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  CORPORATE_ACTION_EVENT_KINDS,
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  CORPORATE_ACTION_STAGES,
  parseCorporateActionAnalyzerTransportJson,
  validateCorporateActionAnalyzerResult,
  validateCorporateActionAnalyzerTransportResult,
  verifyCorporateActionEvidenceIdentity,
  type CorporateActionAnalyzerTransportResult,
} from "./corporateActionCanonicalFacts.ts";
import {
  adaptNasdaqCorporateActionSource,
  adaptNewsCorporateActionSource,
  adaptSec8k6kCorporateActionSource,
} from "./corporateActionSourceAdapters.ts";
import {
  CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT,
  CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
} from "../prompts/corporateActionCanonicalAnalysis.ts";

const sourceText = "The company will effect a one-for-twenty reverse stock split. The reverse stock split will become effective on August 4, 2026.";
const timingSourceText = [
  sourceText,
  "The reverse stock split will be effective at market open on August 4, 2026.",
  "The reverse stock split may instead be effective at the start of trading or after market close.",
  "The source-stated exact timestamp is 2026-08-04T09:30:00-04:00.",
].join(" ");

function input() {
  return adaptNasdaqCorporateActionSource({
    source_unique_id: "ECA-test-source",
    source_url: "https://example.com/notices/test",
    published_at: "2026-08-01T00:00:00Z",
    title: "Stored official notice",
    body_text: sourceText,
  });
}

function applicable(overrides: Partial<Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>> = {}) {
  return {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: "scheduled",
    effective_date: {
      availability: "available",
      value: "2026-08-04",
      source_ref: "nasdaq_notice_body",
      evidence: "The reverse stock split will become effective on August 4, 2026.",
    },
    ratio: {
      availability: "available",
      old_shares: "20",
      new_shares: "1",
      source_ref: "nasdaq_notice_body",
      evidence: "The company will effect a one-for-twenty reverse stock split.",
    },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "nasdaq_notice_body",
      evidence: "The company will effect a one-for-twenty reverse stock split.",
    },
    source_ref: "nasdaq_notice_body",
    evidence: "The reverse stock split will become effective on August 4, 2026.",
    confidence: "high",
    as_of: { availability: "available", value: "2026-08-04" },
    ...overrides,
  } as CorporateActionAnalyzerTransportResult;
}

function timingInput() {
  return adaptNasdaqCorporateActionSource({
    source_unique_id: "ECA-timing-source",
    source_url: "https://example.com/notices/timing",
    published_at: "2026-08-01T00:00:00Z",
    title: "Stored timing notice",
    body_text: timingSourceText,
  });
}

function timingTransport(kind: string, timestamp: unknown, evidence: string) {
  return {
    ...applicable(),
    effective_timing: {
      availability: "available",
      kind,
      timestamp,
      source_ref: "nasdaq_notice_body",
      evidence,
    },
  };
}

test("applicable transport materializes only the reverse-split contract and mechanically converts old/new shares", () => {
  const canonical = canonicalizeCorporateActionAnalyzerResult(applicable(), input());
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  if (!canonical.result?.applicable) return;
  assert.equal(canonical.result.facts.event_kind, "reverse_split");
  assert.equal(canonical.result.facts.action_stage, "scheduled");
  assert.deepEqual(canonical.result.facts.ratio.old_shares_per_new_share, {
    availability: "available",
    value: 20,
  });
  assert.equal(canonical.result.facts.effective_date.availability, "available");
  assert.equal(canonical.result.facts.effective_date.availability === "available"
    ? canonical.result.facts.effective_date.value : null, "2026-08-04");
  assert.deepEqual(canonical.result.facts.source, {
    source_family: "nasdaq",
    source_id: "ECA-test-source",
    source_url: "https://example.com/notices/test",
  });
  assert.deepEqual(validateCorporateActionAnalyzerResult(canonical.result), []);
});

test("every action stage is a strict semantic enum and synonyms are rejected", () => {
  for (const action_stage of CORPORATE_ACTION_STAGES) {
    assert.deepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ action_stage })), []);
  }
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ action_stage: "approved" as never })), []);
});

test("canonical vocabulary is the single ordered source for Analyzer values and Monitor exposure", () => {
  assert.deepEqual(CORPORATE_ACTION_EVENT_KINDS, CORPORATE_ACTION_EVENT_KIND_VOCABULARY.map((entry) => entry.value));
  assert.deepEqual(CORPORATE_ACTION_STAGES, CORPORATE_ACTION_STAGE_VOCABULARY.map((entry) => entry.value));
  assert.deepEqual(CORPORATE_ACTION_EVENT_KIND_VOCABULARY, [{
    value: "reverse_split",
    description: "The event establishes a reverse stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Reverse stock split",
  }, {
    value: "forward_split",
    description: "The event establishes an explicit forward stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Forward stock split",
  }]);
  assert.deepEqual(CORPORATE_ACTION_STAGE_VOCABULARY.map(({ value, monitorable, displayLabel }) => ({
    value,
    monitorable,
    displayLabel,
  })), [
    { value: "announced", monitorable: true, displayLabel: "Announced" },
    { value: "board_approved", monitorable: true, displayLabel: "Board approved" },
    { value: "shareholder_approved", monitorable: true, displayLabel: "Shareholder approved" },
    { value: "scheduled", monitorable: true, displayLabel: "Scheduled" },
    { value: "effective", monitorable: true, displayLabel: "Effective" },
    { value: "unknown", monitorable: false, displayLabel: "Unknown" },
  ]);
  assert.ok([...CORPORATE_ACTION_EVENT_KIND_VOCABULARY, ...CORPORATE_ACTION_STAGE_VOCABULARY]
    .every((entry) => entry.description.trim() && entry.displayLabel.trim()));
});

test("non-stock-split sources have one exact not-applicable representation with no fake facts", () => {
  const parsed = parseCorporateActionAnalyzerTransportJson('{"applicable":false}');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.transport?.applicable, false);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult({
    applicable: false,
    event_kind: "reverse_split",
  }), []);
  assert.deepEqual(canonicalizeCorporateActionAnalyzerResult({ applicable: false }, input()).result, {
    applicable: false,
  });
});

test("source ref, date, ratio values, duplicate keys, and unknown semantics hard fail", () => {
  assert.match(
    parseCorporateActionAnalyzerTransportJson('{"applicable":false,"applicable":true}').errors.join("; "),
    /duplicate key/,
  );
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ source_ref: "missing ref" })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({
    effective_date: { availability: "available", value: "2026-02-30" },
  })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({
    ratio: {
      availability: "available",
      old_shares: "Infinity",
      new_shares: "1",
      source_ref: "nasdaq_notice_body",
      evidence: "The company will effect a one-for-twenty reverse stock split.",
    },
  })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult({
    ...applicable(),
    event_kind: "stock_dividend",
  }), []);
  assert.equal(canonicalizeCorporateActionAnalyzerResult(applicable({ source_ref: "foreign_document" }), input()).result, null);
  assert.match(canonicalizeCorporateActionAnalyzerResult(applicable({
    execution_update: {
      decision: "CANCEL_EXISTING_EXECUTION",
      target_execution_id: `rse:v1:${"a".repeat(64)}`,
      source_ref: "nasdaq_notice_body",
      evidence: "reverse stock split",
    },
  }), input()).errors.join("; "), /supplied execution candidate/);
});

test("evidence exactness is separated from semantic/source eligibility", () => {
  const exact = canonicalizeCorporateActionAnalyzerResult(applicable(), input());
  const unavailable = canonicalizeCorporateActionAnalyzerResult(applicable({ evidence: "paraphrased effective date" }), input());
  assert.equal(exact.result?.applicable, true);
  assert.equal(unavailable.result?.applicable, true);
  if (exact.result?.applicable && unavailable.result?.applicable) {
    assert.equal(exact.result.facts.evidence.availability, "available");
    assert.deepEqual(unavailable.result.facts.evidence, {
      availability: "unavailable",
      reason: "not_exact_span",
    });
    assert.deepEqual(unavailable.result.facts.effective_date, exact.result.facts.effective_date);
    assert.deepEqual(unavailable.result.facts.ratio, exact.result.facts.ratio);
  }
});

test("authoritative evidence identity retains an exact long range and hash while preview stays at 800", () => {
  const factClause = "The company will effect a one-for-twenty reverse stock split on August 4, 2026. ";
  const longEvidence = `${factClause}${"source context ".repeat(100)}`.slice(0, 1001).padEnd(1001, "x");
  const source = `${"p".repeat(90)}${longEvidence} trailing source`;
  const longInput = adaptNasdaqCorporateActionSource({
    source_unique_id: "long-evidence",
    source_url: "https://example.com/notices/long-evidence",
    published_at: "2026-08-01T00:00:00Z",
    title: "Long exact evidence",
    body_text: source,
  });
  const canonical = canonicalizeCorporateActionAnalyzerResult(applicable({
    effective_date: {
      availability: "available",
      value: "2026-08-04",
      source_ref: "nasdaq_notice_body",
      evidence: longEvidence,
    },
    ratio: {
      availability: "available",
      old_shares: "20",
      new_shares: "1",
      source_ref: "nasdaq_notice_body",
      evidence: longEvidence,
    },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "nasdaq_notice_body",
      evidence: longEvidence,
    },
    source_ref: "nasdaq_notice_body",
    evidence: longEvidence,
  }), longInput);
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  if (!canonical.result?.applicable) return;
  assert.equal(canonical.result.facts.evidence.availability, "available");
  assert.equal(canonical.result.facts.evidence.availability === "available"
    ? Array.from(canonical.result.facts.evidence.value).length : 0, 800);
  assert.equal(canonical.result.facts.evidence.availability === "available"
    ? canonical.result.facts.evidence.preview_truncated : false, true);
  assert.deepEqual(canonical.result.facts.evidence_identity, {
    version: "corporate_action_evidence_identity_v1",
    source_ref: "nasdaq_notice_body",
    range_start: 90,
    range_end: 1091,
    source_content_hash: createHash("sha256").update(longEvidence).digest("hex"),
    exact_source: true,
  });
  assert.equal(verifyCorporateActionEvidenceIdentity(
    canonical.result.facts.evidence_identity,
    longInput.source_documents,
  ), true);
  const tamperedDocuments = longInput.source_documents.map((document) => ({
    ...document,
    text: `${document.text.slice(0, 100)}!${document.text.slice(101)}`,
  }));
  assert.equal(verifyCorporateActionEvidenceIdentity(
    canonical.result.facts.evidence_identity,
    tamperedDocuments,
  ), false);
});

test("field evidence mismatch fails closed instead of falling back to root preview", () => {
  const transport = applicable();
  assert.equal(transport.applicable, true);
  if (!transport.applicable) return;
  if (transport.ratio.availability !== "available") return;
  transport.ratio.evidence = "A paraphrased ratio that is not in the source";
  const canonical = canonicalizeCorporateActionAnalyzerResult(transport, input());
  assert.equal(canonical.result, null);
  assert.match(canonical.errors.join("; "), /ratio requires exact source evidence identity/);
});

test("effective timing accepts only non-exact transport contracts", () => {
  const nonExactCases = [
    ["date_only", "The reverse stock split will become effective on August 4, 2026."],
    ["business_day_open", "The reverse stock split will be effective at market open on August 4, 2026."],
    ["market_open", "The reverse stock split will be effective at market open on August 4, 2026."],
    ["start_of_trading", "effective at the start of trading"],
    ["after_market_close", "after market close"],
  ] as const;
  for (const [kind, evidence] of nonExactCases) {
    const parsed = parseCorporateActionAnalyzerTransportJson(JSON.stringify(timingTransport(kind, null, evidence)));
    assert.deepEqual(parsed.errors, [], `${kind} should accept null timestamp`);
    assert.ok(parsed.transport?.applicable);
    const canonical = canonicalizeCorporateActionAnalyzerResult(parsed.transport!, timingInput(), {
      effectiveTimingDiagnostic: parsed.effectiveTimingDiagnostic,
    });
    assert.deepEqual(canonical.errors, []);
    assert.equal(canonical.result?.applicable && canonical.result.facts.effective_timing?.availability === "available"
      ? canonical.result.facts.effective_timing.kind : null, kind);
  }

  const exactTimestamp = "2026-08-04T09:30:00-04:00";
  const exact = parseCorporateActionAnalyzerTransportJson(JSON.stringify(timingTransport(
    "exact_timestamp",
    exactTimestamp,
    `The source-stated exact timestamp is ${exactTimestamp}.`,
  )));
  assert.equal(exact.transport, null);
  assert.match(exact.errors.join("; "), /effective_timing.kind is invalid/);
  assert.match(exact.errors.join("; "), /timestamp must be null/);

  const malformedExact = parseCorporateActionAnalyzerTransportJson(JSON.stringify(timingTransport(
    "exact_timestamp",
    "12:07 P.M.",
    "12:07 P.M.",
  )));
  assert.equal(malformedExact.transport, null);
  assert.match(malformedExact.errors.join("; "), /effective_timing.kind is invalid/);
  assert.deepEqual(malformedExact.effectiveTimingDiagnostic, {
    timing_kind: "exact_timestamp",
    raw_timestamp: "12:07 P.M.",
    raw_timestamp_truncated: false,
    effective_date: "2026-08-04",
    validation_reason: "result.effective_timing.kind is invalid",
  });
});

test("non-exact hallucinated timestamps normalize to null with a bounded diagnostic and retain the fact", () => {
  const parsed = parseCorporateActionAnalyzerTransportJson(JSON.stringify(timingTransport(
    "market_open",
    "09:30 local time",
    "The reverse stock split will be effective at market open on August 4, 2026.",
  )));
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.transport?.applicable);
  if (!parsed.transport?.applicable) return;
  assert.equal(parsed.transport.effective_timing?.availability === "available"
    ? parsed.transport.effective_timing.timestamp : undefined, null);
  const canonical = canonicalizeCorporateActionAnalyzerResult(parsed.transport, timingInput(), {
    effectiveTimingDiagnostic: parsed.effectiveTimingDiagnostic,
  });
  assert.deepEqual(canonical.errors, []);
  assert.ok(canonical.result?.applicable);
  if (!canonical.result?.applicable || canonical.result.facts.effective_timing?.availability !== "available") return;
  assert.equal(canonical.result.facts.ratio.exact_source_components?.availability, "available");
  assert.deepEqual(canonical.result.facts.effective_timing.timestamp_diagnostic, {
    reason: "non_exact_timestamp_normalized_to_null",
    raw_timestamp: "09:30 local time",
    raw_timestamp_truncated: false,
  });
});

test("generated 09:30 and 00:00 exact timestamps without source-verbatim offset remain fail-closed", () => {
  let accepted = 0;
  for (const timestamp of ["2026-08-04T09:30:00-04:00", "2026-08-04T00:00:00Z"]) {
    const generated = timingTransport(
      "exact_timestamp",
      timestamp,
      "The reverse stock split will become effective on August 4, 2026.",
    ) as CorporateActionAnalyzerTransportResult;
    const canonical = canonicalizeCorporateActionAnalyzerResult(generated, timingInput());
    if (canonical.result) accepted += 1;
    assert.match(canonical.errors.join("; "), /effective_timing.kind is invalid/);
  }
  assert.equal(accepted, 0);
});

test("all stored-source adapters preserve exact source identity and never load parser or Primary semantic truth", () => {
  const news = adaptNewsCorporateActionSource({
    source_unique_id: "news-1",
    source_url: "https://example.com/news/1",
    published_at: "2026-08-01",
    title: "News",
    body_text: sourceText,
  });
  const sec = adaptSec8k6kCorporateActionSource({
    accession_number: "0000000000-26-000001",
    source_url: "https://www.sec.gov/Archives/example",
    filed_at: "2026-08-01",
    title: "8-K",
    cleaned_source_blocks: [{ block_id: "sec_block_1", text: sourceText }],
  });
  assert.equal(news.source_family, "news");
  assert.equal(sec.source_family, "sec");
  assert.equal(sec.source_documents[0].source_ref, "sec_block_1");
  const adapterSource = readFileSync(new URL("./corporateActionSourceAdapters.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapterSource, /event_family|calendar_item|event_type|primary_context|regex|keyword/i);
});

test("one-call prompt defines full-source stage semantics and forbids semantic fallbacks", () => {
  const applicableSchema = CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA.anyOf[1];
  assert.deepEqual(applicableSchema.properties.event_kind.enum, CORPORATE_ACTION_EVENT_KINDS);
  assert.deepEqual(applicableSchema.properties.action_stage.enum, CORPORATE_ACTION_STAGES);
  assert.deepEqual(applicableSchema.required, [
    "applicable", "event_kind", "action_stage", "effective_date", "ratio", "affected_security",
    "effective_timing", "execution_update", "source_ref", "evidence", "confidence", "as_of",
  ]);
  assert.equal(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT.length, 11_407);
  assert.equal(
    createHash("sha256").update(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT).digest("hex"),
    "62a646e8514abfd2bb3a7f0fe5e1a8285eca6a0ef5d41b24fb0225c9f3aaa544",
  );
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /complete stored source documents/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /board_approved/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /shareholder_approved/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /future at the source time is scheduled/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /contemporaneous notice of an action taking effect/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never upgrade a historical notice/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /parser values, calendar values/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Application code alone performs division/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /distribution date and session.*never replace.*trading commencement/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /positive plain decimal strings in execution orientation/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /does not calculate outstanding shares/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /exactly one supplied security_class_candidate/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Do not map generic common stock across multiple class candidates/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never infer a clock time, timezone, exchange calendar/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /business_day_open, market_open, and start_of_trading all activate on the effective date/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never generate or repair 09:30, 00:00/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /never transports an exact clock timestamp/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Do not cite a different action's timestamp/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /exceeds 800 characters.*display preview capped at 800/i);
  assert.doesNotMatch(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /BINI|0001104659-23-056549/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /SUPERSEDE_EXISTING_EXECUTION/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /CANCEL_EXISTING_EXECUTION/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never match executions by ratio\/date similarity/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /reverse execution is never a forward target/i);
});
